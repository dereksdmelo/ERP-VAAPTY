/**
 * O COMBINADO DE REMUNERAÇÃO — a regra, num lugar só (0081).
 *
 * O Derek, em 27/10/2026: *"no cadastro do membro da equipe dar pra
 * anotar o formato do combinado do salário dele… e na projeção do DRE
 * mostrar automaticamente qual seria o salário dele projetado de acordo
 * com o resultado dele até ali"*. Cada pessoa tem um combinado
 * diferente, então o combinado não é um formulário com campos fixos: é
 * uma LISTA DE PEÇAS, e cada peça é um dos nove tipos abaixo.
 *
 * Quem lê isto: `api/perfil.js` (para limpar o que a ficha grava) e
 * `api/financeiro.js` (para calcular). A tela só monta a lista. Mora
 * fora de `api/` pelo teto de 12 funções da Vercel, como o `ia/`.
 *
 * As métricas vêm de fora, prontas, por escopo:
 *   { proprio: { carros, rent, fluxo, fechados }, loja: { … }, lucro }
 * `rent` é a rentabilidade LÍQUIDA dos carros vendidos — o que a casa
 * chama de faturamento (decisão 32); conversão é fechados ÷ atendimentos,
 * a mesma conta do funil; ticket é rentabilidade ÷ carros.
 */

const TIPOS = {
  fixo:              "Fixo",
  variavel_fixo:     "Variável fixo",
  variavel_faixa:    "Variável por faixa",
  vendas_proprias:   "Variável das vendas próprias",
  vendas_loja:       "Variável das vendas da loja",
  bonus_conversao:   "Bônus de conversão",
  bonus_rentab:      "Bônus de rentabilidade",
  bonus_ticket:      "Bônus de ticket médio",
  bonus_lucro:       "Bônus por faixa de lucro da loja",
};
const METRICAS = ["carros", "rent", "conversao", "ticket"];
const num = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v == null ? "" : v).trim().replace(/[R$\s%]/g, "");
  if (!s) return 0;
  // "2.000" é dois mil, não dois: ponto com três dígitos depois é milhar.
  const n = Number(s.indexOf(",") >= 0 ? s.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
  return isFinite(n) ? n : 0;
};

/** O que a ficha pode gravar: só os tipos conhecidos e só os campos de cada um. */
function limpar(plano) {
  const p = plano && typeof plano === "object" ? plano : {};
  const pecas = (Array.isArray(p.pecas) ? p.pecas : []).slice(0, 30).map((x) => {
    if (!x || !TIPOS[x.tipo]) return null;
    const y = { tipo: x.tipo, rotulo: String(x.rotulo || "").slice(0, 80) };
    if (x.escopo === "loja" || x.escopo === "proprio") y.escopo = x.escopo;
    if (METRICAS.indexOf(x.metrica) >= 0) y.metrica = x.metrica;
    if (["valor", "por_carro", "percentual"].indexOf(x.modo) >= 0) y.modo = x.modo;
    ["valor", "meta", "passo", "inicio"].forEach((k) => { if (x[k] !== undefined && x[k] !== "") y[k] = num(x[k]); });
    if (Array.isArray(x.faixas)) {
      y.faixas = x.faixas.slice(0, 12).map((f) => ({ de: num(f && f.de), valor: num(f && f.valor) }))
        .sort((a, b) => a.de - b.de);
    }
    return y;
  }).filter(Boolean);
  const apelidos = (Array.isArray(p.apelidos) ? p.apelidos : String(p.apelidos || "").split(","))
    .map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 6);
  return { pecas, apelidos, obs: String(p.obs || "").slice(0, 500) };
}

const conv = (m) => (m.fluxo ? (m.fechados / m.fluxo) * 100 : 0);
const ticket = (m) => (m.carros ? m.rent / m.carros : 0);
const daMetrica = (m, k) => (k === "carros" ? m.carros : k === "rent" ? m.rent : k === "conversao" ? conv(m) : ticket(m));
const brl = (v) => "R$ " + Math.round(v).toLocaleString("pt-BR");
const NOME_METRICA = { carros: "carros", rent: "rentabilidade", conversao: "conversão", ticket: "ticket médio" };
const fmtMetrica = (k, v) => (k === "carros" ? `${Math.round(v * 10) / 10} carros` : k === "conversao" ? `${Math.round(v)}%` : brl(v));

/** Uma peça contra as métricas: o valor e a conta, escrita para quem lê. */
function calcularPeca(x, met) {
  const m = x.escopo === "loja" ? met.loja : met.proprio;
  const de = x.escopo === "loja" ? "da loja" : "próprio";
  const v = num(x.valor);
  switch (x.tipo) {
    case "fixo": return { valor: v, conta: "fixo" };
    case "variavel_fixo": return { valor: v, conta: "variável fixo" };
    case "vendas_proprias":
    case "vendas_loja": {
      const mm = x.tipo === "vendas_loja" ? met.loja : met.proprio;
      return x.modo === "percentual"
        ? { valor: (mm.rent * v) / 100, conta: `${v}% de ${brl(mm.rent)} de rentabilidade` }
        : { valor: mm.carros * v, conta: `${mm.carros} carros × ${brl(v)}` };
    }
    case "variavel_faixa": {
      const k = x.metrica || "carros";
      const atual = daMetrica(m, k);
      const faixa = (x.faixas || []).filter((f) => atual >= f.de).pop();
      if (!faixa) return { valor: 0, conta: `${fmtMetrica(k, atual)} ${de} — abaixo da primeira faixa` };
      const conta = `${fmtMetrica(k, atual)} ${de} → faixa a partir de ${fmtMetrica(k, faixa.de)}`;
      if (x.modo === "por_carro") return { valor: m.carros * faixa.valor, conta: `${conta}: ${m.carros} × ${brl(faixa.valor)}` };
      if (x.modo === "percentual") return { valor: (m.rent * faixa.valor) / 100, conta: `${conta}: ${faixa.valor}% de ${brl(m.rent)}` };
      return { valor: faixa.valor, conta: `${conta}: ${brl(faixa.valor)}` };
    }
    case "bonus_conversao":
    case "bonus_rentab":
    case "bonus_ticket": {
      const k = x.tipo === "bonus_conversao" ? "conversao" : x.tipo === "bonus_rentab" ? "rent" : "ticket";
      const atual = daMetrica(m, k);
      const bateu = atual >= num(x.meta) && num(x.meta) > 0;
      return { valor: bateu ? v : 0, conta: `${NOME_METRICA[k]} ${de} ${fmtMetrica(k, atual)} ${bateu ? "≥" : "<"} meta ${fmtMetrica(k, num(x.meta))}` };
    }
    case "bonus_lucro": {
      /* "Começa em" (27/10/2026, o Derek: 50 mil paga +5, 75 mil +5,
       * 100 mil +5 — "e assim de 25 em 25"). O primeiro degrau é pago ao
       * bater o começo, e os seguintes a cada passo. Sem começo, o
       * primeiro degrau é o próprio passo — a regra de antes. */
      const passo = num(x.passo);
      const inicio = num(x.inicio) || passo;
      const faixas = passo > 0 && met.lucro >= inicio && met.lucro > 0 ? Math.floor((met.lucro - inicio) / passo) + 1 : 0;
      return { valor: faixas * v, conta: faixas
        ? `lucro da loja ${brl(met.lucro)}: ${faixas} degrau${faixas > 1 ? "s" : ""} (${brl(inicio)}${faixas > 1 ? ` + ${faixas - 1} × ${brl(passo)}` : ""}) × ${brl(v)}`
        : `lucro da loja ${brl(met.lucro)} — abaixo de ${brl(inicio)}` };
    }
  }
  return { valor: 0, conta: "" };
}

/** O combinado inteiro: peça a peça, e o total. */
function calcular(plano, met) {
  const pecas = (plano && plano.pecas) || [];
  const linhas = pecas.map((x) => {
    const r = calcularPeca(x, met);
    return { tipo: x.tipo, rotulo: x.rotulo || TIPOS[x.tipo], valor: Math.round(r.valor * 100) / 100, conta: r.conta,
             fixo: x.tipo === "fixo", bonus: x.tipo.indexOf("bonus") === 0 };
  });
  return { linhas, total: linhas.reduce((t, l) => t + l.valor, 0) };
}

/** As métricas no ritmo do mês: somas esticadas até o fim; razões iguais. */
function noRitmo(met, fator) {
  const esticar = (m) => ({ carros: Math.round(m.carros * fator * 10) / 10, rent: m.rent * fator,
                            fluxo: m.fluxo * fator, fechados: m.fechados * fator });
  return { proprio: esticar(met.proprio), loja: esticar(met.loja), lucro: met.lucro * fator };
}

module.exports = { TIPOS, limpar, calcular, noRitmo };
