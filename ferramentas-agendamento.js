/**
 * O leitor de data e hora das mensagens da IA.
 *
 * **Os casos são mensagens REAIS da Ana e da Camila**, colhidas do
 * banco em 05/10/2026 — não exemplos inventados. Foi lendo as 22 que
 * ficou claro que a maior parte das mensagens que falam em hora é
 * PROPOSTA, não confirmação, e que achar data e hora não bastava.
 *
 * **A função é lida do `api/atendimento.js`, não copiada.** Cópia de
 * código dentro de teste envelhece calada: o teste passa enquanto o
 * sistema erra (mesma regra do `ferramentas-sincronizacao.js`).
 *
 *     node ferramentas-agendamento.js
 */
const fs = require("fs");

const fonte = fs.readFileSync(`${__dirname}/api/atendimento.js`, "utf8");
const ini = fonte.indexOf("const MESES_TXT = {");
const fim = fonte.indexOf("async function ponte(req, res) {");
if (ini < 0 || fim < 0) {
  console.error("não achei o leitor no api/atendimento.js — o teste precisa ser arrumado junto");
  process.exit(1);
}
eval(fonte.slice(ini, fim));

// Segunda-feira, 05/10/2026, 17h em Joinville.
const BASE = new Date("2026-10-05T20:00:00Z");
const hm = (iso) => new Date(iso).toLocaleString("pt-BR",
  { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
  .replace(",", "").replace(/\s+/g, " ");

const MARCA = [
  ["fica combinado pra amanha as 9h30", "06/10 09:30"],
  ["Te espero amanha as 10:30 aqui na loja pra gente avaliar esse Peugeot!", "06/10 10:30"],
  ["Nosso encontro ta confirmadissimo pra amanha as 17:30, ta bom? Te esperamos!", "06/10 17:30"],
  ["Sua avaliacao da Honda Biz ES ficou agendada para quarta-feira, dia 7, as 10h. Esperamos voce!", "07/10 10:00"],
  ["Agendamento Confirmado! Ola Hector! Seu horario para a avaliacao do veiculo esta confirmado para o dia 07/10/2026 as 10:00.", "07/10 10:00"],
  ["Fechado, Rafael! Agendado aqui para amanha, terca-feira (06/10), as 10:30.", "06/10 10:30"],
  ["Ja deixei tudo certo aqui para amanha as 09:30, te espero", "06/10 09:30"],
  ["Fechado entao, te espero amanha as 09:30 pra gente avaliar esse Virtus", "06/10 09:30"],
  ["como a gente ja conversou e combinou tudo, seu horario para hoje as 17h", "05/10 17:00"],
  ["te espero sabado as 10h aqui na loja", "10/10 10:00"],
];

/* AS QUE NÃO PODEM MARCAR são o coração do teste. Agendamento falso é
 * pior que nenhum: põe na agenda da semana gente que não vai aparecer,
 * e a pré-venda deixa de ligar para quem ainda não marcou. */
const NAO_MARCA = [
  ["ta agendadinho pra amanha", "sem hora"],
  ["Tudo bem! Tenho quarta-feira as 9h ou as 10h. Qual horario fica melhor para voce?", "proposta com duas horas"],
  ["Oi, Hector! Tenho hoje as 17h ou amanha as 9h para avaliar sua Biz ES. Qual horario fica melhor?", "proposta com duas horas"],
  ["Mas atendemos no sabado sim, das 08:30 as 12:30! Ficaria bom pra voce passar aqui nesse sabado agora?", "horario de funcionamento"],
  ["Sair de Pirabeiraba as 17h fica bem apertado pra chegar aqui antes de a gente fechar", "hora sem marcacao"],
  ["Certo! Sabado as 10h fica como preferencia para os dois, sujeito a confirmacao", "sujeito a confirmacao"],
  ["Perfeito, Eduardo! Sabado as 10h e sua preferencia. O horario ainda nao esta confirmado.", "diz que nao esta confirmado"],
  ["A avaliacao da lancha depende de confirmacao. O sabado as 10h era para o Tiida; voce gostaria de incluir a lancha?", "pergunta"],
  ["No sabado, tenho as 9h ou as 10h. Qual desses horarios fica melhor para voce?", "proposta"],
  ["Ja liberei seu horario das 15:30 aqui. Quer aproveitar e ja deixar marcado pra amanha ou quarta-feira?", "liberou o horario, nao marcou"],
  ["Tenho vaga as 09:30 ou as 15:00, qual prefere?", "proposta"],
  ["Pra amanha cedo aqui na loja, eu tenho disponivel as 09:30 ou as 10:30. Qual fica melhor?", "proposta"],
  ["Hoje a gente atende ate as 18h. Se quiser, tenho horario livre as 16:30", "horario livre"],
  ["o carro e 2010/2011 e rodou 85.000 km", "ano do carro"],
  ["consigo 29.900 a vista, fechado?", "valor"],
];

let erros = 0;
for (const [t, esperado] of MARCA) {
  const r = dataHoraConfirmada(t, BASE);
  const got = r ? hm(r) : "NADA";
  if (got !== esperado) {
    erros++;
    console.log(`FALHOU  devia marcar ${esperado}, deu ${got}\n        ${t.slice(0, 90)}`);
  }
}
for (const [t, porque] of NAO_MARCA) {
  const r = dataHoraConfirmada(t, BASE);
  if (r) {
    erros++;
    console.log(`FALHOU  marcou ${hm(r)} e nao devia (${porque})\n        ${t.slice(0, 90)}`);
  }
}

console.log(erros
  ? `\n${erros} de ${MARCA.length + NAO_MARCA.length} falharam`
  : `${MARCA.length + NAO_MARCA.length} casos reais, todos passaram`);
process.exit(erros ? 1 : 0);
