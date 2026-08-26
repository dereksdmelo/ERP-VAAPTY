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
 * Depende da migração 0002: tabela `foto` com as colunas
 * id, veiculo_id, caminho, ordem.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_KEY || "";

const BUCKET = "fotos-veiculo";
const VALIDADE = 3600;                 // 1 hora de link assinado
const MAX_BYTES = 6 * 1024 * 1024;     // uma foto de 1280 px pesa ~300 KB

const REST = (tabela) => `${URL_BASE}/rest/v1/${tabela}`;
const STORAGE = () => `${URL_BASE}/storage/v1`;

const cabecalhos = (extra) => ({ apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, ...extra });
const json = (extra) => cabecalhos({ "Content-Type": "application/json", ...extra });

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
    headers: json(),
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
      headers: cabecalhos(),
    });
  } catch (e) {
    // Arquivo que já não existe é sucesso: o retry precisa convergir.
  }
}

/* ------------------ handler ------------------ */

module.exports = async function handler(req, res) {
  if (!URL_BASE || !CHAVE) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_SERVICE_KEY não configurados." });
  }

  try {
    /* ---------- GET: fotos do veículo, em ordem ---------- */
    if (req.method === "GET") {
      const vid = String(req.query.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const linhas = await banco(
        `${REST("foto")}?select=id,caminho,ordem&veiculo_id=eq.${vid}&order=ordem.asc`,
        { headers: cabecalhos() }
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
      const achado = await banco(`${REST("veiculo")}?select=placa&id=eq.${vid}&limit=1`, { headers: cabecalhos() });
      const placa = Array.isArray(achado) && achado[0] ? achado[0].placa : null;
      if (!placa) return res.status(404).json({ erro: "Veículo não encontrado. Salve a ficha antes das fotos." });

      const ordem = Number.isFinite(Number(corpo.ordem)) ? Math.trunc(Number(corpo.ordem)) : 0;
      const caminho = `${String(placa).replace(/[^A-Za-z0-9]/g, "")}/${Date.now()}-${sufixo()}.jpg`;

      await arquivos(`${STORAGE()}/object/${BUCKET}/${paraURL(caminho)}`, {
        method: "POST",
        headers: cabecalhos({ "Content-Type": "image/jpeg", "Cache-Control": "3600", "x-upsert": "false" }),
        body: imagem,
      });

      let linha;
      try {
        const r = await banco(REST("foto"), {
          method: "POST",
          headers: json({ Prefer: "return=representation" }),
          body: JSON.stringify({ veiculo_id: vid, caminho, ordem }),
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

      for (const o of ordens) {
        const id = String(o && o.id || "");
        if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id de foto inválido." });
        await banco(`${REST("foto")}?id=eq.${id}`, {
          method: "PATCH",
          headers: json(),
          body: JSON.stringify({ ordem: Math.trunc(Number(o.ordem) || 0) }),
        });
      }
      return res.status(200).json({ ok: true, atualizadas: ordens.length });
    }

    /* ---------- DELETE: some do Storage e da tabela ---------- */
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });

      const achado = await banco(`${REST("foto")}?select=caminho&id=eq.${id}&limit=1`, { headers: cabecalhos() });
      const caminho = Array.isArray(achado) && achado[0] ? achado[0].caminho : null;
      if (!caminho) return res.status(404).json({ erro: "Foto não encontrada." });

      // Arquivo primeiro: se a linha falhar, o retry converge.
      await apagarArquivo(caminho);
      await banco(`${REST("foto")}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos() });
      return res.status(200).json({ ok: true, id });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha na operação com a foto." });
  }
};
