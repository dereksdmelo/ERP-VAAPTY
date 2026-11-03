/* Os casos da roda da fila da vez (regras/fila.js), um por regra do
 * Derek de 03/11/2026.   node ferramentas-fila.js */
const F = require("./regras/fila.js");
let falhas = 0;
const ok = (cond, msg) => { if (!cond) { falhas++; console.log("FALHOU:", msg); } else console.log("ok   ", msg); };

const AGORA = Date.parse("2026-11-03T15:00:00Z");
const est = (pessoas, extra) => ({
  circulo: Object.keys(pessoas), pessoas, ponteiro: null, creditos: {}, aberto: true, agora: AGORA, ...(extra || {}),
});
const livre = { presente: true, atendendo: 0 };
const ocupado = { presente: true, atendendo: 1, fim_ultimo: 0 };
const ausente = { presente: false, atendendo: 0 };

// 1. A ordem é a do índice e a roda anda um por cliente.
let e = est({ T: livre, A: livre, M: livre });
let x = F.escolher(e);
ok(x.quem === "T" && x.prox === "A" && x.via === "roda", "o primeiro do índice pega; a roda vai para o segundo");
e = F.aplicar(e, x);
e.pessoas.T = { ...e.pessoas.T, atendendo: 1 };
ok(F.escolher(e).quem === "A", "o segundo cliente é do segundo");

// 2. Atendendo na vez dele: pula, fica devendo.
e = est({ T: ocupado, A: livre, M: livre });
x = F.escolher(e);
ok(x.quem === "A" && x.pulos.length === 1 && x.pulos[0].motivo === "ocupado", "ocupado na vez é pulado");
e = F.aplicar(e, x);
ok((e.creditos.T || []).length === 1, "quem foi pulado fica devendo a vez");

// 3. A vez devida volta dez minutos depois de encerrar — antes da roda.
e.pessoas.T = { presente: true, atendendo: 0, fim_ultimo: AGORA - 5 * 60000 };
ok(F.escolher(e).quem === "M", "com cinco minutos de livre, ainda não");
e.pessoas.T.fim_ultimo = AGORA - 11 * 60000;
x = F.escolher(e);
ok(x.quem === "T" && x.via === "credito" && x.prox === e.ponteiro, "com dez minutos, é dele, e a roda não anda");

// 4. Fora da fila na vez dele: perde a volta, sem crédito.
e = est({ T: ausente, A: livre, M: livre });
x = F.escolher(e);
ok(x.quem === "A" && x.pulos[0].motivo === "ausente", "quem não está perde a vez");
e = F.aplicar(e, x);
ok(!(e.creditos.T || []).length, "e não fica devendo");

// 5. Todos atendendo: a roda segue, o da vez pega o segundo.
e = est({ T: ocupado, A: ocupado, M: ocupado });
x = F.escolher(e);
ok(x.quem === "T" && x.via === "todos_ocupados" && !x.pulos.length, "todos ocupados: o da vez pega o segundo");
e = F.aplicar(e, x);
ok(F.escolher(e).quem === "A", "e o próximo também");

// 6. Quem passou o cliente não é escolhido de novo para ele.
e = est({ T: livre, A: livre });
ok(F.escolher(e, ["T"]).quem === "A", "quem passou não volta para o mesmo cliente");

// 7. Fora do horário: ninguém perde, só não é chamado.
e = est({ T: ausente, A: livre }, { aberto: false });
x = F.escolher(e);
ok(x.quem === "A" && x.pulos[0].motivo === "fora_do_horario", "depois das 18h não é perda");

// 8. Eventos viram estado.
const s = F.estadoDosEventos([
  { tipo: "pulou", perfil_id: "T", criado_em: "2026-11-03T13:00:00Z" },
  { tipo: "vez", perfil_id: "A", via: "roda", prox: "M", criado_em: "2026-11-03T13:00:01Z" },
  { tipo: "vez", perfil_id: "T", via: "credito", prox: "M", criado_em: "2026-11-03T14:00:00Z" },
]);
ok(s.ponteiro === "M" && !(s.creditos.T || []).length, "o crédito usado sai; o ponteiro é o do último evento");

// 9. Quem chega depois do primeiro cliente vai para o fim.
const pes = [
  { perfil_id: "T", indice_at: 5, indice_anterior: 0, chegou_em: "2026-11-03T11:00:00Z" },
  { perfil_id: "A", indice_at: 3, indice_anterior: 0, chegou_em: "2026-11-03T11:10:00Z" },
  { perfil_id: "X", indice_at: 9, indice_anterior: 0, chegou_em: "2026-11-03T14:00:00Z" },
];
ok(F.circuloDoDia(pes, null).join() === "X,T,A", "antes do primeiro cliente, vale o índice");
ok(F.circuloDoDia(pes, [{ perfil_id: "T" }, { perfil_id: "A" }]).join() === "T,A,X", "depois, quem chegou entra no fim");

// 10. O horário da loja.
ok(F.horarioAberto(null, Date.parse("2026-11-03T13:00:00Z")) === true, "terça 10h: aberta");
ok(F.horarioAberto(null, Date.parse("2026-11-03T21:30:00Z")) === false, "terça 18h30: fechada");
ok(F.horarioAberto(null, Date.parse("2026-11-07T17:00:00Z")) === false, "sábado 14h: fechada");

if (falhas) { console.log(`\n${falhas} falha(s).`); process.exit(1); }
console.log("\ntodos os casos passaram.");
