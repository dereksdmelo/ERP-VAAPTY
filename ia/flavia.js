/* A FLÁVIA: como ela pensa, em um lugar só (18/10/2026).
 *
 * Este arquivo é o que `ia/base-atendimento-lead.md` diz, virado
 * instrução. A base é a leitura das conversas da Ana e da Camila que
 * levaram o cliente à loja; aqui está o que sobrou dela para o modelo
 * — **quem mudar o roteiro muda os dois**, senão a Flávia passa a
 * fazer uma coisa e a base a dizer outra.
 *
 * **Mora fora de `api/` de propósito.** Arquivo em `api/` é função da
 * Vercel, e o teto de 12 está cheio; um módulo que `api/atendimento.js`
 * importa não conta. E fora de `api/` ele não é publicado: a lista do
 * `.assetsignore` é de permissão (decisão 48), e `ia/` não está nela.
 *
 * **Nada aqui fala com rede nem com banco.** São funções puras — o
 * prompt, os horários livres, a conversa em texto, a leitura da saída
 * — para que `ferramentas-flavia.js` as teste sem chave nem login.
 *
 * **A hora é de parede de Joinville, em texto**, como no resto do
 * sistema (decisão 51): "2026-10-08T09:00" quer dizer nove da manhã
 * na loja. Quem converter para UTC aqui marca o cliente três horas
 * adiante, que é o erro que já custou trinta leads.
 */

// Os valores de 17/10/2026, para quando a 0068 não responder. São os
// mesmos do `CONFIG_LOJA_PADRAO` da tela e do api/perfil.js.
const CONFIG_PADRAO = {
  ia_nome: "Flávia",
  semana_abre: "08:30", semana_primeiro: "09:00", semana_ultimo: "18:00",
  sabado_abre: "09:00", sabado_primeiro: "09:00", sabado_ultimo: "13:00",
  domingo_abre: null, domingo_primeiro: null, domingo_ultimo: null,
  intervalo_min: 30,
};

const ENDERECO = "Rua Anita Garibaldi, 705 — bairro Anita Garibaldi, Joinville/SC, em frente à Panificadora Anita";
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

// Quantos clientes cabem no mesmo horário. A loja recebe mais de um
// carro por vez, mas o número da casa não está escrito em lugar
// nenhum — é pergunta para o Derek, e por isso é uma constante com
// nome e não um 2 solto no meio da conta.
const POR_HORARIO = 2;
// Quantos dias à frente a Flávia oferece. As conversas que deram
// certo marcavam para hoje, amanhã ou depois; uma semana adiante é o
// cliente que esfria antes de chegar.
const DIAS_A_FRENTE = 3;
// Nada antes disto a partir de agora: oferecer "às 14h" às 13h50 é
// marcar um horário que o cliente não consegue cumprir. Era uma hora,
// e o primeiro replay mostrou o custo: às 11h37 o cliente pediu 12h —
// a Ana tinha oferecido, ele foi à loja — e para a Flávia o horário
// não existia.
const FOLGA_MIN = 20;

/* ------------------------- relógio ------------------------- */

// O instante, lido na parede de Joinville: "2026-10-08T09:00".
function paredeDe(instante) {
  const d = new Date(instante);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const minutosDe = (h) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(h || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
// Dia da semana de uma data de parede. Meio-dia em UTC cai no mesmo
// dia em qualquer fuso do Brasil, e não depende do relógio da máquina.
const diaDaSemana = (iso) => new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).getUTCDay();
const somaDias = (iso, n) => {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const grupoDe = (iso) => { const d = diaDaSemana(iso); return d === 0 ? "domingo" : d === 6 ? "sabado" : "semana"; };
const dataBR = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Os horários do dia pela configuração (0068) — a mesma conta do
 *  `horariosDoDia()` da tela, para a Flávia e o agendador oferecerem
 *  os mesmos. */
function horariosDoDia(cfg, iso) {
  const g = grupoDe(iso);
  const de = minutosDe(cfg[`${g}_primeiro`]), ate = minutosDe(cfg[`${g}_ultimo`]);
  const passo = Number(cfg.intervalo_min) || 30;
  const h = [];
  if (de == null || ate == null) return h;
  for (let m = de; m <= ate; m += passo) h.push(hhmm(m));
  return h;
}

/**
 * Os horários que a Flávia pode oferecer a partir de `agora` (parede
 * de Joinville), nos próximos dias em que a loja abre, tirando os que
 * já têm `POR_HORARIO` agendados. `ocupados` são as datas de parede
 * dos leads agendados ("2026-10-08T09:00:00" serve — só os 16
 * primeiros caracteres contam).
 */
function horariosLivres(cfg, agora, ocupados) {
  const cont = {};
  (ocupados || []).forEach((o) => { const k = String(o || "").slice(0, 16); if (k) cont[k] = (cont[k] || 0) + 1; });
  const hoje = agora.slice(0, 10);
  const limite = minutosDe(agora.slice(11)) + FOLGA_MIN;
  const dias = [];
  for (let i = 0; dias.length < DIAS_A_FRENTE && i < 10; i++) {
    const iso = somaDias(hoje, i);
    let h = horariosDoDia(cfg, iso);
    if (i === 0) h = h.filter((x) => minutosDe(x) >= limite);
    h = h.filter((x) => (cont[`${iso}T${x}`] || 0) < POR_HORARIO);
    if (h.length) dias.push({ iso, dia: DIAS[diaDaSemana(iso)], hoje: i === 0, amanha: i === 1, horarios: h });
  }
  return dias;
}

/* ------------------------- a conversa ------------------------- */

// Número longo é telefone, CPF, conta ou placa de financiamento: não
// muda a resposta e não precisa sair daqui (decisão 31 — só o texto
// vai, e o texto sem o que identifica).
const semNumeros = (t) => String(t || "").replace(/\d[\d .\-/]{7,}\d/g, "[número]");

const MIDIA = { image: "uma foto", audio: "um áudio", video: "um vídeo", document: "um documento", sticker: "uma figurinha" };
function linhaDa(m) {
  const quem = m.eco ? "LOJA" : "CLIENTE";
  const quando = paredeDe(m.quando);
  const rot = `${dataBR(quando.slice(0, 10))} ${quando.slice(11)}`;
  if (m.tipo === "texto" || m.tipo === "botao") return `${quem} (${rot}): ${semNumeros(m.texto)}`;
  if (m.tipo === "reacao") return `${quem} (${rot}): [reagiu com um emoji]`;
  const tipo = (m.anexo && (m.anexo.tipo || m.anexo.mimetype || "")) || "";
  const qual = MIDIA[String(tipo).split("/")[0]] || "um arquivo";
  return `${quem} (${rot}): [mandou ${qual}${m.texto ? `: ${semNumeros(m.texto)}` : ""} — você não consegue abrir]`;
}

/** A conversa até o ponto, em texto. As mais antigas caem primeiro
 *  quando passa do teto: o que importa é o fim, e o começo (o carro,
 *  o nome) costuma se repetir nele. */
function conversaEmTexto(msgs, teto) {
  const linhas = (msgs || []).map(linhaDa);
  let t = linhas.join("\n");
  const max = teto || 8000;
  while (t.length > max && linhas.length > 4) { linhas.shift(); t = "[…começo da conversa omitido…]\n" + linhas.join("\n"); }
  return t;
}

/**
 * Os pontos de treino de uma conversa: cada bloco de mensagens do
 * cliente seguido do que a loja respondeu. O id do ponto é a ÚLTIMA
 * mensagem do cliente no bloco — é depois dela que alguém responde.
 * Bloco sem resposta também é ponto: o cliente que ficou falando
 * sozinho é justamente o que a Flávia não pode deixar.
 */
function pontosDe(msgs) {
  const pts = [];
  let cli = [], resp = [];
  const fecha = () => {
    if (!cli.length) return;
    const ult = cli[cli.length - 1];
    pts.push({
      mensagem_id: ult.id, quando: ult.quando,
      cliente: cli.map((m) => (m.tipo === "texto" ? m.texto : linhaDa(m).replace(/^CLIENTE \([^)]*\): /, ""))).join("\n"),
      original: resp.filter((m) => m.tipo === "texto" && m.texto).map((m) => m.texto).join("\n\n"),
    });
  };
  for (const m of msgs || []) {
    if (!m.eco) { if (resp.length) { fecha(); cli = []; resp = []; } cli.push(m); }
    else if (cli.length) resp.push(m);
  }
  fecha();
  return pts;
}

/* ------------------------- a instrução ------------------------- */

function horarioDaLoja(cfg) {
  const g = (nome, k) => (cfg[`${k}_abre`] ? `${nome}: a loja abre às ${cfg[`${k}_abre`]}; agendamentos de ${cfg[`${k}_primeiro`]} a ${cfg[`${k}_ultimo`]}` : `${nome}: fechado`);
  return [g("Segunda a sexta", "semana"), g("Sábado", "sabado"), g("Domingo", "domingo")].join("\n");
}

function livresEmTexto(dias) {
  if (!dias.length) return "(nenhum horário livre nos próximos dias — diga que vai verificar com a equipe e peça o melhor dia para o cliente)";
  return dias.map((d) => `${d.hoje ? "hoje, " : d.amanha ? "amanhã, " : ""}${d.dia} ${dataBR(d.iso)} (${d.iso}): ${d.horarios.join(", ")}`).join("\n");
}

function exemplosEmTexto(exemplos) {
  if (!exemplos || !exemplos.length) return "";
  return [
    "",
    "## Respostas que o gerente aprovou",
    "Situações reais e o que a loja quer que você responda nelas. Siga o jeito, não copie palavra por palavra.",
    ...exemplos.map((e, i) => `\n### Exemplo ${i + 1}\nO cliente escreveu: ${semNumeros(e.cliente).slice(0, 400)}\nResposta aprovada: ${semNumeros(e.correcao).slice(0, 600)}`),
  ].join("\n");
}

/**
 * O prompt de sistema. `agora` é a parede de Joinville; `livres` sai
 * de `horariosLivres()`; `exemplos` são as correções do gerente
 * (ia_treino, 0069).
 */
function instrucao(cfg, agora, livres, exemplos) {
  const nome = String(cfg.ia_nome || "Flávia").trim();
  return `Você é a ${nome}, do atendimento da Vaapty Joinville no WhatsApp.

## O que a Vaapty faz
A Vaapty INTERMEDEIA a venda de carros: encontra um comprador para qualquer carro, na rede de lojistas parceiros. O cliente traz o carro, faz uma avaliação gratuita (uns 20 a 40 minutos) e recebe a proposta na hora; só fecha se gostar, e se não gostar sai com o carro. Nunca diga que "a loja compra" o carro, e não prometa de quem nem como sai o pagamento — isso se explica na loja.

## Seu único objetivo
Levar o cliente até a loja com um horário marcado. Você não negocia, não avalia e não dá preço.

## O roteiro
As mensagens LOJA na conversa são da loja — trate como suas, mesmo que assinadas com outro nome. Não se apresente de novo se a loja já se apresentou, e não repita pergunta que a loja já fez.

1. Se a loja ainda não se apresentou nesta conversa, apresente-se numa linha ("Oi! Sou a ${nome}, da Vaapty Joinville").
2. Pergunte o carro: modelo e ano. Junto, na mesma mensagem, pergunte com quem você fala. Não repita a pergunta do nome se o cliente não respondeu — siga sem ele.
3. Assim que souber o carro, elogie em UMA frase, com motivo ("tem muita saída na nossa rede", "quitado ajuda bastante"), e na MESMA resposta ofereça DOIS horários concretos da lista de horários livres — do período que ele pediu, se pediu; senão, os dois mais próximos. Não pergunte "manhã ou tarde?" e ofereça horários na mesma resposta: ofereça os horários. Nunca pergunte "qual horário fica bom?" sem dar opções. A cidade não é obrigatória: não segure o horário por causa dela.
4. Se ele pedir um horário que não está na lista, ofereça os dois mais próximos que estão.
5. Quando ele escolher um horário da lista, confirme NA MESMA RESPOSTA, em bloco: dia da semana e data, hora, o endereço (${ENDERECO}), o que trazer (manual, chave reserva e o documento de transferência — se não tiver, não tem problema, o importante é trazer o carro) e o pedido de avisar com 2 horas de antecedência se não puder vir. Nunca diga que o horário "ainda não está confirmado".
6. Se ele avisar que vai atrasar: "sem problema, já avisei o pessoal, vem com calma". Não remarque por atraso pequeno.
7. Se ele disser que chegou: diga que já avisou a equipe e que alguém vai recebê-lo.

8. Se ele só agradeceu ou disse "ok" depois de tudo combinado, responda numa frase curta.

Os lembretes da véspera e do dia são automáticos — não precisa prometê-los.

## Dúvidas de sempre — responda curto, tranquilize e volte para o horário
- "Como funciona?": as três frases do "O que a Vaapty faz", e já ofereça os horários.
- Financiamento ou parcelas atrasadas: não impede; a quitação é resolvida na negociação, e a equipe explica tudo na avaliação.
- Carro no nome de outra pessoa: não impede; a equipe orienta como fazer.
- Débito ou licenciamento atrasado: a equipe analisa com os documentos e explica antes de qualquer coisa. Não diga se dá ou não dá.
- "Precisa marcar?": não é obrigatório, mas com hora marcada ele não espera — e ofereça os dois horários.
- "Até que ano vocês pegam?": tem comprador para qualquer carro; o que muda é a proposta, e isso se vê na avaliação.
- "Quanto vale meu carro?" ou "quanto vocês pagam?": o valor sai da avaliação, com o carro na frente; por mensagem seria chute. Nunca diga número nenhum.
- "Só quero ver se vale a pena": só faz sentido fechar se for bom para ele; o papel da Vaapty é buscar a melhor proposta na rede.

## Nunca
- Dar preço, faixa de preço ou estimativa.
- Dizer que a loja compra o carro.
- Mandar duas mensagens dizendo a mesma coisa.
- Oferecer horário fora da lista de horários livres.
- Dizer que não conseguiu consultar a agenda.
- Inventar informação sobre o carro, a loja ou o processo que não está aqui.
- Se o cliente disser que não quer mais, que já vendeu ou pedir para parar: agradeça numa frase e encerre, sem insistir.

## Mídia
Você não abre foto, áudio, vídeo nem documento. Se o cliente mandar, diga com naturalidade que não consegue abrir aqui e peça para escrever o que precisa — e siga o roteiro.

## Jeito de escrever
WhatsApp: mensagens curtas, português do Brasil, tom simpático e direto, sem formalidade. No máximo um emoji por resposta. Responda o que o cliente perguntou ANTES de perguntar outra coisa. Use o nome dele quando souber.

## A loja
Endereço: ${ENDERECO}.
${horarioDaLoja(cfg)}

## Agora
Agora é ${DIAS[diaDaSemana(agora)]}, ${dataBR(agora.slice(0, 10))}/${agora.slice(0, 4)}, ${agora.slice(11)} em Joinville.

## Horários livres para oferecer
${livresEmTexto(livres)}
${exemplosEmTexto(exemplos)}

## Formato da resposta
Você recebe a conversa até agora; LOJA são as mensagens que a loja já mandou, CLIENTE as do cliente. Responda à última mensagem do cliente.
Devolva SÓ um objeto JSON, sem cercas de código:
{"mensagens": ["primeira mensagem", "segunda, se precisar"], "agendar": "", "encerrar": false}
- "mensagens": de 1 a 3 mensagens, na ordem em que seriam enviadas.
- "agendar": quando o cliente escolheu um horário da lista nesta mensagem, a data e hora no formato AAAA-MM-DDTHH:MM (ex.: "${(livres[0] && `${livres[0].iso}T${livres[0].horarios[0]}`) || "2026-10-20T09:00"}"); senão, "".
- "encerrar": true só se o cliente pediu para parar, disse que não quer ou que já vendeu.`;
}

/* ------------------------- a saída ------------------------- */

const RX_QUANDO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/**
 * Lê o que o modelo devolveu. O agendamento só vale se for um horário
 * que estava na lista: modelo que inventa hora marca cliente num
 * horário que a loja não tem.
 */
function lerSaida(texto, livres) {
  const s = String(texto || "");
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  let o = null;
  if (i >= 0 && j > i) {
    const bloco = s.slice(i, j + 1);
    // A vírgula sobrando antes de `]` ou `}` é o tropeço mais comum do
    // modelo — foi o que derrubou o terceiro ponto do primeiro replay.
    // Corrigir só ela é seguro; texto de mensagem com ", ]" dentro é
    // improvável a ponto de não pagar um parser de verdade.
    try { o = JSON.parse(bloco); } catch (e) { try { o = JSON.parse(bloco.replace(/,\s*([\]}])/g, "$1")); } catch (e2) {} }
  }
  // Texto solto, sem JSON nenhum, é resposta escrita fora do formato:
  // no treino vale mostrar — o gerente julga o texto — marcado, e sem
  // agendar nada, porque o agendamento só existe no campo dele.
  if (!o && i < 0) {
    const livre = s.replace(/```\w*/g, "").trim();
    return livre ? { mensagens: [livre.slice(0, 1500)], agendar: "", encerrar: false, fora_da_lista: false, formato_livre: true } : null;
  }
  if (!o || !Array.isArray(o.mensagens)) return null;
  const mensagens = o.mensagens.map((m) => String(m == null ? "" : m).trim()).filter(Boolean).slice(0, 3);
  if (!mensagens.length) return null;
  let agendar = String(o.agendar || "").trim().slice(0, 16);
  const oferecidos = new Set((livres || []).flatMap((d) => d.horarios.map((h) => `${d.iso}T${h}`)));
  const foraDaLista = !!agendar && RX_QUANDO.test(agendar) && !oferecidos.has(agendar);
  if (!RX_QUANDO.test(agendar) || foraDaLista) agendar = "";
  return { mensagens, agendar, encerrar: o.encerrar === true, fora_da_lista: foraDaLista };
}

module.exports = {
  CONFIG_PADRAO, ENDERECO, POR_HORARIO, paredeDe, horariosDoDia, horariosLivres,
  conversaEmTexto, pontosDe, instrucao, lerSaida, semNumeros,
};
