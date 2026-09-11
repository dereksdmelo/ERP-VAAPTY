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
  "Laudo cautelar", "Comprovante de pagamento", "Contrato assinado", "Outro",
];

/**
 * O envio do carro para o Shinkai.
 *
 * **Por que isto mora no api/foto.js e não no api/veiculo.js**, que é
 * onde o estoque vive: o Shinkai pede as fotos como URLs que ele possa
 * baixar, e o bucket é privado. Assinar link é a única coisa que usa a
 * `SUPABASE_SERVICE_KEY`, e a decisão 9 confina essa chave a este
 * arquivo. Levar o envio para outro lugar significaria espalhar a
 * chave — que é exatamente o que aquela decisão evita.
 *
 * O link assinado vale 1 h. É de sobra: o Shinkai **baixa e guarda
 * cópia** na hora do POST, então o que precisa estar de pé é o momento
 * da chamada, não o dia seguinte.
 *
 * A chave da conta (`SHINKAI_API_KEY`) só existe em variável de
 * ambiente. Não está no repositório, não vai ao navegador, não aparece
 * em log — mesma regra do ZapSign. O GET responde apenas se ela
 * existe, nunca o valor: sem esse teste, descobrir que a variável não
 * subiu seria errar com o carro já no pátio.
 */
const SHINKAI_URL = "https://www.shinkai.com.br/api/public/veiculo";
const SHINKAI_KEY = process.env.SHINKAI_API_KEY || "";
const SHINKAI_ORIGEM = process.env.SHINKAI_ORIGEM || "vaapty-joinville";

const numeroOuNulo = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function shinkai(req, res, tok) {
  if (req.method === "GET") return res.status(200).json({ configurado: !!SHINKAI_KEY });
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Use GET ou POST." });
  }
  if (!SHINKAI_KEY) {
    return res.status(503).json({
      erro: "A chave do Shinkai não está configurada. Ela vai em SHINKAI_API_KEY, nas variáveis de ambiente da Vercel.",
    });
  }

  // ---------------------------------------------------------------
  // Dois caminhos, e são dois momentos diferentes da vida do carro.
  //
  //   veiculo_id — o LANÇAMENTO: a ficha em avaliação, com o cliente
  //                na mesa, indo à rede para receber proposta. O carro
  //                ainda não é nosso, então não há valor de compra —
  //                e é por isso que o Shinkai o recebe como "em
  //                avaliação", que é o estado certo para ele.
  //   estoque_id — a VENDA: o carro já comprado, com valor de compra,
  //                indo à rede para ser repassado.
  //
  // O resultado de cada um fica na sua própria linha (0030 e 0039):
  // são dois envios com respostas diferentes, e misturá-los faria
  // "já está lá" responder pela viagem errada.
  // ---------------------------------------------------------------
  const eid = String(req.query.estoque_id || "");
  const vid = String(req.query.veiculo_id || "");
  if (!RX_UUID.test(eid) && !RX_UUID.test(vid)) {
    return res.status(400).json({ erro: "Informe estoque_id ou veiculo_id." });
  }

  const CAMPOS_V = "id,placa,chassi,marca_modelo,ano_fabricacao,ano_modelo,cor,combustivel," +
    "cambio,km_atual,fipe_codigo,fipe_valor,leilao_sinistro,gnv," +
    // O carro chegava pelado do outro lado: pneu, opcional e ressalva
    // ficavam de fora do corpo, e são justamente os campos que a tela
    // deles pede para o carro poder ser ofertado.
    "pneu_de,pneu_dd,pneu_te,pneu_td,opcionais,gastos_descricao,ressalvas_lojista,pontos_positivos";

  // A leitura vai pelo TOKEN DO USUÁRIO: é a RLS que decide se esta
  // pessoa enxerga este carro. A chave de serviço entra depois, e só
  // para assinar os links das fotos.
  let e = null, v = null;
  if (RX_UUID.test(eid)) {
    const achado = await banco(
      `${REST("estoque")}?select=id,valor_compra,preco_pedido,veiculo(${CAMPOS_V})&id=eq.${eid}&limit=1`,
      { headers: cabecalhos(tok) }
    );
    e = Array.isArray(achado) ? achado[0] : null;
    if (!e || !e.veiculo) return res.status(404).json({ erro: "Carro não encontrado no estoque." });
    v = e.veiculo;
  } else {
    const achado = await banco(
      `${REST("veiculo")}?select=${CAMPOS_V},valor_por&id=eq.${vid}&limit=1`,
      { headers: cabecalhos(tok) }
    );
    v = Array.isArray(achado) ? achado[0] : null;
    if (!v) return res.status(404).json({ erro: "Ficha não encontrada." });
  }
  if (!v.placa) return res.status(400).json({ erro: "O carro precisa de placa para ir ao Shinkai." });

  const fotos = await banco(
    `${REST("foto")}?select=caminho,ordem&veiculo_id=eq.${v.id}&order=ordem.asc`,
    { headers: cabecalhos(tok) }
  ) || [];
  const links = await assinar(fotos.map((f) => f.caminho));
  const urls = fotos.map((f) => links[f.caminho]).filter(Boolean);

  // O ano vai como "2009/2010" quando os dois diferem — é o formato que
  // eles leem e devolvem separado.
  const ano = v.ano_fabricacao && v.ano_modelo && v.ano_fabricacao !== v.ano_modelo
    ? `${v.ano_fabricacao}/${v.ano_modelo}`
    : String(v.ano_modelo || v.ano_fabricacao || "");

  const corpo = {
    origem: SHINKAI_ORIGEM,
    veiculo: {
      placa: v.placa,
      chassi: v.chassi || undefined,
      // `marca_modelo` inteiro: a nossa coluna é uma string só, e a
      // documentação diz que eles separam. Mandar um "marca" chutado a
      // partir do primeiro token erraria em Land Rover e Alfa Romeo —
      // o mesmo tropeço dos canais de preço.
      marca_modelo: v.marca_modelo || undefined,
      ano_modelo: ano || undefined,
      cor: v.cor || undefined,
      combustivel: v.combustivel || undefined,
      cambio: v.cambio || undefined,
      km_atual: numeroOuNulo(v.km_atual) || undefined,
      fipe_codigo: v.fipe_codigo || undefined,
      fipe_valor: numeroOuNulo(v.fipe_valor) || undefined,
      // "o que a loja pagou … é o alvo da negociação", pela
      // documentação deles. Comprado, é o `valor_compra`; ainda em
      // avaliação não há o que a loja pagou, e o alvo é o POR — o
      // número que o negociador quer ver voltar da rede. Sem nenhum
      // dos dois o Shinkai recebe o carro como "em avaliação", e diz
      // isso nos avisos.
      valor_investimento: numeroOuNulo(e ? e.valor_compra : v.valor_por) || undefined,
      // `leilao` e `sinistro` separados também, porque a documentação
      // diz que eles aceitam os dois formatos e o nosso é um só.
      leilao_sinistro: !!v.leilao_sinistro,
      leilao: !!v.leilao_sinistro,
      sinistro: !!v.leilao_sinistro,
      gnv: !!v.gnv,
      // Padrão da documentação; explícito porque a Vaapty também
      // avalia moto, e o dia em que isso virar campo na tela o lugar
      // já está aqui.
      tipo_veiculo: "carros",
      // Os quatro pneus, com os nomes que a tela deles usa. Iam de
      // fora do corpo até 11/09/2026 — o carro entrava sem condição de
      // pneu nenhuma.
      pneus: {
        dianteiro_esquerdo: v.pneu_de || undefined,
        dianteiro_direito: v.pneu_dd || undefined,
        traseiro_esquerdo: v.pneu_te || undefined,
        traseiro_direito: v.pneu_td || undefined,
      },
      opcionais: Array.isArray(v.opcionais) && v.opcionais.length ? v.opcionais : undefined,
      gastos: v.gastos_descricao || undefined,
      // Ressalva vai; observação interna NUNCA (decisão 2). O Shinkai
      // é a plataforma da casa, mas o que está nesse campo foi escrito
      // para ser lido pelo lojista, e o outro não.
      ressalvas: Array.isArray(v.ressalvas_lojista) && v.ressalvas_lojista.length ? v.ressalvas_lojista : undefined,
      pontos_positivos: Array.isArray(v.pontos_positivos) && v.pontos_positivos.length ? v.pontos_positivos : undefined,
      fotos: urls.length ? urls : undefined,
    },
  };

  let r;
  try {
    r = await fetch(SHINKAI_URL, {
      method: "POST",
      headers: { "x-api-key": SHINKAI_KEY, "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch (err) {
    return res.status(502).json({ erro: "Não consegui falar com o Shinkai." });
  }
  const texto = await r.text();
  let d = null;
  try { d = texto ? JSON.parse(texto) : null; } catch (err) {}

  if (!r.ok) {
    // Os erros de campo vêm em `erros`, e é isso que resolve o problema
    // de quem está com o carro na frente. Engolir a lista e dizer só
    // "falhou" obrigaria a abrir o log da Vercel.
    const detalhe = d && Array.isArray(d.erros) ? d.erros.join(" · ") : "";
    const msg = r.status === 401 ? "O Shinkai recusou a chave (401). Confira SHINKAI_API_KEY."
      : r.status === 422 ? `O Shinkai não aceitou os dados: ${detalhe || "sem detalhe"}`
      : `O Shinkai respondeu ${r.status}.${detalhe ? ` ${detalhe}` : ""}`;
    return res.status(502).json({ erro: limpar(msg), erros: (d && d.erros) || null });
  }

  // O que voltou fica gravado: sem isso ninguém sabe se o carro já
  // está lá, e reenviar vira adivinhação.
  // O endereço do carro na plataforma deles, que é o que o descritivo
  // leva ao grupo dos lojistas. A resposta DOCUMENTADA não traz isso —
  // então procuro os nomes plausíveis e aceito o primeiro que vier, em
  // vez de montar a URL a partir do `id`: chutar o formato do site
  // deles poria link quebrado no grupo. Enquanto nenhum vier, fica
  // nulo e o descritivo diz que o link ainda não existe.
  const endereco = (() => {
    if (!d) return null;
    for (const k of ["url", "link", "permalink", "oferta_url", "veiculo_url", "url_publica"]) {
      const u = d[k];
      if (typeof u === "string" && /^https?:\/\//i.test(u)) return u.slice(0, 500);
    }
    return null;
  })();

  const marca = {
    shinkai_id: (d && d.id) || null,
    shinkai_status: (d && d.status) || null,
    shinkai_url: endereco,
    shinkai_em: new Date().toISOString(),
  };
  // Duas tentativas, e a segunda é sem o endereço. `shinkai_url` é
  // coluna nova (0040): num banco que ainda não a tenha, o PATCH
  // inteiro seria recusado e levaria junto o `shinkai_em` — que é o
  // que libera o descritivo. Mesmo remédio do casamento de títulos na
  // decisão 29: o que se perde é só a amarração, nunca o principal.
  const alvo = e ? `${REST("estoque")}?id=eq.${eid}` : `${REST("veiculo")}?id=eq.${v.id}`;
  try {
    await banco(alvo, { method: "PATCH", headers: json(tok), body: JSON.stringify(marca) });
  } catch (err) {
    const { shinkai_url, ...semUrl } = marca;
    await banco(alvo, { method: "PATCH", headers: json(tok), body: JSON.stringify(semUrl) }).catch(() => {});
  }

  return res.status(200).json({
    ok: true,
    id: d && d.id, acao: d && d.acao, status: d && d.status,
    url: endereco,
    fotos: d && d.fotos, avisos: (d && d.avisos) || [],
    fotos_enviadas: urls.length,
  });
}

const ZAPSIGN = "https://api.zapsign.com.br/api/v1";
const ZAP_TOKEN = process.env.ZAPSIGN_TOKEN || "";

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

    /* Guardar o contrato assinado.
     *
     * O webhook só marca a data: ele chega sem login e não pode escrever
     * arquivo. Aqui há sessão, então é onde a via assinada entra para o
     * bucket e vira anexo como qualquer outro documento do negócio.
     *
     * Sem isto, "assinado" seria uma data no banco e um PDF que só
     * existe dentro do ZapSign — e contrato que a casa não tem em mãos
     * não serve quando alguém pede. */
    if (String(req.query.acao || "") === "contrato-assinado") {
      if (!ZAP_TOKEN) return res.status(503).json({ erro: "A chave do ZapSign não está configurada." });

      // Idempotente: repetir o botão não empilha vias.
      const jaTem = await banco(
        `${REST("anexo")}?select=id&atendimento_id=eq.${aid}&rotulo=eq.${encodeURIComponent("Contrato assinado")}&limit=1`,
        { headers: cabecalhos(tok) }
      );
      if (Array.isArray(jaTem) && jaTem[0]) {
        return res.status(200).json({ ok: true, ja_guardado: true });
      }

      // A leitura pelo token do usuário é o que confirma o acesso.
      const at = await banco(
        `${REST("atendimento")}?select=contrato_zapsign_token,contrato_assinado_em&id=eq.${aid}&limit=1`,
        { headers: cabecalhos(tok) }
      );
      const linhaAt = Array.isArray(at) ? at[0] : null;
      const zapTok = linhaAt && linhaAt.contrato_zapsign_token;
      if (!zapTok) return res.status(404).json({ erro: "Este atendimento não tem contrato no ZapSign." });

      let doc;
      try {
        const r = await fetch(`${ZAPSIGN}/docs/${encodeURIComponent(zapTok)}/`, {
          headers: { Authorization: `Bearer ${ZAP_TOKEN}` },
        });
        if (!r.ok) return res.status(502).json({ erro: "O ZapSign não devolveu o documento." });
        doc = await r.json();
      } catch (e) {
        return res.status(502).json({ erro: "Não consegui falar com o ZapSign." });
      }

      if (String(doc.status || "").toLowerCase() !== "signed") {
        return res.status(409).json({ erro: "O contrato ainda não está assinado no ZapSign." });
      }
      const urlPdf = doc.signed_file || doc.original_file;
      if (!urlPdf) return res.status(502).json({ erro: "O ZapSign não devolveu o arquivo assinado." });

      let pdf;
      try {
        const r = await fetch(urlPdf);
        if (!r.ok) throw new Error("download");
        pdf = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        return res.status(502).json({ erro: "Não consegui baixar o contrato assinado." });
      }
      if (!pdf.length || pdf.length > MAX_DOC) {
        return res.status(413).json({ erro: "Arquivo assinado vazio ou maior que 10 MB." });
      }

      const caminhoAss = `${aid}/${Date.now()}-${sufixo()}.pdf`;
      await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminhoAss)}`, {
        method: "POST",
        headers: hArquivo({ "Content-Type": "application/pdf", "Cache-Control": "3600", "x-upsert": "false" }),
        body: pdf,
      });

      let salvo;
      try {
        const r = await banco(REST("anexo"), {
          method: "POST",
          headers: json(tok, { Prefer: "return=representation" }),
          body: JSON.stringify({
            atendimento_id: aid, caminho: caminhoAss, tipo: "application/pdf",
            bytes: pdf.length, nome: "contrato-assinado.pdf", rotulo: "Contrato assinado",
          }),
        });
        salvo = Array.isArray(r) ? r[0] : r;
      } catch (e) {
        await apagarDoc(caminhoAss);
        throw e;
      }

      const urls = await assinarDoc([caminhoAss]);
      return res.status(201).json({ ok: true, anexo: { ...salvo, url: urls[caminhoAss] || null } });
    }

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
          // "doc:<item>" é o anexo de um item do check list de
          // documentações (0027): o rótulo é o código do item, e a lista
          // deles vive no api/checklist.js, não aqui.
          rotulo: /^doc:[a-z_]{2,40}$/.test(String(corpo.rotulo || "")) ? corpo.rotulo
            : ROTULOS.indexOf(String(corpo.rotulo || "")) >= 0 ? corpo.rotulo : "Outro",
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

  if (String(req.query.recurso || "") === "shinkai") {
    try { return await shinkai(req, res, tok); }
    catch (e) { return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no envio ao Shinkai." }); }
  }

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
