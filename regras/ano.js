/**
 * O ANO: qual área de gasto ficou VAZIA num mês do sistema (decisão 70).
 *
 * O Derek, em 18/11/2026: *"porque não ta mostrando o DRE certo de
 * outubro?"*. Outubro saiu com 7 Financeiro e 8 Impostos em 0,00. A conta
 * estava certa — não havia NENHUM lançamento nem título com competência de
 * outubro nesses grupos: o DAS de outubro vence em 20/11 e ainda não
 * existe no sistema, o DAS de setembro (pago em 20/10) e a fatura do
 * cartão de 15/10 foram marcados com competência de setembro (que é mês
 * da planilha), e os juros do capital de giro estão em 9.07, fora do DRE.
 *
 * O erro era a tela mostrar isso como "0,00" — que se lê como "não houve
 * gasto". Esta regra diz quando o zero é falta de lançamento: a área teve
 * valor em todos os meses da planilha logo antes do corte e no mês do
 * sistema não tem nada. A tela troca o 0,00 por um aviso, e o resultado
 * do mês não é inventado — ele continua sem a área, e diz isso.
 *
 * Quem lê isto: `api/financeiro.js` (anoGestao). Teste:
 *     node ferramentas-ano.js
 */

const JANELA = 3;      // meses da planilha antes do corte que servem de referência
const MINIMO = 1;      // abaixo de R$ 1 a área não "tinha valor"

/**
 * meses: [{ competencia: "aaaa-mm-01", fonte, grupos: { "2": 123, ... }, linhas: { "8": { "Imposto": 9000 } } }]
 * grupos: [{ codigo, nome }]
 * Devolve { "aaaa-mm-01": [{ grupo, nome, media, linhas }] } só para os meses do sistema.
 */
function faltando(meses, grupos) {
  const ord = (meses || []).filter(Boolean).slice().sort((a, b) => String(a.competencia).localeCompare(String(b.competencia)));
  const plan = ord.filter((m) => m.fonte === "planilha").slice(-JANELA);
  const out = {};
  if (plan.length < JANELA) return out;
  const val = (m, g) => Math.abs(Number(((m && m.grupos) || {})[g]) || 0);
  ord.filter((m) => m.fonte === "sistema" || m.fonte === "andamento").forEach((m) => {
    (grupos || []).forEach((g) => {
      const cod = String(g.codigo);
      if (!plan.every((p) => val(p, cod) >= MINIMO)) return;
      if (val(m, cod) >= 0.01) return;
      const media = Math.round(plan.reduce((t, p) => t + val(p, cod), 0) / plan.length * 100) / 100;
      const nomes = Array.from(new Set(plan.flatMap((p) => Object.keys(((p.linhas || {})[cod]) || {})))).sort();
      (out[m.competencia] = out[m.competencia] || []).push({ grupo: cod, nome: g.nome, media, linhas: nomes });
    });
  });
  return out;
}

module.exports = { faltando, JANELA };
