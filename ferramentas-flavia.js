/**
 * As regras da Flávia que não podem depender do modelo.
 *
 * O texto que ela escreve é julgado pelo gerente, no treino (0069). O
 * que está aqui é o que ela NÃO decide: quais horários existem, onde
 * começa e termina cada ponto da conversa, que agendamento vale e que
 * hora de parede é "agora". Erro em qualquer um desses põe cliente na
 * agenda num horário que a loja não tem — e o modelo não tem como
 * perceber.
 *
 * **Lê o próprio `ia/flavia.js`**, o mesmo que o `api/atendimento.js`
 * carrega — nada é copiado para cá.
 *
 *     node ferramentas-flavia.js
 */
const F = require("./ia/flavia.js");

let falhas = 0;
const confere = (nome, obtido, esperado) => {
  const a = JSON.stringify(obtido), b = JSON.stringify(esperado);
  if (a === b) console.log(`  ok  ${nome}`);
  else { falhas++; console.log(`  XX  ${nome}\n      esperado ${b}\n      obtido   ${a}`); }
};
const cfg = { ...F.CONFIG_PADRAO };

console.log("relógio de Joinville");
// 22h30 de quinta em Joinville já é sexta em UTC (a armadilha da decisão 22).
confere("noite não vira o dia seguinte", F.paredeDe("2026-10-09T01:30:00Z"), "2026-10-08T22:30");
confere("manhã", F.paredeDe("2026-10-08T12:00:00Z"), "2026-10-08T09:00");

console.log("horários do dia (0068)");
confere("segunda começa às 9h, não 8h30", F.horariosDoDia(cfg, "2026-10-19")[0], "09:00");
confere("segunda termina às 18h", F.horariosDoDia(cfg, "2026-10-19").slice(-1)[0], "18:00");
confere("sábado vai até 13h", F.horariosDoDia(cfg, "2026-10-17"), ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00"]);
confere("domingo fechado", F.horariosDoDia(cfg, "2026-10-18"), []);
confere("intervalo de uma hora", F.horariosDoDia({ ...cfg, intervalo_min: 60 }, "2026-10-19").length, 10);

console.log("horários livres");
// Sexta 16/10, 17h05: hoje sobram 17h30 e 18h (folga de 20 minutos),
// depois sábado, e domingo é pulado.
const l1 = F.horariosLivres(cfg, "2026-10-16T17:05", []);
confere("hoje respeita a folga de 20 minutos", l1[0].horarios, ["17:30", "18:00"]);
confere("pula o domingo", l1.map((d) => d.iso), ["2026-10-16", "2026-10-17", "2026-10-19"]);
confere("marca hoje e amanhã", [l1[0].hoje, l1[1].amanha], [true, true]);
// Às 17h50 de sexta não sobra nada hoje: o primeiro dia é o sábado.
confere("dia sem horário sai da lista", F.horariosLivres(cfg, "2026-10-16T17:50", [])[0].iso, "2026-10-17");
// O caso do replay: 11h37, o cliente pede 12h.
confere("meio-dia ainda cabe às 11h37", F.horariosLivres(cfg, "2026-10-13T11:37", [])[0].horarios[0], "12:00");
const cheio = Array(F.POR_HORARIO).fill("2026-10-17T09:00:00");
confere("horário lotado não é oferecido", F.horariosLivres(cfg, "2026-10-16T17:50", cheio)[0].horarios[0], "09:30");
confere("um a menos que o teto ainda cabe", F.horariosLivres(cfg, "2026-10-16T17:50", cheio.slice(1))[0].horarios[0], "09:00");

console.log("pontos da conversa");
const M = (id, eco, texto, quando, tipo) => ({ id, eco, tipo: tipo || "texto", texto, quando });
const conversa = [
  M("a", true, "Oi! Tudo certo pra amanhã?", "2026-10-07T20:00:00Z"),   // lembrete antes do cliente falar
  M("b", false, "Boa tarde", "2026-10-07T20:01:00Z"),
  M("c", false, "Quero vender meu Gol", "2026-10-07T20:01:30Z"),
  M("d", true, "Oi! Sou a Ana.", "2026-10-07T20:02:00Z"),
  M("e", true, "Qual o ano?", "2026-10-07T20:02:10Z"),
  M("f", false, null, "2026-10-07T20:03:00Z", "midia"),
];
const pts = F.pontosDe(conversa);
confere("mensagem da loja antes do cliente não vira ponto", pts.length, 2);
confere("o ponto é a ÚLTIMA mensagem do bloco do cliente", pts[0].mensagem_id, "c");
confere("o bloco do cliente vai junto", pts[0].cliente, "Boa tarde\nQuero vender meu Gol");
confere("a resposta real são as mensagens seguidas da loja", pts[0].original, "Oi! Sou a Ana.\n\nQual o ano?");
confere("cliente sem resposta também é ponto", [pts[1].mensagem_id, pts[1].original], ["f", ""]);

console.log("a conversa que vai ao modelo");
const txt = F.conversaEmTexto([M("x", false, "meu fone é 47 99624-1555 e o cpf 123.456.789-09", "2026-10-07T20:01:00Z")]);
confere("telefone e CPF não saem daqui", /99624|456\.789/.test(txt), false);
confere("a hora é a de Joinville", txt.includes("07/10 17:01"), true);

console.log("a saída do modelo");
const livres = F.horariosLivres(cfg, "2026-10-16T10:00", []);
confere("lê o JSON mesmo embrulhado", F.lerSaida('```json\n{"mensagens":["Oi!"],"agendar":""}\n```', livres).mensagens, ["Oi!"]);
confere("agendamento dentro da lista vale", F.lerSaida('{"mensagens":["Fechado!"],"agendar":"2026-10-17T09:00"}', livres).agendar, "2026-10-17T09:00");
// Sábado às 15h a loja está fechada: o modelo inventou.
const fora = F.lerSaida('{"mensagens":["Fechado!"],"agendar":"2026-10-17T15:00"}', livres);
confere("hora inventada não agenda, e fica marcada", [fora.agendar, fora.fora_da_lista], ["", true]);
confere("no máximo três mensagens", F.lerSaida('{"mensagens":["1","2","3","4"]}', livres).mensagens.length, 3);
confere("sem mensagem não é resposta", F.lerSaida('{"mensagens":[]}', livres), null);
const solto = F.lerSaida("Claro, posso ajudar!", livres);
confere("texto solto vale, marcado e sem agendar", [solto.mensagens, solto.formato_livre, solto.agendar], [["Claro, posso ajudar!"], true, ""]);
confere("JSON quebrado não é resposta", F.lerSaida('{"mensagens": ["oi"', livres), null);

console.log("a instrução");
const ins = F.instrucao({ ...cfg, ia_nome: "Marta" }, "2026-10-16T10:00", livres, [{ cliente: "quanto vale?", correcao: "O valor sai da avaliação." }]);
confere("o nome vem da configuração", ins.includes("Você é a Marta"), true);
confere("os horários livres estão lá", ins.includes("sábado 17/10 (2026-10-17): 09:00"), true);
confere("o sábado diz até 13h", ins.includes("Sábado: a loja abre às 09:00; agendamentos de 09:00 a 13:00"), true);
confere("a correção do gerente vira exemplo", ins.includes("Resposta aprovada: O valor sai da avaliação."), true);
confere("intermediação, não compra", ins.includes("Nunca diga que \"a loja compra\""), true);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
process.exit(falhas ? 1 : 0);
