/**
 * /api/atendimento — a lista do CRM e cada linha dela.
 *
 * GET                      as últimas, com filtro
 * GET ?id=                 um atendimento, com o veículo e as propostas
 * POST                     abre um atendimento
 * PATCH ?id=               atualiza
 *
 * Filtros do GET de lista: status, origem, negociador_id, de, ate, q
 * (q busca em cliente, carro e placa), limite.
 *
 * Como todo o resto de api/, fala com o banco pelo token do usuário —
 * quem decide o que ele enxerga é a RLS da 0004, não código daqui.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

const REST = (t) => `${URL_BASE}/rest/v1/${t}`;

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

const limpar = (s) => String(s == null ? "" : s);

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORIGENS = ["fluxo_loja", "prospeccao", "indicacao", "tv", "google",
                 "facebook", "outdoor", "recuperacao", "faceleads", "outro"];
const STATUS = ["aberto", "aguardando_propostas", "em_negociacao", "fechado", "perdido"];

/* ------------------ conversões ------------------ */

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};

// Aceita 51371, 51.371 e 51.371,50 — o mesmo do api/veiculo.js.
const decimal = (v) => {
  let s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// A planilha usa dd/mm/aaaa; o banco quer aaaa-mm-dd.
const data = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (!m) return null;
  const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

const daLista = (v, lista) => (lista.indexOf(String(v || "")) >= 0 ? String(v) : null);

/**
 * De qual campo veio cada coluna. Como no api/veiculo.js: coluna que
 * a tela não mandou não é apagada no update. Coluna nova exige entrada
 * aqui, senão nunca é gravada.
 */
const FONTE = {
  data: "data", negociador_id: "negociador_id", negociador_nome: "negociador_nome",
  prospec: "prospec", cliente_nome: "cliente_nome", cliente_telefone: "cliente_telefone",
  origem: "origem", status: "status", carro_descricao: "carro_descricao",
  pretensao: "pretensao", valor_fechado: "valor_fechado",
  forma_fechamento: "forma_fechamento", proximo_contato: "proximo_contato",
  observacoes: "observacoes",
};

function paraColunas(c) {
  return {
    data: data(c.data),
    negociador_id: RX_UUID.test(String(c.negociador_id || "")) ? c.negociador_id : null,
    negociador_nome: texto(c.negociador_nome),
    prospec: texto(c.prospec),
    cliente_nome: texto(c.cliente_nome),
    cliente_telefone: texto(c.cliente_telefone),
    origem: daLista(c.origem, ORIGENS),
    status: daLista(c.status, STATUS),
    carro_descricao: texto(c.carro_descricao),
    pretensao: decimal(c.pretensao),
    valor_fechado: decimal(c.valor_fechado),
    forma_fechamento: texto(c.forma_fechamento),
    proximo_contato: data(c.proximo_contato),
    observacoes: texto(c.observacoes),
  };
}

const somenteEnviadas = (linha, corpo) => {
  const r = {};
  Object.keys(linha).forEach((col) => {
    if (corpo[FONTE[col]] !== undefined) r[col] = linha[col];
  });
  return r;
};

/* ------------------ banco ------------------ */

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
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a operação.";
    const erro = new Error(limpar(msg));
    erro.status = r.status === 401 ? 401 : r.status === 403 ? 403 : 502;
    throw erro;
  }
  return dado;
}

async function lerCorpo(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : null;
}

/* ------------------ handler ------------------ */

// O veículo e as propostas vêm junto na mesma consulta: uma ida ao
// banco em vez de três, e a lista já mostra placa e melhor proposta.
const EMBUTIDO = "*,veiculo(id,placa,marca_modelo,ano_fabricacao,ano_modelo,km_atual,fipe_valor,valor_por,status),proposta(id,lojista,valor,apresentada)";

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  try {
    if (req.method === "GET") {
      const id = String(req.query.id || "");
      if (id) {
        if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
        const r = await banco(`${REST("atendimento")}?select=${EMBUTIDO}&id=eq.${id}&limit=1`,
                              { headers: cabecalhos(tok) });
        const linha = Array.isArray(r) ? r[0] : null;
        if (!linha) return res.status(404).json({ erro: "Atendimento não encontrado." });
        return res.status(200).json({ atendimento: linha });
      }

      const f = [];
      const status = daLista(req.query.status, STATUS);
      const origem = daLista(req.query.origem, ORIGENS);
      const de = data(req.query.de);
      const ate = data(req.query.ate);
      const neg = String(req.query.negociador_id || "");
      const q = String(req.query.q || "").trim();

      if (status) f.push(`status=eq.${status}`);
      if (origem) f.push(`origem=eq.${origem}`);
      if (de) f.push(`data=gte.${de}`);
      if (ate) f.push(`data=lte.${ate}`);
      if (RX_UUID.test(neg)) f.push(`negociador_id=eq.${neg}`);
      if (q) {
        // Vírgula e parêntese quebram a sintaxe do or= do PostgREST.
        const t = q.replace(/[(),*]/g, " ").trim();
        if (t) f.push(`or=(cliente_nome.ilike.*${t}*,carro_descricao.ilike.*${t}*,cliente_telefone.ilike.*${t}*)`);
      }

      const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 100));
      const url = `${REST("atendimento")}?select=${EMBUTIDO}&order=data.desc,criado_em.desc&limit=${limite}` +
                  (f.length ? `&${f.join("&")}` : "");

      const lista = await banco(url, { headers: cabecalhos(tok) });
      return res.status(200).json({ atendimentos: lista || [] });
    }

    if (req.method === "POST") {
      const corpo = await lerCorpo(req);
      if (!corpo) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

      const linha = somenteEnviadas(paraColunas(corpo), corpo);
      const r = await banco(REST("atendimento"), {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify(linha),
      });
      const salvo = Array.isArray(r) ? r[0] : r;
      return res.status(201).json({ ok: true, atendimento: salvo });
    }

    if (req.method === "PATCH") {
      const id = String(req.query.id || "");
      if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });

      const corpo = await lerCorpo(req);
      if (!corpo) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

      const linha = somenteEnviadas(paraColunas(corpo), corpo);
      if (!Object.keys(linha).length) return res.status(400).json({ erro: "Nada para atualizar." });

      const r = await banco(`${REST("atendimento")}?id=eq.${id}`, {
        method: "PATCH",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify(linha),
      });
      const salvo = Array.isArray(r) ? r[0] : r;
      // A RLS deixa ler e recusa escrever: o PATCH volta vazio, sem erro.
      if (!salvo) return res.status(403).json({ erro: "Este atendimento é de outro negociador." });
      return res.status(200).json({ ok: true, atendimento: salvo });
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no atendimento." });
  }
};
