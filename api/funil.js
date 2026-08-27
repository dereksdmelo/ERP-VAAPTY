/**
 * GET /api/funil?de=aaaa-mm-dd&ate=aaaa-mm-dd
 *
 * A aba PIPELINE da planilha: fluxo → avaliações → propostas → vendas,
 * quebrado por origem, com conversão e valores médios.
 *
 * Sem período, usa o mês corrente.
 *
 * Por que aqui e não na tela: a lista do CRM é paginada, e contar em
 * cima do que coube na página daria número errado — no mês da planilha
 * foram 173 atendimentos. Aqui a consulta é enxuta (sem foto, sem
 * observação) e cabe de uma vez.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const TETO = 2000;

const ORIGENS = ["fluxo_loja", "prospeccao", "indicacao", "tv", "google",
                 "facebook", "outdoor", "recuperacao", "faceleads", "outro"];

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const dia = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

const media = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const pct = (parte, todo) => (todo ? Math.round((parte / todo) * 1000) / 10 : null);

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }
  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  const hoje = new Date();
  const primeiro = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const de = dia(req.query.de) || primeiro;
  const ate = dia(req.query.ate) || hoje.toISOString().slice(0, 10);

  const campos = "origem,status,data,valor_fechado,veiculo(fipe_valor),proposta(id)";
  const url = `${URL_BASE}/rest/v1/atendimento?select=${campos}` +
              `&data=gte.${de}&data=lte.${ate}&limit=${TETO}`;

  let linhas;
  try {
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: tok } });
    const corpo = await r.text();
    if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler o funil." });
    linhas = JSON.parse(corpo || "[]");
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com o banco." });
  }

  const vazio = () => ({ fluxo: 0, avaliacoes: 0, com_proposta: 0, vendas: 0, perdidos: 0 });
  const porOrigem = {};
  ORIGENS.forEach((o) => { porOrigem[o] = vazio(); });
  const total = vazio();

  const fipes = [];
  const vendas = [];

  linhas.forEach((a) => {
    const o = porOrigem[a.origem] || (porOrigem[a.origem] = vazio());
    const v = (a.veiculo || [])[0];
    // Avaliação é ficha aberta com valor FIPE: é o que a planilha
    // chamava de "veículo avaliado", não só o cliente que entrou.
    const avaliou = !!(v && v.fipe_valor);
    const teveProposta = ((a.proposta || []).length > 0);
    const vendeu = a.status === "fechado";

    [o, total].forEach((c) => {
      c.fluxo += 1;
      if (avaliou) c.avaliacoes += 1;
      if (teveProposta) c.com_proposta += 1;
      if (vendeu) c.vendas += 1;
      if (a.status === "perdido") c.perdidos += 1;
    });

    if (v && v.fipe_valor) fipes.push(Number(v.fipe_valor));
    if (vendeu && a.valor_fechado) vendas.push(Number(a.valor_fechado));
  });

  const comMovimento = Object.keys(porOrigem)
    .filter((o) => porOrigem[o].fluxo > 0)
    .sort((a, b) => porOrigem[b].fluxo - porOrigem[a].fluxo)
    .map((o) => ({ origem: o, ...porOrigem[o], conversao: pct(porOrigem[o].vendas, porOrigem[o].fluxo) }));

  return res.status(200).json({
    de, ate,
    total: {
      ...total,
      avaliacoes_sobre_fluxo: pct(total.avaliacoes, total.fluxo),
      vendas_sobre_proposta: pct(total.vendas, total.com_proposta),
      conversao: pct(total.vendas, total.fluxo),
    },
    fipe_medio: media(fipes),
    venda_media: media(vendas),
    por_origem: comMovimento,
    // Se bater no teto, o número está incompleto e a tela precisa dizer.
    truncado: linhas.length >= TETO,
  });
};
