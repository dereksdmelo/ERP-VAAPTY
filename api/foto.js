/**
 * /api/foto — as imagens do veículo no Supabase Storage.
 *
 * POST   { veiculo_id, imagem_base64, ordem }   sobe a imagem e grava a linha
 * GET    ?veiculo_id=                           as fotos em ordem, link de 1 h
 * PATCH  { ordens: [{ id, ordem }] }            reordena / define a capa
 * DELETE ?id=                                   apaga do Storage e da tabela
 *
 * Mesmas regras do api/veiculo.js: fetch puro, sem biblioteca, e a
 * chave de serviço não sai daqui — nem em resposta, nem em log.
 *
 * Depende da migração 0002: tabela `foto` (id, veiculo_id, caminho,
 * ordem, largura, altura, bytes) e o bucket privado `fotos-veiculo`.
 *
 * A 0002 tem índice único em (veiculo_id, ordem) — "evita duas capas".
 * Isso é o que torna a reordenação um caso especial: ver o PATCH.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_KEY || "";

const BUCKET = "fotos-veiculo";
const VALIDADE = 3600;                 // 1 hora de link assinado
const MAX_BYTES = 5 * 1024 * 1024;     // o mesmo file_size_limit do bucket

const REST = (tabela) => `${URL_BASE}/rest/v1/${tabela}`;
const STORAGE = () => `${URL_BASE}/storage/v1`;

const ANON = process.env.SUPABASE_ANON_KEY || "";

/**
 * O token do usuário logado, repassado como veio. Quem valida é o
 * PostgREST. Não pode virar variável de módulo: duas requisições
 * simultâneas na mesma instância trocariam de usuário.
 */
const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const SEM_LOGIN = { erro: "Sessão expirada. Entre de novo." };

// Banco: fala pelo usuário, então a RLS da 0004 vale.
const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

/**
 * Storage: continua na chave de serviço. A 0002 criou o bucket privado
 * e não criou política em storage.objects — com o token do usuário, o
 * upload e a leitura seriam recusados.
 *
 * Quem protege aqui é a ordem das operações: toda chamada ao Storage
 * vem depois de uma consulta ao banco feita pelo usuário. Se a RLS não
 * devolver a linha, a função para antes de tocar no arquivo.
 */
const hArquivo = (extra) => ({ apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, ...extra });
const jsonArquivo = (extra) => hArquivo({ "Content-Type": "application/json", ...extra });

// Rede de segurança: se a chave aparecer em qualquer texto, some.
const limpar = (s) => {
  const t = String(s == null ? "" : s);
  return CHAVE ? t.split(CHAVE).join("[oculto]") : t;
};

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const falha = (msg, status) => {
  const e = new Error(limpar(msg));
  e.status = status || 502;
  return e;
};

/* ------------------ conversa com o Supabase ------------------ */

async function pedir(url, opcoes, oQue) {
  let r;
  try {
    r = await fetch(url, opcoes);
  } catch (e) {
    throw falha(`Não consegui falar com o ${oQue}.`, 502);
  }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (dado && (dado.message || dado.error || dado.hint || dado.details)) ||
      `O ${oQue} recusou a operação.`;
    throw falha(msg, r.status === 401 || r.status === 403 ? 500 : 502);
  }
  return dado;
}

const banco = (url, opcoes) => pedir(url, opcoes, "banco");
const arquivos = (url, opcoes) => pedir(url, opcoes, "Storage");

/* ------------------ imagem ------------------ */

// Aceita data URL ("data:image/jpeg;base64,…") ou base64 puro.
function decodificar(dado) {
  let s = String(dado == null ? "" : dado).trim();
  if (s.slice(0, 5) === "data:") {
    const v = s.indexOf(",");
    if (v < 0) return null;
    s = s.slice(v + 1);
  }
  s = s.replace(/\s/g, "");
  if (!s || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  // Só JPEG: o caminho termina em .jpg e é o que comprimir() gera.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  return buf;
}

function sufixo() {
  try { return globalThis.crypto.randomUUID().slice(0, 8); }
  catch (e) { return Math.random().toString(36).slice(2, 10); }
}

const paraURL = (caminho) => caminho.split("/").map(encodeURIComponent).join("/");

async function assinar(caminhos) {
  if (!caminhos.length) return {};
  const r = await arquivos(`${STORAGE()}/object/sign/${BUCKET}`, {
    method: "POST",
    headers: jsonArquivo(),
    body: JSON.stringify({ expiresIn: VALIDADE, paths: caminhos }),
  });
  const mapa = {};
  (Array.isArray(r) ? r : []).forEach((x) => {
    const assinada = x && (x.signedURL || x.signedUrl);
    if (!assinada) return;
    mapa[x.path] = assinada.charAt(0) === "/" ? `${STORAGE()}${assinada}` : assinada;
  });
  return mapa;
}

async function apagarArquivo(caminho) {
  try {
    await arquivos(`${STORAGE()}/object/${BUCKET}/${paraURL(caminho)}`, {
      method: "DELETE",
      headers: hArquivo(),
    });
  } catch (e) {
    // Arquivo que já não existe é sucesso: o retry precisa convergir.
  }
}

/* ------------------ handler ------------------ */

const BUCKET_DOC = "documentos-veiculo";
const MAX_DOC = 10 * 1024 * 1024;      // o mesmo file_size_limit da 0008

// O que o bucket aceita (0008). PDF entra aqui e não no de fotos.
const TIPOS_DOC = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ROTULOS = [
  "CRLV", "CNH", "Identidade", "Comprovante de residência",
  "Laudo cautelar", "Comprovante de pagamento", "Outro",
];

/**
 * Anexos do negócio (0008): CRLV em PDF, CNH ou identidade do cliente,
 * comprovante de residência, laudo, comprovante de pagamento.
 *
 * Mora sob /api/foto porque é o arquivo que já fala com o Storage — e
 * porque a Vercel do plano Hobby para em 12 funções e nós estamos nas
 * 12. Acomodação de teto, não arquitetura.
 *
 * A chave de serviço continua sendo só para o Storage. O que protege é
 * a ordem: toda ida ao arquivo acontece depois de uma consulta ao banco
 * feita com o token do usuário — se a RLS não devolver o atendimento, a
 * função para antes de tocar no arquivo.
 *
 * **Aqui trafega documento de identidade.** Nada é escrito em log, o
 * bucket é privado e o link é assinado por uma hora. A conversa sobre
 * por quanto tempo isso pode ficar guardado é do jurídico — está em
 * PENDENCIAS.md.
 */
async function anexos(req, res, tok) {
  const assinarDoc = async (caminhos) => {
    if (!caminhos.length) return {};
    const r = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}`, {
      method: "POST", headers: jsonArquivo(),
      body: JSON.stringify({ expiresIn: VALIDADE, paths: caminhos }),
    });
    const mapa = {};
    (Array.isArray(r) ? r : []).forEach((x) => {
      const a = x && (x.signedURL || x.signedUrl);
      if (a) mapa[x.path] = a.charAt(0) === "/" ? `${STORAGE()}${a}` : a;
    });
    return mapa;
  };

  if (req.method === "GET") {
    const aid = String(req.query.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    const linhas = await banco(
      `${REST("anexo")}?select=*&atendimento_id=eq.${aid}&order=criado_em.desc`,
      { headers: cabecalhos(tok) }
    );
    const lista = Array.isArray(linhas) ? linhas : [];
    const urls = await assinarDoc(lista.map((x) => x.caminho));
    return res.status(200).json({
      anexos: lista.map((x) => ({ ...x, url: urls[x.caminho] || null })),
      rotulos: ROTULOS,
    });
  }

  if (req.method === "POST") {
    let corpo = req.body;
    if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
    if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
    if (!corpo || typeof corpo !== "object") return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    const aid = String(corpo.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

    const tipo = String(corpo.tipo || "");
    const ext = TIPOS_DOC[tipo];
    if (!ext) return res.status(415).json({ erro: "Só PDF, JPEG, PNG ou WEBP." });

    // Aqui não dá para conferir magic bytes como nas fotos: são quatro
    // formatos. O bucket da 0008 recusa o que não estiver na lista, e é
    // ele a última palavra.
    let bruto = String(corpo.dados || "").trim();
    const virgula = bruto.indexOf(",");
    if (bruto.slice(0, 5) === "data:" && virgula > 0) bruto = bruto.slice(virgula + 1);
    bruto = bruto.replace(/\s/g, "");
    if (!bruto || !/^[A-Za-z0-9+/]+={0,2}$/.test(bruto)) return res.status(400).json({ erro: "Arquivo vazio ou fora do formato." });
    const buf = Buffer.from(bruto, "base64");
    if (!buf.length) return res.status(400).json({ erro: "Arquivo vazio." });
    if (buf.length > MAX_DOC) return res.status(413).json({ erro: "Arquivo maior que 10 MB." });

    // A consulta pelo token confirma que o atendimento existe e que a
    // RLS deixa este usuário vê-lo. Só depois o arquivo sobe.
    const achado = await banco(`${REST("atendimento")}?select=id&id=eq.${aid}&limit=1`, { headers: cabecalhos(tok) });
    if (!Array.isArray(achado) || !achado[0]) return res.status(404).json({ erro: "Atendimento não encontrado." });

    const caminho = `${aid}/${Date.now()}-${sufixo()}.${ext}`;
    await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
      method: "POST",
      headers: hArquivo({ "Content-Type": tipo, "Cache-Control": "3600", "x-upsert": "false" }),
      body: buf,
    });

    let linha;
    try {
      const r = await banco(REST("anexo"), {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({
          atendimento_id: aid, caminho, tipo, bytes: buf.length,
          nome: String(corpo.nome || "").slice(0, 200) || null,
          rotulo: ROTULOS.indexOf(String(corpo.rotulo || "")) >= 0 ? corpo.rotulo : "Outro",
        }),
      });
      linha = Array.isArray(r) ? r[0] : r;
    } catch (e) {
      // Linha falhou depois do upload: o arquivo não pode ficar órfão.
      await apagarDoc(caminho);
      throw e;
    }

    const urls = await assinarDoc([caminho]);
    return res.status(201).json({ ok: true, anexo: { ...linha, url: urls[caminho] || null } });
  }

  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const achado = await banco(`${REST("anexo")}?select=caminho&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
    const alvo = Array.isArray(achado) && achado[0] ? achado[0].caminho : null;
    if (!alvo) return res.status(404).json({ erro: "Anexo não encontrado." });
    // Arquivo primeiro, linha depois: assim repetir a chamada converge.
    await apagarDoc(alvo);
    await banco(`${REST("anexo")}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos(tok) });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ erro: "Use GET, POST ou DELETE." });
}

async function apagarDoc(caminho) {
  try {
    await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
      method: "DELETE", headers: hArquivo(),
    });
  } catch (e) { /* já não existe é sucesso */ }
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !CHAVE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL, SUPABASE_ANON_KEY ou SUPABASE_SERVICE_KEY não configurados." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json(SEM_LOGIN);

  if (String(req.query.recurso || "") === "anexo") {
    try { return await anexos(req, res, tok); }
    catch (e) { return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no anexo." }); }
  }

  try {
    /* ---------- GET: fotos do veículo, em ordem ---------- */
    if (req.method === "GET") {
      const vid = String(req.query.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const linhas = await banco(
        `${REST("foto")}?select=id,caminho,ordem&veiculo_id=eq.${vid}&order=ordem.asc`,
        { headers: cabecalhos(tok) }
      ) || [];

      const links = await assinar(linhas.map((l) => l.caminho));
      return res.status(200).json({
        fotos: linhas.map((l) => ({ id: l.id, caminho: l.caminho, ordem: l.ordem, url: links[l.caminho] || null })),
      });
    }

    /* ---------- POST: sobe a imagem e grava a linha ---------- */
    if (req.method === "POST") {
      let corpo = req.body;
      if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
      if (!corpo || typeof corpo !== "object") {
        return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
      }

      const vid = String(corpo.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const imagem = decodificar(corpo.imagem_base64);
      if (!imagem) return res.status(400).json({ erro: "Imagem vazia ou não é JPEG." });
      if (imagem.length > MAX_BYTES) return res.status(413).json({ erro: "Imagem grande demais." });

      // A placa vem do banco: é ela que nomeia a pasta, e a busca já
      // confirma que o veículo existe.
      const achado = await banco(`${REST("veiculo")}?select=placa&id=eq.${vid}&limit=1`, { headers: cabecalhos(tok) });
      const placa = Array.isArray(achado) && achado[0] ? achado[0].placa : null;
      if (!placa) return res.status(404).json({ erro: "Veículo não encontrado. Salve a ficha antes das fotos." });

      const ordem = Number.isFinite(Number(corpo.ordem)) ? Math.trunc(Number(corpo.ordem)) : 0;
      const medida = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.trunc(Number(v)) : null);
      const caminho = `${String(placa).replace(/[^A-Za-z0-9]/g, "")}/${Date.now()}-${sufixo()}.jpg`;

      await arquivos(`${STORAGE()}/object/${BUCKET}/${paraURL(caminho)}`, {
        method: "POST",
        headers: hArquivo({ "Content-Type": "image/jpeg", "Cache-Control": "3600", "x-upsert": "false" }),
        body: imagem,
      });

      let linha;
      try {
        const r = await banco(REST("foto"), {
          method: "POST",
          headers: json(tok, { Prefer: "return=representation" }),
          body: JSON.stringify({
            veiculo_id: vid, caminho, ordem,
            largura: medida(corpo.largura), altura: medida(corpo.altura),
            bytes: imagem.length,
          }),
        });
        linha = Array.isArray(r) ? r[0] : r;
      } catch (e) {
        // Linha não gravou: o arquivo não pode ficar órfão no bucket.
        await apagarArquivo(caminho);
        throw e;
      }

      const links = await assinar([caminho]);
      return res.status(201).json({
        ok: true,
        id: linha ? linha.id : null,
        caminho,
        ordem,
        url: links[caminho] || null,
      });
    }

    /* ---------- PATCH: reordenar / definir capa ---------- */
    if (req.method === "PATCH") {
      let corpo = req.body;
      if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
      const ordens = corpo && Array.isArray(corpo.ordens) ? corpo.ordens : null;
      if (!ordens || !ordens.length) return res.status(400).json({ erro: "Mande ordens: [{ id, ordem }]." });

      const alvos = [];
      for (const o of ordens) {
        const id = String((o && o.id) || "");
        if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id de foto inválido." });
        alvos.push({ id, ordem: Math.trunc(Number(o.ordem) || 0) });
      }

      // O índice único (veiculo_id, ordem) não é deferrable: trocar a
      // capa passando 2→0 esbarra em quem ainda está no 0. Por isso a
      // troca acontece em duas voltas — todo mundo estaciona no
      // negativo, que ninguém usa, e só depois assume a posição final.
      const mover = (id, ordem) => banco(`${REST("foto")}?id=eq.${id}`, {
        method: "PATCH",
        headers: json(tok),
        body: JSON.stringify({ ordem }),
      });

      for (let i = 0; i < alvos.length; i++) await mover(alvos[i].id, -(i + 1));
      for (const a of alvos) await mover(a.id, a.ordem);

      return res.status(200).json({ ok: true, atualizadas: alvos.length });
    }

    /* ---------- DELETE: some do Storage e da tabela ---------- */
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });

      const achado = await banco(`${REST("foto")}?select=caminho&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
      const caminho = Array.isArray(achado) && achado[0] ? achado[0].caminho : null;
      if (!caminho) return res.status(404).json({ erro: "Foto não encontrada." });

      // Arquivo primeiro: se a linha falhar, o retry converge.
      await apagarArquivo(caminho);
      await banco(`${REST("foto")}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos(tok) });
      return res.status(200).json({ ok: true, id });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha na operação com a foto." });
  }
};
