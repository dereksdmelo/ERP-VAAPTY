/**
 * GET /api/perfil
 *
 * Quem sou eu neste sistema. Devolve nome, papel e se o perfil está
 * ativo — a tela precisa disso para dizer "seu acesso ainda não foi
 * liberado" em vez de mostrar telas vazias.
 *
 * Para o gerente, devolve também a equipe. A RLS da 0004 é que decide:
 * a mesma consulta traz uma linha para negociador e todas para gerente.
 * Não há checagem de papel aqui — se houvesse, seriam duas regras para
 * manter em sincronia.
 *
 * ---------------------------------------------------------------------
 * /api/perfil?recurso=negociadores
 *
 *   GET            lista o cadastro de negociadores e prospecção
 *   POST           cadastra { nome, papel, meta_valor, meta_volume }
 *   PATCH ?id=     edita
 *
 * Mora aqui, e não em arquivo próprio, porque o plano Hobby da Vercel
 * aceita no máximo 12 funções e já estamos nas 12. Cadastro de gente é
 * o assunto deste arquivo, então a costura não é arbitrária.
 *
 * ---------------------------------------------------------------------
 * /api/perfil?recurso=meta-loja
 *
 *   GET ?competencia=  a meta da loja no mês (padrão: mês corrente)
 *   PUT                grava { valor, volume }
 *
 * A meta da loja é independente da soma das individuais — ver 0018.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

/**
 * O id do usuário, lido do miolo do token sem verificar assinatura.
 * Serve só para saber qual das linhas devolvidas é a dele — o gerente
 * recebe a equipe inteira. Quem valida o token de verdade é o banco,
 * que já recusou a consulta se ele fosse falso.
 */
function donoDoToken(tok) {
  try {
    const meio = String(tok).replace(/^Bearer\s+/, "").split(".")[1];
    if (!meio) return null;
    const base = meio.replace(/-/g, "+").replace(/_/g, "/");
    const dados = JSON.parse(Buffer.from(base, "base64").toString("utf8"));
    return dados.sub || null;
  } catch (e) {
    return null;
  }
}

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAPEIS = ["negociador", "prospeccao"];

const texto = (v) => {
  const t = String(v == null ? "" : v).trim();
  return t === "" ? null : t;
};
const numero = (v) => {
  const n = Number(String(v == null ? "" : v).replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const CAMPOS_META = ["meta_atendimentos", "meta_conversao", "meta_ticket"];

/**
 * O faturamento é consequência, não entrada (0018).
 *
 *     atendimentos × conversão = carros ;  carros × ticket = faturamento
 *
 * O volume é arredondado ANTES de virar dinheiro para que a conta na
 * tela feche: 30 atendimentos a 22% dão 7 carros, e 7 × 25.000 é o
 * número que o negociador vê. Multiplicar por 6,6 daria um
 * faturamento que nenhuma linha da tela explica.
 *
 * Isto roda no servidor porque `meta_valor` é lido pelo dashboard
 * inteiro: se a tela calculasse, um cliente desatualizado gravaria uma
 * meta que não corresponde aos três campos ao lado dela.
 */
function derivarMeta(atendimentos, conversao, ticket) {
  const a = Math.max(0, Math.trunc(Number(atendimentos) || 0));
  const c = Math.max(0, Number(conversao) || 0);
  const t = Math.max(0, Number(ticket) || 0);
  const volume = Math.round((a * c) / 100);
  return { meta_volume: volume, meta_valor: Math.round(volume * t * 100) / 100 };
}

async function lerCorpo(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : null;
}

async function negociadores(req, res, tok) {
  const base = `${URL_BASE}/rest/v1/negociador`;
  const cab = { apikey: ANON, Authorization: tok };
  const cabJson = { ...cab, "Content-Type": "application/json" };

  const responder = async (r) => {
    const corpo = await r.text();
    let d = null;
    try { d = corpo ? JSON.parse(corpo) : null; } catch (e) {}
    if (!r.ok) {
      const msg = (d && (d.message || d.hint || d.details)) || "O banco recusou a operação.";
      // 23505 é nome repetido: mensagem própria, porque a do Postgres
      // não diz nada a quem está cadastrando.
      const dup = d && d.code === "23505";
      return res.status(dup ? 409 : (r.status === 401 ? 401 : 502))
        .json({ erro: dup ? "Já existe alguém com esse nome nesse papel." : String(msg) });
    }
    return d;
  };

  if (req.method === "GET") {
    const r = await fetch(`${base}?select=id,nome,papel,ativo,meta_valor,meta_volume,` +
      `${CAMPOS_META.join(",")}&order=papel.asc,nome.asc`, { headers: cab });
    const d = await responder(r);
    if (d === undefined || res.writableEnded) return;
    return res.status(200).json({ negociadores: d || [] });
  }

  if (req.method === "POST") {
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const nome = texto(c.nome);
    if (!nome) return res.status(400).json({ erro: "Informe o nome." });
    const papel = PAPEIS.indexOf(String(c.papel || "")) >= 0 ? c.papel : "negociador";
    const linha = { nome, papel };
    // meta_valor e meta_volume não são aceitos do cliente: são
    // derivados dos três campos abaixo, e só aqui.
    if (CAMPOS_META.some((k) => c[k] !== undefined)) {
      linha.meta_atendimentos = Math.trunc(numero(c.meta_atendimentos) || 0);
      linha.meta_conversao = numero(c.meta_conversao) || 0;
      linha.meta_ticket = numero(c.meta_ticket) || 0;
      Object.assign(linha, derivarMeta(linha.meta_atendimentos, linha.meta_conversao, linha.meta_ticket));
    }
    const r = await fetch(base, { method: "POST", headers: { ...cabJson, Prefer: "return=representation" }, body: JSON.stringify(linha) });
    const d = await responder(r);
    if (d === undefined || res.writableEnded) return;
    return res.status(201).json({ ok: true, negociador: Array.isArray(d) ? d[0] : d });
  }

  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const mud = {};
    if (c.nome !== undefined) mud.nome = texto(c.nome);
    if (c.papel !== undefined && PAPEIS.indexOf(String(c.papel)) >= 0) mud.papel = c.papel;
    if (c.ativo !== undefined) mud.ativo = !!c.ativo;

    // Só recalcula quando um dos três chega. Sem esta guarda, um
    // "desativar" — que manda apenas `ativo` — zeraria a meta de quem
    // ainda está com os R$ 70.000 herdados do padrão antigo.
    if (CAMPOS_META.some((k) => c[k] !== undefined)) {
      const atual = await fetch(`${base}?id=eq.${id}&select=${CAMPOS_META.join(",")}`, { headers: cab });
      const linhas = atual.ok ? await atual.json().catch(() => []) : [];
      const antes = (Array.isArray(linhas) ? linhas[0] : null) || {};
      CAMPOS_META.forEach((k) => {
        mud[k] = c[k] !== undefined ? (numero(c[k]) || 0) : (Number(antes[k]) || 0);
      });
      mud.meta_atendimentos = Math.trunc(mud.meta_atendimentos);
      Object.assign(mud, derivarMeta(mud.meta_atendimentos, mud.meta_conversao, mud.meta_ticket));
    }
    if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para atualizar." });
    const r = await fetch(`${base}?id=eq.${id}`, { method: "PATCH", headers: { ...cabJson, Prefer: "return=representation" }, body: JSON.stringify(mud) });
    const d = await responder(r);
    if (d === undefined || res.writableEnded) return;
    const salvo = Array.isArray(d) ? d[0] : d;
    // PATCH vazio é a RLS recusando: só gerente edita.
    if (!salvo) return res.status(403).json({ erro: "Só o gerente edita o cadastro." });
    return res.status(200).json({ ok: true, negociador: salvo });
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
}

const CAMPOS_DESEMPENHO = [
  "faltas", "atrasos", "perdeu_atendimento", "prospectou", "avaliacao_google",
  "ficou_mais", "gravou_video", "avaliacao_errada", "postura", "indice_at",
];

/**
 * A faixa CONFIABILIDADE do dashboard (0013).
 *
 * São observações de gestor — falta, atraso, perdeu atendimento — que
 * não existem em lugar nenhum do banco de atendimento. O servidor não
 * tem como calcular, então é digitado, uma linha por negociador por mês.
 *
 * Mora aqui e não em api/desempenho.js porque a Vercel do plano Hobby
 * para em 12 funções e nós estamos nas 12. Mesmo truque dos
 * negociadores logo abaixo — acomodação de teto, não arquitetura.
 *
 * Quem escreve é só o gerente, e quem garante isso é a RLS da 0013: a
 * política de escrita exige e_gerente(). O PUT que volta vazio é ela
 * recusando, e vira 403 com mensagem legível.
 */
async function desempenho(req, res, tok) {
  const base = `${URL_BASE}/rest/v1/desempenho`;
  const cab = { apikey: ANON, Authorization: tok };
  const cabJson = { ...cab, "Content-Type": "application/json" };

  // Sempre o primeiro dia do mês: é a chave do unique da 0013.
  const competencia = (() => {
    const c = String(req.query.competencia || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return `${c.slice(0, 8)}01`;
    // Mesmo relógio do funil: em UTC a virada do mês acontece três
    // horas antes daqui, e a competência trocaria com a loja aberta.
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return `${hoje.slice(0, 8)}01`;
  })();

  if (req.method === "GET") {
    const r = await fetch(`${base}?select=*&competencia=eq.${competencia}`, { headers: cab });
    if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler o desempenho." });
    const d = await r.json().catch(() => []);
    return res.status(200).json({ competencia, desempenho: Array.isArray(d) ? d : [] });
  }

  if (req.method === "PUT") {
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const id = String(c.negociador_id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "negociador_id inválido." });

    const linha = { negociador_id: id, competencia, atualizado_em: new Date().toISOString() };
    CAMPOS_DESEMPENHO.forEach((k) => { if (c[k] !== undefined) linha[k] = numero(c[k]) || 0; });

    const r = await fetch(`${base}?on_conflict=negociador_id,competencia`, {
      method: "POST",
      headers: { ...cabJson, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(linha),
    });
    if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "O banco recusou a gravação." });
    const d = await r.json().catch(() => []);
    const salvo = Array.isArray(d) ? d[0] : d;
    if (!salvo) return res.status(403).json({ erro: "Só o gerente edita a confiabilidade." });
    return res.status(200).json({ ok: true, desempenho: salvo });
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ erro: "Use GET ou PUT." });
}

/**
 * A meta da loja, uma por mês (0018).
 *
 * Independente da soma das metas individuais — e é essa a decisão:
 * somar as individuais pressupõe que todo mundo bate a sua, o que não
 * acontece em mês nenhum. O alvo da loja é escolha de gestor.
 *
 * A competência é sempre o dia 1: é a chave primária da tabela.
 */
async function metaLoja(req, res, tok) {
  const base = `${URL_BASE}/rest/v1/meta_loja`;
  const cab = { apikey: ANON, Authorization: tok };

  const competencia = (() => {
    const c = String(req.query.competencia || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(c)) return `${c.slice(0, 8)}01`;
    // O mesmo relógio do funil: em UTC a virada do mês chega três
    // horas antes que em Joinville.
    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return `${hoje.slice(0, 8)}01`;
  })();

  if (req.method === "GET") {
    const r = await fetch(`${base}?select=*&competencia=eq.${competencia}`, { headers: cab });
    if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler a meta da loja." });
    const d = await r.json().catch(() => []);
    // Sem linha, `meta` é null — e a tela diz "não definida" em vez de
    // mostrar zero, que pareceria meta batida ao contrário.
    return res.status(200).json({ competencia, meta: (Array.isArray(d) ? d[0] : d) || null });
  }

  if (req.method === "PUT") {
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const linha = {
      competencia,
      valor: Math.max(0, numero(c.valor) || 0),
      volume: Math.max(0, Math.trunc(numero(c.volume) || 0)),
      atualizado_em: new Date().toISOString(),
      atualizado_por: donoDoToken(tok),
    };
    const r = await fetch(`${base}?on_conflict=competencia`, {
      method: "POST",
      headers: { ...cab, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(linha),
    });
    if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "O banco recusou a gravação." });
    const d = await r.json().catch(() => []);
    const salvo = Array.isArray(d) ? d[0] : d;
    // Upsert que volta vazio é a RLS recusando: só gerente escreve.
    if (!salvo) return res.status(403).json({ erro: "Só o gerente define a meta da loja." });
    return res.status(200).json({ ok: true, competencia, meta: salvo });
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ erro: "Use GET ou PUT." });
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  // ?recurso=config — o que o navegador precisa para falar com o
  // Supabase Auth, ANTES de ter login. Só sai o que é público por
  // natureza: a URL e a chave anônima (feita para viver no navegador;
  // sozinha não abre nada, quem decide é a RLS). Morava em
  // api/config.js; fundiu aqui para liberar a 12ª função da Vercel
  // para api/financeiro.js. A SUPABASE_SERVICE_KEY nunca entra aqui.
  if (String(req.query.recurso || "") === "config") {
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    return res.status(200).json({ url: URL_BASE, anon: ANON });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  if (String(req.query.recurso || "") === "meta-loja") {
    try { return await metaLoja(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: "Não consegui falar com o banco." }); }
  }

  if (String(req.query.recurso || "") === "desempenho") {
    try { return await desempenho(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: "Não consegui falar com o banco." }); }
  }

  if (String(req.query.recurso || "") === "negociadores") {
    try { return await negociadores(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: "Não consegui falar com o banco." }); }
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ erro: "Use GET." });
  }

  let r, corpo;
  try {
    r = await fetch(`${URL_BASE}/rest/v1/perfil?select=id,nome,papel,ativo,administrativo,financeiro&order=nome.asc`, {
      headers: { apikey: ANON, Authorization: tok },
    });
    corpo = await r.text();
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com o banco." });
  }

  if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler o perfil." });

  let linhas = [];
  try { linhas = JSON.parse(corpo) || []; } catch (e) {}

  // Sem perfil ativo a RLS não devolve nada — inclusive o próprio.
  // Nesse caso a conta existe mas ainda não foi liberada.
  if (!linhas.length) {
    return res.status(200).json({ eu: null, equipe: [], liberado: false });
  }

  const meuId = donoDoToken(tok);
  const eu = linhas.filter((l) => l.id === meuId)[0] || (linhas.length === 1 ? linhas[0] : null);

  // O gerente recebe a lista inteira; os outros, só a própria linha.
  return res.status(200).json({ eu, equipe: linhas, liberado: true });
};
