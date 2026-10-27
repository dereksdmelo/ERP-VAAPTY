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
  bonus_periodo:     "Bônus por período (semana ou 1ª quinzena)",
};
const METRICAS = ["carros", "clientes", "rent", "conversao", "ticket", "lucro"];
const MODOS = ["valor", "por_carro", "por_cliente", "percentual", "percentual_excedente"];
const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const num = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : 0;
  const s = String(v == null ? "" : v).trim().replace(/[R$\s%]/g, "");
  if (!s) return 0;
  // "2.000" é dois mil, não dois: ponto com três dígitos depois é milhar.
  const n = Number(s.indexOf(",") >= 0 ? s.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s);
  return isFinite(n) ? n : 0;
};

/* AS SEMANAS DO MÊS SÃO QUATRO (27/10/2026, o Derek): "a segunda
 * semana tem que finalizar com o quinzenal, e a última semana normalmente
 * estendemos — a gente só considera 4 semanas no mês", e semana não
 * atravessa a virada do mês. Então: 1–8, 9–15, 16–22 e 23 até o fim —
 * a primeira com um dia a mais, de fôlego para o fechamento do mês
 * anterior (o Derek, no mesmo dia).
 * A planilha trazia SEM. de 1 a 5; a 5 cai na 4. */
const PRIMEIRO_DIA_DA_SEMANA = [1, 9, 16, 23];
function semanaDoDia(d) {
  if (!d) return null;
  return d <= 8 ? 1 : d <= 15 ? 2 : d <= 22 ? 3 : 4;
}
const semanaDaPlanilha = (n) => (n >= 1 ? Math.min(4, Math.trunc(n)) : null);

/** O que a ficha pode gravar: só os tipos conhecidos e só os campos de cada um. */
function limpar(plano) {
  const p = plano && typeof plano === "object" ? plano : {};
  const pecas = (Array.isArray(p.pecas) ? p.pecas : []).slice(0, 30).map((x) => {
    if (!x || !TIPOS[x.tipo]) return null;
    const y = { tipo: x.tipo, rotulo: String(x.rotulo || "").slice(0, 80) };
    if (x.escopo === "loja" || x.escopo === "proprio") y.escopo = x.escopo;
    if (METRICAS.indexOf(x.metrica) >= 0) y.metrica = x.metrica;
    if (MODOS.indexOf(x.modo) >= 0) y.modo = x.modo;
    if (x.soma) y.soma = true;
    if (x.periodo === "semana" || x.periodo === "quinzena1") y.periodo = x.periodo;
    ["valor", "meta", "passo", "inicio", "ate"].forEach((k) => { if (x[k] !== undefined && x[k] !== "") y[k] = num(x[k]); });
    if (Array.isArray(x.faixas)) {
      // `ticket` só existe nas faixas do bônus de ticket (a rentabilidade
      // da faixa e o ticket mínimo dela).
      y.faixas = x.faixas.slice(0, 12).map((f) => {
        const z = { de: num(f && f.de), valor: num(f && f.valor) };
        if (f && f.ticket !== undefined && f.ticket !== "") z.ticket = num(f.ticket);
        // A faixa que paga % da rentabilidade do período, e não R$ (o
        // semanal do negociador: de 5 a 10 mil, 1% de comissão).
        if (f && f.pct) z.pct = true;
        return z;
      }).sort((a, b) => a.de - b.de);
    }
    return y;
  }).filter(Boolean);
  const apelidos = (Array.isArray(p.apelidos) ? p.apelidos : String(p.apelidos || "").split(","))
    .map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 6);
  // O perfil de remuneração (0082): as peças dele valem junto das daqui.
  const perfil_id = RX_UUID.test(String(p.perfil_id || "")) ? String(p.perfil_id) : null;
  return { perfil_id, pecas, apelidos, obs: String(p.obs || "").slice(0, 500) };
}

const conv = (m) => (m.fluxo ? (m.fechados / m.fluxo) * 100 : 0);
const ticket = (m) => (m.carros ? m.rent / m.carros : 0);
const daMetrica = (m, k, lucro) => (k === "carros" ? m.carros : k === "clientes" ? m.fluxo : k === "rent" ? m.rent
  : k === "conversao" ? conv(m) : k === "lucro" ? lucro : ticket(m));
const brl = (v) => "R$ " + Math.round(v).toLocaleString("pt-BR");
const NOME_METRICA = { carros: "carros", clientes: "clientes em loja", rent: "rentabilidade", conversao: "conversão", ticket: "ticket médio", lucro: "lucro da loja" };
const fmtMetrica = (k, v) => (k === "carros" ? `${Math.round(v * 10) / 10} carros` : k === "clientes" ? `${Math.round(v)} clientes`
  : k === "conversao" ? `${Math.round(v)}%` : brl(v));

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
      /* A FAIXA (27/10/2026, os combinados reais do Derek):
       *  - medida em carros, clientes em loja, rentabilidade, conversão,
       *    ticket ou LUCRO DA LOJA;
       *  - paga um valor fixo, R$ por carro, R$ por cliente, % da base
       *    (a rentabilidade, ou o lucro quando é ele que mede) ou % do que
       *    PASSAR do começo da faixa ("depois de 100 mil eu pago 1%");
       *  - "as faixas se somam": 180 mil +500 e 230 mil +500 dão 1.000;
       *    sem isso vale só a mais alta, como numa tabela;
       *  - "deixa de valer a partir de": em 300 mil o combinado muda, e o
       *    que se ganhou nas faixas de baixo cai — a peça nova entra em
       *    outra linha. */
      const k = x.metrica || "carros";
      const atual = daMetrica(m, k, met.lucro);
      const qual = k === "lucro" ? "" : ` ${de}`;
      if (num(x.ate) > 0 && atual >= num(x.ate)) return { valor: 0, conta: `${fmtMetrica(k, atual)}${qual} — passou de ${fmtMetrica(k, num(x.ate))}, deixa de valer` };
      const batidas = (x.faixas || []).filter((f) => atual >= f.de);
      const faixa = batidas[batidas.length - 1];
      if (!faixa) return { valor: 0, conta: `${fmtMetrica(k, atual)}${qual} — abaixo da primeira faixa` };
      const conta = `${fmtMetrica(k, atual)}${qual} → faixa a partir de ${fmtMetrica(k, faixa.de)}`;
      const baseR = k === "lucro" ? met.lucro : m.rent;
      const nomeBase = k === "lucro" ? "do lucro" : "da rentabilidade";
      switch (x.modo) {
        case "por_carro": return { valor: m.carros * faixa.valor, conta: `${conta}: ${m.carros} carros × ${brl(faixa.valor)}` };
        case "por_cliente": return { valor: m.fluxo * faixa.valor, conta: `${conta}: ${m.fluxo} clientes × ${brl(faixa.valor)}` };
        case "percentual": return { valor: (baseR * faixa.valor) / 100, conta: `${conta}: ${faixa.valor}% ${nomeBase} (${brl(baseR)})` };
        case "percentual_excedente": {
          const sobra = Math.max(0, baseR - faixa.de);
          return { valor: (sobra * faixa.valor) / 100, conta: `${conta}: ${faixa.valor}% de ${brl(sobra)} acima de ${brl(faixa.de)}` };
        }
        default:
          if (x.soma) {
            const total = batidas.reduce((t, f) => t + f.valor, 0);
            return { valor: total, conta: `${conta}: ${batidas.length} faixa${batidas.length > 1 ? "s" : ""} somadas = ${brl(total)}` };
          }
          return { valor: faixa.valor, conta: `${conta}: ${brl(faixa.valor)}` };
      }
    }
    case "bonus_ticket": {
      /* POR FAIXA DE RENTABILIDADE (27/10/2026, o Derek): cada faixa de
       * rentabilidade tem o seu ticket mínimo e o seu valor. Vale a
       * faixa MAIS ALTA que a rentabilidade alcançou, e ela só paga se o
       * ticket bateu o mínimo DELA — ticket alto numa faixa baixa não
       * leva o valor da alta, e faixa alta com ticket baixo não paga
       * nada (não desce para a de baixo). */
      if ((x.faixas || []).length) {
        const rent = m.rent, tk = ticket(m);
        const faixa = x.faixas.filter((f) => rent >= f.de).pop();
        if (!faixa) return { valor: 0, conta: `rentabilidade ${de} ${brl(rent)} — abaixo da primeira faixa` };
        const bateu = tk >= num(faixa.ticket);
        return { valor: bateu ? faixa.valor : 0,
          conta: `rentabilidade ${de} ${brl(rent)} → faixa de ${brl(faixa.de)}; ticket ${brl(tk)} ${bateu ? "≥" : "<"} ${brl(faixa.ticket)}${bateu ? "" : " — não paga"}` };
      }
    }
    // falls through
    case "bonus_conversao":
    case "bonus_rentab": {
      const k = x.tipo === "bonus_conversao" ? "conversao" : x.tipo === "bonus_rentab" ? "rent" : "ticket";
      const atual = daMetrica(m, k);
      const bateu = atual >= num(x.meta) && num(x.meta) > 0;
      return { valor: bateu ? v : 0, conta: `${NOME_METRICA[k]} ${de} ${fmtMetrica(k, atual)} ${bateu ? "≥" : "<"} meta ${fmtMetrica(k, num(x.meta))}` };
    }
    case "bonus_periodo": {
      /* SEMANAL E 1ª QUINZENA (27/10/2026): a mesma faixa, medida dentro
       * do período. A semana é a da planilha de rentabilidade — dias
       * 1–7, 8–14… (`semanaDe` na tela) —, e cada semana que bate uma
       * faixa paga o valor dela; as semanas somam. A quinzena é do dia 1
       * ao 15, e paga uma vez. */
      const k = x.metrica || "carros";
      const lista = x.periodo === "quinzena1" ? [x.escopo === "loja" ? met.q1.loja : met.q1.proprio]
        : (x.escopo === "loja" ? met.sem.loja : met.sem.proprio);
      const partes = [];
      let total = 0;
      lista.forEach((mm, w) => {
        if (!mm) return;
        const atual = daMetrica(mm, k, 0);
        const batidas = (x.faixas || []).filter((f) => atual >= f.de);
        const paga = (f) => (f.pct ? (mm.rent * f.valor) / 100 : f.valor);
        const pago = x.soma ? batidas.reduce((t, f) => t + paga(f), 0) : (batidas.length ? paga(batidas[batidas.length - 1]) : 0);
        const ultima = batidas[batidas.length - 1];
        total += pago;
        if (pago || atual) partes.push(`${x.periodo === "quinzena1" ? "1ª quinzena" : `sem ${w + 1}`}: ${fmtMetrica(k, atual)}` +
          `${pago ? ` → ${!x.soma && ultima && ultima.pct ? `${ultima.valor}% de ${brl(mm.rent)} = ` : ""}${brl(pago)}` : ""}`);
      });
      return { valor: total, conta: partes.length ? partes.join(" · ") : `nenhum ${x.periodo === "quinzena1" ? "resultado na quinzena" : "resultado nas semanas"}` };
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

/** O combinado inteiro: peça a peça, e o total. `perfil` é o perfil de
 *  remuneração ligado (0082): as peças dele vêm antes das da pessoa. */
function calcular(plano, met, perfil) {
  const pecas = ((perfil && perfil.pecas) || []).map((x) => ({ ...x, doPerfil: true })).concat((plano && plano.pecas) || []);
  const linhas = pecas.map((x) => {
    const r = calcularPeca(x, met);
    return { tipo: x.tipo, rotulo: x.rotulo || TIPOS[x.tipo], valor: Math.round(r.valor * 100) / 100, conta: r.conta, do_perfil: !!x.doPerfil,
             fixo: x.tipo === "fixo", bonus: x.tipo.indexOf("bonus") === 0 };
  });
  return { linhas, total: linhas.reduce((t, l) => t + l.valor, 0) };
}

/** As métricas no ritmo do mês: somas esticadas até o fim; razões iguais.
 *  Nas semanas, as que ainda não chegaram repetem a média das que já
 *  passaram; a 1ª quinzena se estica só enquanto não terminou. */
function noRitmo(met, fator, dia, diasNoMes) {
  const esticar = (m, f) => (m ? { carros: Math.round(m.carros * f * 10) / 10, rent: m.rent * f, fluxo: m.fluxo * f, fechados: m.fechados * f } : m);
  const semanas = (arr) => {
    if (!arr || !dia) return arr;
    const atual = semanaDoDia(dia);
    const feitas = arr.slice(0, atual);
    const media = { carros: 0, rent: 0, fluxo: 0, fechados: 0 };
    feitas.forEach((m) => { Object.keys(media).forEach((k) => { media[k] += (m && m[k]) || 0; }); });
    Object.keys(media).forEach((k) => { media[k] = feitas.length ? media[k] / feitas.length : 0; });
    // A semana corrente se estica pelo tamanho DELA (a 1ª tem 8 dias, a
    // 4ª vai até o fim do mês).
    const ini = PRIMEIRO_DIA_DA_SEMANA[atual - 1];
    const fim = atual < 4 ? PRIMEIRO_DIA_DA_SEMANA[atual] - 1 : diasNoMes || 31;
    return arr.map((m, i) => (i < atual - 1 ? m : i === atual - 1 ? esticar(m, (fim - ini + 1) / Math.max(1, dia - ini + 1)) : media));
  };
  const fq = dia && dia < 15 ? 15 / dia : 1;
  return {
    proprio: esticar(met.proprio, fator), loja: esticar(met.loja, fator), lucro: met.lucro * fator,
    sem: met.sem ? { proprio: semanas(met.sem.proprio), loja: semanas(met.sem.loja) } : met.sem,
    q1: met.q1 ? { proprio: esticar(met.q1.proprio, fq), loja: esticar(met.q1.loja, fq) } : met.q1,
  };
}

module.exports = { TIPOS, limpar, calcular, noRitmo, semanaDoDia, semanaDaPlanilha };
