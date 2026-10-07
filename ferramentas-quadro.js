/**
 * As regras do quadro de leads que ficam nas mãos da pré-venda:
 * em que coluna o lead cai, quando ele está "fora da região" e o dia
 * que a conversa mostra.
 *
 * **As funções são lidas do `index.html`, não copiadas** — cópia de
 * código dentro de teste envelhece calada, e aí o teste passa enquanto
 * a tela erra (mesma regra do `ferramentas-agendamento.js`).
 *
 *     node ferramentas-quadro.js
 */
const fs = require("fs");
const fonte = fs.readFileSync(`${__dirname}/index.html`, "utf8");

const pega = (de, ate) => {
  const i = fonte.indexOf(de), j = fonte.indexOf(ate, i);
  if (i < 0 || j < 0) { console.error(`não achei o trecho "${de}" … "${ate}" — o teste precisa ser arrumado junto`); process.exit(1); }
  return fonte.slice(i, j);
};
const codigo = [
  pega("const semAcento = ", "\n") ,
  pega("const hojeEmSP = () =>", "\n\nconst MESES_PT"),
  pega("const COLUNAS_LEAD = [", "/* A ESCOLHA DE QUAL NÚMERO LIGA."),
  pega("const REGIAO_LOJA = [", "function ConversaPopup("),
  pega("const diaDaMensagem = ", "function ListaDeBaloes("),
].join("\n");
const { etapaDoLead, foraDaRegiao, escondidoPorFora, diaDaMensagem, rotuloDoDia, hojeEmSP } = new Function(
  `${codigo}\nreturn { etapaDoLead, foraDaRegiao, escondidoPorFora, diaDaMensagem, rotuloDoDia, hojeEmSP };`)();

let erros = 0, total = 0;
const confere = (rotulo, got, esperado) => {
  total++;
  if (got !== esperado) { erros++; console.log(`FALHOU  ${rotulo}: deu ${JSON.stringify(got)}, esperava ${JSON.stringify(esperado)}`); }
};

// ---- a coluna: o contato futuro sai da DATA, não do status ----
const col = (l) => etapaDoLead(l).id;
confere("novo sem data",                 col({ status: "novo" }), "novo");
confere("em contato sem data",           col({ status: "em_contato" }), "agendar");
confere("em contato COM retorno",        col({ status: "em_contato", proximo_contato: "2026-10-09" }), "futuro");
confere("novo COM retorno",              col({ status: "novo", proximo_contato: "2026-10-09" }), "futuro");
confere("agendado ignora retorno velho", col({ status: "agendado", proximo_contato: "2026-10-09" }), "agendado");
confere("confirmado",                    col({ status: "confirmado" }), "agendado");
confere("não veio mantém Reagendar",     col({ status: "nao_compareceu", proximo_contato: "2026-10-09" }), "reagendar");
confere("compareceu",                    col({ status: "compareceu", proximo_contato: "2026-10-09" }), "compareceu");
confere("perdido",                       col({ status: "perdido", proximo_contato: "2026-10-09" }), "perdido");
confere("status desconhecido cai em Novo", col({ status: "xyz" }), "novo");

// ---- fora da região: a marca à mão SOMA com a cidade ----
confere("marcado à mão, sem cidade",     foraDaRegiao({ fora_regiao: true }), true);
confere("marcado à mão, cidade da loja", foraDaRegiao({ fora_regiao: true, cidade: "Joinville" }), true);
confere("sem nada",                      foraDaRegiao({}), false);
confere("cidade em branco NÃO é fora",   foraDaRegiao({ cidade: "" }), false);
confere("cidade só com espaço",          foraDaRegiao({ cidade: "   " }), false);
confere("Joinville",                     foraDaRegiao({ cidade: "Joinville" }), false);
confere("caixa e espaço sobrando",       foraDaRegiao({ cidade: "  JOINVILLE " }), false);
confere("acento: Jaraguá do Sul",        foraDaRegiao({ cidade: "Jaraguá do Sul" }), false);
confere("acento: São Francisco do Sul",  foraDaRegiao({ cidade: "São Francisco do Sul" }), false);
confere("Curitiba",                      foraDaRegiao({ cidade: "Curitiba" }), true);
confere("Blumenau (90 km, fora da lista)", foraDaRegiao({ cidade: "Blumenau" }), true);
confere("marca desligada explícita",     foraDaRegiao({ fora_regiao: false, cidade: "Joinville" }), false);
confere("lead nulo não quebra",          foraDaRegiao(null), false);
// O Diego marcou Rio Negrinho como fora (07/10/2026); Mafra e Itaiópolis são mais longe.
confere("Rio Negrinho é fora",           foraDaRegiao({ cidade: "RIO NEGRINHO" }), true);
confere("Mafra é fora",                  foraDaRegiao({ cidade: "Mafra" }), true);
confere("Itaiópolis é fora",             foraDaRegiao({ cidade: "Itaiópolis" }), true);

// ---- quem é de fora sai da FILA DE TRABALHO, mas não das visitas já marcadas ----
const longe = { fora_regiao: true };
confere("fora some de Novo",             escondidoPorFora(longe, "novo"), true);
confere("fora some de Agendar",          escondidoPorFora(longe, "agendar"), true);
confere("fora some de Contato futuro",   escondidoPorFora(longe, "futuro"), true);
confere("fora com hora marcada FICA",    escondidoPorFora(longe, "agendado"), false);
confere("fora que não veio FICA",        escondidoPorFora(longe, "reagendar"), false);
confere("fora que compareceu FICA",      escondidoPorFora(longe, "compareceu"), false);
confere("fora que foi perdido FICA",     escondidoPorFora(longe, "perdido"), false);
confere("quem é daqui nunca some",       escondidoPorFora({ cidade: "Joinville" }, "agendar"), false);
confere("cidade em branco não some",     escondidoPorFora({}, "novo"), false);
confere("fora só pela cidade também some", escondidoPorFora({ cidade: "Curitiba" }, "agendar"), true);

// ---- o dia da conversa: o relógio é o de Joinville ----
confere("22h30 em Joinville ainda é ontem", diaDaMensagem("2026-10-07T01:30:00Z"), "2026-10-06");
confere("meio-dia",                      diaDaMensagem("2026-10-07T15:00:00Z"), "2026-10-07");
confere("data inválida",                 diaDaMensagem("não é data"), "");
confere("sem data",                      diaDaMensagem(null), "");
const hoje = hojeEmSP();
const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
confere("hoje",                          rotuloDoDia(hoje), "Hoje");
confere("ontem",                         rotuloDoDia(ontem), "Ontem");
confere("data antiga",                   rotuloDoDia("2026-10-06") === "06/10/2026" || ["Hoje", "Ontem"].indexOf(rotuloDoDia("2026-10-06")) >= 0, true);
confere("data antiga, formato",          rotuloDoDia("2025-03-09"), "09/03/2025");

console.log(erros ? `\n${erros} de ${total} falharam` : `${total} casos, todos passaram`);
process.exit(erros ? 1 : 0);
