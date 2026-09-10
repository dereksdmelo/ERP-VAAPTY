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

/**
 * Hoje em Joinville, no formato aaaa-mm-dd.
 *
 * Em UTC isto quebra de verdade: das 21h à meia-noite do dia 31, o
 * relógio de Greenwich já virou o mês, e o dashboard trocava o período
 * inteiro — o mês que a loja estava fechando sumia da tela por três
 * horas. `en-CA` é o truque para sair ISO sem montar a string à mão.
 */
const hojeAqui = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * A rentabilidade líquida de um carro vendido.
 *
 * Terceira cópia desta conta — a tela e o `api/financeiro.js` têm as
 * outras duas, porque o servidor não carrega o `index.html`. **Mudar
 * uma obriga a mudar as três.**
 *
 * É a **líquida**, que é onde a planilha de rentabilidade fecha e o
 * que o DRE já usa (decisão 26). O fechamento (decisão 32) usa a bruta
 * de propósito, porque lá cautelar e comissão externa aparecem logo
 * abaixo como despesa variável e entrariam duas vezes.
 */
const CUSTO_DO_CARRO = ["debitos", "quitacao", "deducao"];
function liquidaDe(e) {
  const custos = Array.isArray(e.estoque_custo) ? e.estoque_custo : [];
  const val = (l) => (l.realizado == null ? Number(l.previsto) || 0 : Number(l.realizado) || 0);
  const gasto = custos.reduce((t, l) => t + val(l), 0);
  return (Number(e.valor_venda) || 0) - (Number(e.valor_compra) || 0) - gasto;
}

const media = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const pct = (parte, todo) => (todo ? Math.round((parte / todo) * 1000) / 10 : null);

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }
  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  const hoje = hojeAqui();
  const de = dia(req.query.de) || `${hoje.slice(0, 8)}01`;
  const ate = dia(req.query.ate) || hoje;

  const campos = "origem,status,data,valor_fechado,negociador_nome,veiculo(fipe_valor),proposta(id)";
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

  // `semanas` são os quatro blocos da META SEMANAL da planilha: dias
  // 1–7, 8–14, 15–21 e 22 em diante. Não é semana de calendário, é a
  // divisão do mês em quatro — que é como a meta é cobrada.
  const vazio = () => ({
    fluxo: 0, avaliacoes: 0, com_proposta: 0, vendas: 0, perdidos: 0,
    valor_vendido: 0, carros_vendidos: 0, semanas: [0, 0, 0, 0],
  });
  const porOrigem = {};
  ORIGENS.forEach((o) => { porOrigem[o] = vazio(); });
  const porNegociador = {};
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

    // A planilha mede por pessoa, e é aí que a conversa de meta
    // acontece. Agrupa pelo nome porque atendimento importado não tem
    // vínculo com login — negociador_id fica nulo.
    const nome = String(a.negociador_nome || "").trim().toUpperCase();
    const n = nome ? (porNegociador[nome] || (porNegociador[nome] = vazio())) : null;

    [o, total].concat(n ? [n] : []).forEach((c) => {
      c.fluxo += 1;
      if (avaliou) c.avaliacoes += 1;
      if (teveProposta) c.com_proposta += 1;
      if (vendeu) c.vendas += 1;
      if (a.status === "perdido") c.perdidos += 1;
    });

    if (v && v.fipe_valor) fipes.push(Number(v.fipe_valor));
  });

  /* ---------- o dinheiro: margem dos carros vendidos ----------
   *
   * Vinha de `atendimento.valor_fechado`, e por dois motivos isso
   * estava errado. O primeiro é que a importação do CRM nunca preenche
   * essa coluna — a planilha não a tem —, então todo mês importado
   * lia R$ 0. O segundo é conceitual: `valor_fechado` é o que a Vaapty
   * PAGA ao cliente, não o que ela ganha; a meta é em margem (R$ 5.000
   * de ticket por carro), e somar o preço de compra daria vinte vezes
   * o alvo.
   *
   * Agora vem de onde o Derek disse: da planilha de rentabilidade —
   * carro com `situacao = vendido` e `vendido_em` no período.
   *
   * **Isso desloca o mês.** O carro é comprado num mês e revendido em
   * outro, então o faturamento aparece no mês da REVENDA, não no do
   * fechamento. As contagens do funil (fluxo, avaliações, vendas)
   * continuam sendo do atendimento — são coisas diferentes e a tela
   * precisa dizer isso.
   */
  let carros = [];
  try {
    const urlE = `${URL_BASE}/rest/v1/estoque?select=valor_compra,valor_venda,vendido_em,negociador_nome,` +
                 `estoque_custo(tipo,previsto,realizado)` +
                 `&situacao=eq.vendido&vendido_em=gte.${de}&vendido_em=lte.${ate}&limit=${TETO}`;
    const r = await fetch(urlE, { headers: { apikey: ANON, Authorization: tok } });
    if (r.ok) carros = JSON.parse((await r.text()) || "[]");
  } catch (e) { carros = []; }

  carros.forEach((e) => {
    const valor = liquidaDe(e);
    vendas.push(valor);
    const nome = String(e.negociador_nome || "").trim().toUpperCase();
    const n = nome ? (porNegociador[nome] || (porNegociador[nome] = vazio())) : null;
    if (n) { n.valor_vendido += valor; n.carros_vendidos += 1; }
    total.valor_vendido += valor;
    total.carros_vendidos += 1;

    // Venda sem data não entra em semana nenhuma: somar tudo na semana
    // 1 daria uma meta semanal mentirosa.
    const d = Number(String(e.vendido_em || "").slice(8, 10));
    if (d >= 1 && d <= 31) {
      const semana = Math.min(3, Math.floor((d - 1) / 7));
      if (n) n.semanas[semana] += valor;
      total.semanas[semana] += valor;
    }
  });

  const comMovimento = Object.keys(porOrigem)
    .filter((o) => porOrigem[o].fluxo > 0)
    .sort((a, b) => porOrigem[b].fluxo - porOrigem[a].fluxo)
    .map((o) => ({ origem: o, ...porOrigem[o], conversao: pct(porOrigem[o].vendas, porOrigem[o].fluxo) }));

  const equipe = Object.keys(porNegociador)
    .sort((a, b) => porNegociador[b].vendas - porNegociador[a].vendas)
    .map((nome) => ({
      nome,
      ...porNegociador[nome],
      conversao: pct(porNegociador[nome].vendas, porNegociador[nome].fluxo),
      // Margem por carro REVENDIDO — que é a base do valor_vendido.
      // Dividir pelos fechamentos do CRM misturaria duas populações.
      ticket_medio: porNegociador[nome].carros_vendidos
        ? Math.round(porNegociador[nome].valor_vendido / porNegociador[nome].carros_vendidos)
        : null,
    }));

  // Quantos atendimentos ficaram sem dono: sem isso, o dashboard soma
  // menos que o total e ninguém entende por quê.
  const semNegociador = linhas.filter((a) => !String(a.negociador_nome || "").trim()).length;

  return res.status(200).json({
    de, ate,
    por_negociador: equipe,
    sem_negociador: semNegociador,
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
