/**
 * O teste do aviso de área vazia na aba Ano (regras/ano.js).
 *
 *     node ferramentas-ano.js
 *
 * Os números são os que a tela Ano de 2026 devolveu em 18/11/2026 (só os
 * totais por grupo): ago e set da planilha, out do sistema com 7 e 8 em
 * zero, nov em andamento com 7 de volta (a fatura do cartão) e 8 ainda vazio.
 */
const { faltando } = require("./regras/ano.js");

let falhas = 0;
const confere = (nome, ok, detalhe) => {
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"}  ${nome}${ok ? "" : `  ${detalhe || ""}`}`);
};

const grupos = ["Custos do negócio", "Pessoas", "Ocupação", "Comercial e marketing", "Administrativo", "Financeiro", "Impostos sobre faturamento"]
  .map((nome, i) => ({ codigo: String(i + 2), nome }));
const plan = (m, g7, g8) => ({ competencia: m, fonte: "planilha",
  grupos: { 2: 6052.01, 3: 130000.84, 4: 21371.56, 5: 61343.99, 6: 19355.32, 7: g7, 8: g8 },
  linhas: { 7: { "Empréstimo (parcelas)": g7 }, 8: { Imposto: g8 } } });
const meses = [
  plan("2026-07-01", 1585.63, 13392.06),
  plan("2026-08-01", 487.84, 8387.5),
  plan("2026-09-01", 487.84, 7547.78),
  { competencia: "2026-10-01", fonte: "sistema", grupos: { 2: 6571.32, 3: 107215.65, 4: 19267.29, 5: 53543.54, 6: 10778.8 } },
  { competencia: "2026-11-01", fonte: "andamento", grupos: { 2: 4254.87, 3: 12215.12, 4: 17061.49, 5: 71256.47, 6: 8880.29, 7: 10349.17 } },
];

const f = faltando(meses, grupos);
const out = (f["2026-10-01"] || []).map((x) => x.grupo).sort().join(",");
confere("outubro: faltam 7 e 8", out === "7,8", `veio ${out}`);
const g8 = (f["2026-10-01"] || []).find((x) => x.grupo === "8") || {};
confere("outubro: média do 8 nos 3 meses da planilha", g8.media === 9775.78, `veio ${g8.media}`);
confere("outubro: diz qual linha da planilha era", (g8.linhas || []).join() === "Imposto", `veio ${g8.linhas}`);
const nov = (f["2026-11-01"] || []).map((x) => x.grupo).join(",");
confere("novembro: só o 8 (o 7 voltou com a fatura)", nov === "8", `veio ${nov}`);
confere("mês da planilha nunca leva aviso", !f["2026-09-01"]);

// Área que já faltava na planilha não é cobrada no sistema.
const semRoyal = meses.map((m) => (m.fonte === "planilha" && m.competencia === "2026-08-01" ? { ...m, grupos: { ...m.grupos, 7: 0 } } : m));
confere("área vazia num mês da planilha não acende", !(faltando(semRoyal, grupos)["2026-10-01"] || []).some((x) => x.grupo === "7"));

// Centavo de sobra não conta como gasto lançado; um lançamento de verdade apaga o aviso.
const comDas = meses.map((m) => (m.competencia === "2026-10-01" ? { ...m, grupos: { ...m.grupos, 8: 6470.29 } } : m));
confere("com o DAS lançado o 8 sai do aviso", !(faltando(comDas, grupos)["2026-10-01"] || []).some((x) => x.grupo === "8"));

// Sem três meses de planilha não há referência: nada é cobrado.
confere("menos de 3 meses de planilha: sem aviso", Object.keys(faltando(meses.slice(1), grupos)).length === 0);

if (falhas) { console.log(`\n${falhas} falha(s)`); process.exit(1); }
console.log("\ntudo certo");
