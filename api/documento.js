/**
 * /api/documento — registro dos documentos gerados no atendimento.
 *
 * POST { veiculo_id, tipo, rodada, protocolo, conteudo, negociador }
 *      grava uma linha. Cada geração é um evento; segunda via é linha
 *      nova, com protocolo novo.
 * GET  ?veiculo_id=   o que já foi gerado, do mais recente para o mais
 *      antigo, sem o conteúdo (que é grande e ninguém lê em lista).
 *
 * Mesmas regras do resto de api/: fetch puro, sem biblioteca, e a chave
 * de serviço não sai daqui — nem em resposta, nem em log.
 *
 * Depende da migração 0003.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_KEY || "";

const TIPOS = ["termo_aceite", "autorizacao_cautelar", "pre_contrato", "check_list", "extrato_ofertas", "extrato_revisao", "contrato_final"];
const MAX_CONTEUDO = 200 * 1024;   // o modelo maior hoje dá ~9 KB

const REST = (tabela) => `${URL_BASE}/rest/v1/${tabela}`;
const ANON = process.env.SUPABASE_ANON_KEY || "";

/**
 * O token do usuário logado, repassado como veio. Quem valida é o
 * PostgREST: token inválido volta 401 e a gente devolve isso ao
 * cliente. Verificar assinatura aqui seria refazer, sem biblioteca, o
 * que o banco já faz.
 *
 * O token NÃO pode virar variável de módulo: duas requisições
 * simultâneas na mesma instância trocariam de usuário.
 */
const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const SEM_LOGIN = { erro: "Sessão expirada. Entre de novo." };

const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

const limpar = (s) => {
  const t = String(s == null ? "" : s);
  return CHAVE ? t.split(CHAVE).join("[oculto]") : t;
};

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};

async function banco(url, opcoes) {
  let r;
  try {
    r = await fetch(url, opcoes);
  } catch (e) {
    const erro = new Error("Não consegui falar com o banco.");
    erro.status = 502;
    throw erro;
  }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a gravação.";
    const erro = new Error(limpar(msg));
    erro.status = r.status === 401 || r.status === 403 ? 500 : 502;
    throw erro;
  }
  return dado;
}

const ZAPSIGN = "https://api.zapsign.com.br/api/v1";
const ZAP_TOKEN = process.env.ZAPSIGN_TOKEN || "";

/**
 * ---------------- assinatura eletrônica (ZapSign) ----------------
 *
 * A cláusula décima quinta do contrato reconhece assinatura eletrônica;
 * isto é o que a executa.
 *
 * **A chave da conta mora só aqui, em variável de ambiente.** Ela não
 * está no repositório, não vai ao navegador e não aparece em log —
 * mesma regra da PLACAFIPE_TOKEN e da chave de serviço do Supabase.
 *
 * O documento vai como `markdown_text`, que a API aceita. Foi o que
 * evitou depender de gerar PDF no servidor: sem biblioteca, e este
 * projeto não tem nenhuma de propósito, isso não teria saída.
 *
 * O contrato tem uma fonte só — o HTML que a tela imprime. `emMarkdown`
 * converte na hora do envio. Manter duas versões do mesmo texto
 * jurídico seria repetir a armadilha do documentos.js: duas cópias que
 * divergem sem ninguém perceber.
 */

// Converte o HTML dos nossos documentos em Markdown. Não é conversor
// geral: conhece só as tags que `moldura` produz, e é isso que o torna
// confiável.
function emMarkdown(html) {
  let t = String(html || "");
  t = t.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<head[\s\S]*?<\/head>/gi, "");
  t = t.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (m, x) => `\n\n# ${x.replace(/<br\s*\/?>/gi, " ")}\n\n`);
  t = t.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (m, linha) => {
    const cels = [];
    linha.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, (mm, c) => { cels.push(c); return ""; });
    return `\n${cels.join(": ")}\n`;
  });
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/p>/gi, "\n\n");
  t = t.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  t = t.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "_$1_");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  return t.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim())
          .join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function zapsign(req, res, tok) {
  // GET é o teste de saúde: diz se a chave existe, sem nunca devolvê-la.
  // Sem isto, a única forma de descobrir que a variável não subiu seria
  // errar na frente do cliente, na hora de mandar o contrato.
  if (req.method === "GET") {
    return res.status(200).json({ configurado: !!ZAP_TOKEN });
  }

  if (!ZAP_TOKEN) {
    return res.status(503).json({
      erro: "A chave do ZapSign não está configurada. Ela vai em ZAPSIGN_TOKEN, nas variáveis de ambiente da Vercel.",
    });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Use GET ou POST." });
  }

  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  if (!c || typeof c !== "object") return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

  const aid = String(c.atendimento_id || "");
  if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

  const markdown = emMarkdown(c.conteudo);
  if (markdown.length < 200) return res.status(400).json({ erro: "Contrato vazio ou curto demais." });

  const assinantes = (Array.isArray(c.signatarios) ? c.signatarios : [])
    .map((x) => ({
      name: texto(x.nome),
      email: texto(x.email),
      phone_country: texto(x.email) ? null : "55",
      phone_number: texto(x.email) ? null : String(x.telefone || "").replace(/\D/g, "") || null,
    }))
    .filter((x) => x.name && (x.email || x.phone_number));

  if (!assinantes.length) {
    return res.status(400).json({ erro: "Informe ao menos um signatário com e-mail ou telefone." });
  }

  // A leitura pelo token do usuário é o que confirma que ele enxerga
  // este atendimento. Só depois o documento vai para fora.
  const achado = await banco(`${REST("atendimento")}?select=id&id=eq.${aid}&limit=1`, { headers: cabecalhos(tok) });
  if (!Array.isArray(achado) || !achado[0]) return res.status(404).json({ erro: "Atendimento não encontrado." });

  let criado;
  try {
    const r = await fetch(`${ZAPSIGN}/docs/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ZAP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(c.nome || "Contrato de compra e venda").slice(0, 255),
        markdown_text: markdown,
        signers: assinantes,
        lang: "pt-br",
      }),
    });
    const corpo = await r.text();
    let d = null;
    try { d = corpo ? JSON.parse(corpo) : null; } catch (e) {}
    if (!r.ok) {
      // A mensagem do ZapSign volta ao negociador, mas nunca a chave.
      const msg = (d && (d.message || d.detail || d.error)) || "O ZapSign recusou o documento.";
      return res.status(r.status === 401 ? 401 : 502).json({ erro: String(msg).slice(0, 300) });
    }
    criado = d;
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com o ZapSign." });
  }

  const zapToken = criado && (criado.token || criado.doc_token);
  if (zapToken) {
    // Sem isto o webhook não teria como saber de que atendimento o
    // documento assinado é.
    await banco(`${REST("atendimento")}?id=eq.${aid}`, {
      method: "PATCH",
      headers: json(tok),
      body: JSON.stringify({ contrato_zapsign_token: zapToken, contrato_enviado_em: new Date().toISOString() }),
    }).catch(() => {});
  }

  const links = (criado && Array.isArray(criado.signers) ? criado.signers : [])
    .map((x) => ({ nome: x.name, link: x.sign_url }))
    .filter((x) => x.link);

  return res.status(201).json({ ok: true, token: zapToken || null, assinantes: links });
}

/**
 * O aviso de que o contrato foi assinado.
 *
 * Chega **sem login**: o ZapSign não conhece o token do usuário. Duas
 * coisas seguram isso de pé:
 *
 *   1. o que o corpo diz não é acreditado. O status é confirmado
 *      consultando o próprio ZapSign com a nossa chave — quem mandar um
 *      POST à toa não marca contrato nenhum como assinado;
 *   2. a escrita passa por `marcar_contrato_assinado` (0015), que só
 *      sabe fazer isso e só para token que já foi gravado no envio. A
 *      chave de serviço continua fora daqui.
 */
async function zapsignWebhook(req, res) {
  // Responder 200 sempre: webhook que recebe erro entra em repetição, e
  // não há nada que o ZapSign possa fazer com a nossa falha.
  const ok = () => res.status(200).json({ ok: true });
  if (req.method !== "POST") return ok();
  if (!ZAP_TOKEN || !URL_BASE || !ANON) return ok();

  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  if (!c || typeof c !== "object") return ok();

  const tokenDoc = String((c.token || c.doc_token || (c.doc && c.doc.token) || "")).trim();
  if (tokenDoc.length < 10) return ok();

  try {
    const r = await fetch(`${ZAPSIGN}/docs/${encodeURIComponent(tokenDoc)}/`, {
      headers: { Authorization: `Bearer ${ZAP_TOKEN}` },
    });
    if (!r.ok) return ok();
    const doc = await r.json().catch(() => null);
    if (!doc || String(doc.status || "").toLowerCase() !== "signed") return ok();

    await fetch(`${URL_BASE}/rest/v1/rpc/marcar_contrato_assinado`, {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ tok: tokenDoc }),
    });
  } catch (e) { /* o ZapSign repete; não há o que devolver */ }

  return ok();
}

/**
 * ===== assinatura eletrônica própria (0048) =====
 *
 * Três recursos, e dois deles são PÚBLICOS: o signatário é um cliente
 * sem login. Eles vêm antes da checagem de token, como o webhook.
 *
 * **Nenhum deles usa a chave de serviço.** Tudo passa pelas funções
 * `security definer` da 0048, chamadas com a chave anônima — elas é
 * que conferem o token do link e decidem o que devolver. Uma rota
 * pública com a chave de serviço abriria a tabela `atendimento`
 * inteira, com CPF e telefone de cliente.
 *
 * **O IP é lido da requisição, nunca do corpo.** Evidência que a parte
 * interessada digita não é evidência — é a recomendação 4.3 da
 * especificação, e o ERP de origem não a segue.
 */
// Este arquivo não tem `lerCorpo` — cada rota desembrulha o corpo na
// mão. Com quatro rotas novas, vale o helper; sem ele, o primeiro
// teste no ar devolveu "lerCorpo is not defined".
function corpoDe(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : null;
}

const ipDe = (req) => {
  const x = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return x || String(req.headers["x-real-ip"] || "") || "";
};
const localDe = (req) => {
  // A Vercel entrega a geolocalização da borda em cabeçalhos próprios.
  const cidade = decodeURIComponent(String(req.headers["x-vercel-ip-city"] || ""));
  const uf = String(req.headers["x-vercel-ip-country-region"] || "");
  const pais = String(req.headers["x-vercel-ip-country"] || "");
  return [cidade, uf, pais].filter(Boolean).join(", ");
};

async function rpc(nome, corpo) {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  let d = null;
  try { d = texto ? JSON.parse(texto) : null; } catch (e) {}
  if (!r.ok) {
    const e = new Error((d && (d.message || d.hint)) || "Falhou.");
    e.status = r.status === 404 ? 404 : 400;
    throw e;
  }
  return d;
}

// Abrir o link (público). O token vai no CORPO, não na query: query
// entra em log de servidor, de proxy e no cabeçalho Referer.
async function abrirAssinatura(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
  const c = corpoDe(req);
  const token = String((c && c.token) || "");
  if (token.length < 32) return res.status(400).json({ erro: "Link inválido." });

  const linhas = await rpc("abrir_link_assinatura", { p_token: token });
  const l = (Array.isArray(linhas) ? linhas[0] : linhas) || null;
  if (!l) return res.status(404).json({ erro: "Este link não existe ou já não vale." });

  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    situacao: l.situacao, tipo: l.tipo, conteudo: l.conteudo,
    nome_esperado: l.nome_esperado, expira_em: l.expira_em, codigo: l.codigo_existente,
  });
}

// Gravar a assinatura (público, com o token).
async function assinarPublico(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
  const c = corpoDe(req);
  if (!c) return res.status(400).json({ erro: "Corpo vazio." });

  const d = await rpc("gravar_assinatura", {
    p_token: String(c.token || ""),
    p_nome: String(c.nome || ""),
    p_documento: String(c.documento || ""),
    p_email: String(c.email || ""),
    p_telefone: String(c.telefone || ""),
    p_aceite: String(c.aceite || ""),
    p_pdf_sha: String(c.pdf_sha256 || ""),
    p_conteudo_sha: String(c.conteudo_sha256 || ""),
    p_pdf_caminho: c.pdf_caminho || null,
    p_png_caminho: c.png_caminho || null,
    // Estes três vêm daqui, não do cliente.
    p_ip: ipDe(req),
    p_local: localDe(req),
    p_user_agent: String(req.headers["user-agent"] || ""),
    p_hora_cliente: String(c.hora_cliente || ""),
    p_fuso_cliente: String(c.fuso_cliente || ""),
    p_evidencias: c.evidencias || {},
  });
  const a = (Array.isArray(d) ? d[0] : d) || null;
  if (!a) return res.status(400).json({ erro: "Não consegui registrar." });
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, codigo: a.codigo, assinado_em: a.assinado_em });
}

// Verificar (público, sem token). É a prova que o cliente mostra.
async function verificarPublico(req, res) {
  const cod = String(req.query.c || "").trim();
  if (!/^VPT-[A-Z0-9]{6,12}$/i.test(cod)) return res.status(400).json({ erro: "Código inválido." });
  const d = await rpc("verificar_assinatura", { p_codigo: cod });
  const a = (Array.isArray(d) ? d[0] : d) || null;
  // Resposta uniforme: não dizer se o código existe ou não impediria a
  // pessoa de saber que digitou errado. Aqui dizer é o certo — o
  // código é protocolo, não segredo.
  if (!a) return res.status(404).json({ erro: "Código não encontrado." });
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");
  return res.status(200).json({ assinatura: a });
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  // O webhook chega sem login, então ele vem antes da checagem.
  if (String(req.query.recurso || "") === "zapsign-webhook") {
    return await zapsignWebhook(req, res);
  }

  // As rotas do signatário também chegam sem login, pelo mesmo motivo:
  // quem assina é o cliente, e ele não tem conta aqui.
  const pub = String(req.query.recurso || "");
  if (pub === "assinar-abrir" || pub === "assinar" || pub === "verificar") {
    try {
      if (pub === "assinar-abrir") return await abrirAssinatura(req, res);
      if (pub === "assinar") return await assinarPublico(req, res);
      return await verificarPublico(req, res);
    } catch (e) {
      return res.status(e.status || 400).json({ erro: limpar(e.message) || "Falhou." });
    }
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json(SEM_LOGIN);

  // Criar o convite é da equipe, e passa pelo token de quem pediu: a
  // função do banco confere `e_equipe()` com o JWT.
  if (String(req.query.recurso || "") === "assinar-link") {
    try {
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
      const c = corpoDe(req);
      const doc = String((c && c.documento_id) || "");
      if (!RX_UUID.test(doc)) return res.status(400).json({ erro: "documento_id inválido." });

      const r = await banco(`${URL_BASE}/rest/v1/rpc/criar_link_assinatura`, {
        method: "POST", headers: json(tok),
        body: JSON.stringify({
          p_documento: doc,
          p_nome: (c && c.nome) || null,
          p_telefone: (c && c.telefone) || null,
          p_dias: (c && Number(c.dias)) || 7,
        }),
      });
      const l = (Array.isArray(r) ? r[0] : r) || null;
      if (!l) return res.status(400).json({ erro: "Não consegui criar o link." });
      // **O token em claro passa por aqui uma única vez.** O banco só
      // guarda o hash dele; link perdido não se recupera, gera-se
      // outro. Por isso ele não vai para log nenhum.
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({ ok: true, id: l.id, token: l.token, expira_em: l.expira_em });
    } catch (e) {
      return res.status(e.status || 400).json({ erro: limpar(e.message) || "Falhou." });
    }
  }

  if (String(req.query.recurso || "") === "zapsign") {
    try { return await zapsign(req, res, tok); }
    catch (e) { return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no envio." }); }
  }

  try {
    if (req.method === "GET") {
      // Um documento com o conteúdo. A lista não traz o HTML de
      // propósito — são ~9 KB por folha, e a tela do administrativo
      // pede uma de cada vez, quando alguém clica para ver.
      const id = String(req.query.id || "");
      if (id) {
        if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
        const r = await banco(`${REST("documento")}?select=*&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
        const linha = Array.isArray(r) ? r[0] : null;
        if (!linha) return res.status(404).json({ erro: "Documento não encontrado." });
        return res.status(200).json({ documento: linha });
      }

      const vid = String(req.query.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const linhas = await banco(
        `${REST("documento")}?select=id,tipo,rodada,protocolo,gerado_em&veiculo_id=eq.${vid}&order=gerado_em.desc`,
        { headers: cabecalhos(tok) }
      );
      return res.status(200).json({ documentos: linhas || [] });
    }

    if (req.method === "POST") {
      let corpo = req.body;
      if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
      if (!corpo || typeof corpo !== "object") {
        return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
      }

      const vid = String(corpo.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const tipo = String(corpo.tipo || "");
      if (TIPOS.indexOf(tipo) < 0) return res.status(400).json({ erro: "Tipo de documento desconhecido." });

      const conteudo = texto(corpo.conteudo);
      if (conteudo && conteudo.length > MAX_CONTEUDO) {
        return res.status(413).json({ erro: "Documento grande demais para registrar." });
      }

      // Só o termo de aceite tem rodada; nos outros a coluna fica nula.
      const rodada = tipo === "termo_aceite" && Number.isFinite(Number(corpo.rodada))
        ? Math.trunc(Number(corpo.rodada))
        : null;

      const r = await banco(REST("documento"), {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({
          veiculo_id: vid, tipo, rodada,
          protocolo: texto(corpo.protocolo),
          conteudo,
          negociador: texto(corpo.negociador),
        }),
      });
      const linha = Array.isArray(r) ? r[0] : r;

      return res.status(201).json({
        ok: true,
        id: linha ? linha.id : null,
        tipo,
        gerado_em: (linha && linha.gerado_em) || new Date().toISOString(),
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Use GET ou POST." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha ao registrar o documento." });
  }
};
