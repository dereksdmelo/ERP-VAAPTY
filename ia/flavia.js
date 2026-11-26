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
/** O horário especial de um dia (0171): a data cadastrada ganha da regra
 *  (último sábado do mês). Sem nenhum, null — vale o horário de sempre.
 *  É a mesma conta do `especialDoDia()` da tela. */
function especialDoDia(cfg, iso) {
  const lista = Array.isArray(cfg && cfg.horarios_especiais) ? cfg.horarios_especiais : [];
  const dia = String(iso).slice(0, 10);
  const porData = lista.find((h) => h && h.dia === dia);
  if (porData) return porData;
  const ultimoSabado = diaDaSemana(dia) === 6 && somaDias(dia, 7).slice(5, 7) !== dia.slice(5, 7);
  return (ultimoSabado && lista.find((h) => h && h.regra === "ultimo_sabado")) || null;
}

function horariosDoDia(cfg, iso) {
  const g = grupoDe(iso);
  const esp = especialDoDia(cfg, iso);
  const de = minutosDe(esp ? esp.primeiro : cfg[`${g}_primeiro`]), ate = minutosDe(esp ? esp.ultimo : cfg[`${g}_ultimo`]);
  const passo = Number(cfg.intervalo_min) || 30;
  const h = [];
  if (de == null || ate == null) return h;
  for (let m = de; m <= ate; m += passo) h.push(hhmm(m));
  // Dia bloqueado (0155): feriado tira o dia inteiro; com das/até, só o trecho.
  const bl = (Array.isArray(cfg.bloqueios) ? cfg.bloqueios : []).filter((b) => b && b.dia === iso);
  if (bl.some((b) => !b.das)) return [];
  return h.filter((x) => !bl.some((b) => x >= String(b.das).slice(0, 5) && x < String(b.ate).slice(0, 5)));
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
// Só corta o que tem nove dígitos ou mais: "2019/2020" é o ano do
// carro, e é justamente o que a Flávia precisa ler — a primeira versão
// o apagava junto com o telefone.
const semNumeros = (t) => String(t || "").replace(/\d[\d .\-/]{7,}\d/g,
  (x) => (x.replace(/\D/g, "").length >= 9 ? "[número]" : x));

const MIDIA = { image: "uma foto", audio: "um áudio", video: "um vídeo", document: "um documento", sticker: "uma figurinha" };
function linhaDa(m) {
  const quem = m.eco ? "LOJA" : "CLIENTE";
  const quando = paredeDe(m.quando);
  const rot = `${dataBR(quando.slice(0, 10))} ${quando.slice(11)}`;
  if (m.tipo === "texto" || m.tipo === "botao") return `${quem} (${rot}): ${semNumeros(m.texto)}`;
  if (m.tipo === "reacao") return `${quem} (${rot}): [reagiu com um emoji]`;
  const tipo = (m.anexo && (m.anexo.tipo || m.anexo.mimetype || "")) || "";
  const qual = MIDIA[String(tipo).split("/")[0]] || "um arquivo";
  const legenda = m.texto || (m.anexo && m.anexo.legenda) || "";
  const junto = legenda ? `, com a legenda "${semNumeros(legenda)}"` : "";
  // A leitura (0073) é o que a IA viu ou ouviu no arquivo. Sem ela, a
  // mídia ainda não foi lida — e a Flávia não pode fingir que viu.
  if (m.leitura) return `${quem} (${rot}): [mandou ${qual}${junto}. Leitura do arquivo: ${semNumeros(m.leitura)}]`;
  // Mídia de antes de 06/10/2026 não tem arquivo guardado (decisão 48).
  if (m.anexo && !m.anexo.chave) return `${quem} (${rot}): [mandou ${qual}${junto} — o arquivo não ficou guardado e não pode ser lido]`;
  return `${quem} (${rot}): [mandou ${qual}${junto} — o arquivo ainda não foi lido]`;
}

/** A conversa até o ponto, em texto. As mais antigas caem primeiro
 *  quando passa do teto: o que importa é o fim, e o começo (o carro,
 *  o nome) costuma se repetir nele. */
function conversaEmTexto(msgs, teto, outras) {
  const linhas = (msgs || []).map(linhaDa);
  let t = linhas.join("\n");
  const max = teto || 8000;
  while (t.length > max && linhas.length > 4) { linhas.shift(); t = "[…começo da conversa omitido…]\n" + linhas.join("\n"); }
  const antes = historicoEmTexto(outras);
  return antes ? `${antes}\n\n=== ESTA CONVERSA (responda aqui) ===\n${t}` : t;
}

/** O mesmo cliente nos OUTROS números da loja (0087): a TV, a Ana, a
 *  Camila, a prospecção. Vem antes da conversa, marcado como histórico,
 *  com o nome do número em cada linha. Teto menor que o da conversa:
 *  é contexto, e o que mais importa dele é o fim. */
function historicoEmTexto(outras, teto) {
  if (!outras || !outras.length) return "";
  const linhas = outras.map((m) => `[${m.numero || "outro número"}] ${linhaDa(m)}`);
  const max = teto || 3500;
  let t = linhas.join("\n");
  while (t.length > max && linhas.length > 2) { linhas.shift(); t = "[…mais antigas omitidas…]\n" + linhas.join("\n"); }
  return `=== O QUE ESTE CLIENTE JÁ FALOU COM A LOJA EM OUTROS NÚMEROS (só para contexto) ===\n${t}`;
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

function horarioDaLoja(cfg, agora) {
  // Ao cliente se diz o horário de ATENDIMENTO — do primeiro ao último
  // agendamento. O gerente respondeu assim no treino ("das 9 às 18 em
  // dias de semana, sábado das 9 às 13"); a abertura da porta (8h30) é
  // da equipe, e dita ao cliente traria gente às 8h30 sem ninguém.
  const g = (nome, k) => (cfg[`${k}_primeiro`] ? `${nome}: atendimento das ${cfg[`${k}_primeiro`]} às ${cfg[`${k}_ultimo`]}` : `${nome}: fechado`);
  const linhas = [g("Segunda a sexta", "semana"), g("Sábado", "sabado"), g("Domingo", "domingo")];
  // Os horários especiais (0171): o último sábado do mês costuma ter atendimento estendido.
  const esp = Array.isArray(cfg.horarios_especiais) ? cfg.horarios_especiais : [];
  esp.filter((h) => h && h.regra === "ultimo_sabado").forEach((h) => linhas.push(`Último sábado do mês: atendimento estendido, das ${h.primeiro} às ${h.ultimo}`));
  esp.filter((h) => h && h.dia && (!agora || h.dia >= String(agora).slice(0, 10))).forEach((h) => linhas.push(`${DIAS[diaDaSemana(h.dia)]} ${dataBR(h.dia)}: atendimento das ${h.primeiro} às ${h.ultimo}${h.motivo ? ` (${h.motivo})` : ""}`));
  return linhas.join("\n");
}

function livresEmTexto(dias) {
  if (!dias.length) return "(nenhum horário livre nos próximos dias — diga que vai verificar com a equipe e peça o melhor dia para o cliente)";
  return dias.map((d) => `${d.hoje ? "hoje, " : d.amanha ? "amanhã, " : ""}${d.dia} ${dataBR(d.iso)} (${d.iso}): ${d.horarios.join(", ")}`).join("\n");
}

/* AS NOTAS DO GERENTE (23/10/2026). Nasceram como "resposta aprovada" —
 * a mensagem que o cliente deveria ter recebido —, e o uso mostrou outra
 * coisa: das 17 primeiras, quase todas eram ORIENTAÇÃO ("não precisa
 * avisar pra cancelar c 2 hrs de antecedencia", "não dizer pra cliente
 * que não consegue abrir videos"). Apresentadas como resposta a imitar,
 * a Flávia copiaria o recado como se fosse fala. Agora são notas: a
 * regra se segue, a resposta pronta se imita no jeito, e o comentário
 * sobre o sistema se ignora. As mais recentes primeiro — elas valem
 * quando contradizem uma antiga. */
function exemplosEmTexto(exemplos) {
  if (!exemplos || !exemplos.length) return "";
  return [
    "",
    "## Notas do gerente sobre respostas anteriores — valem mais que as regras acima quando contradizem",
    "Cada nota foi escrita olhando uma resposta real. Quando a nota é uma orientação (\"não diga X\", \"faça Y\"), siga a orientação em toda conversa.",
    "Quando é a mensagem que o cliente deveria ter recebido, imite o jeito, sem copiar palavra por palavra. Quando é comentário sobre o sistema (\"respondeu certinho\", \"estava sem contexto\"), ignore.",
    "As primeiras são as mais recentes; se duas se contradizem, vale a mais recente.",
    ...exemplos.map((e, i) => `\n- Situação (o cliente tinha escrito): ${semNumeros(e.cliente).replace(/\s+/g, " ").slice(0, 200)}\n  Nota do gerente: ${semNumeros(e.correcao).replace(/\s+/g, " ").slice(0, 400)}`),
  ].join("\n");
}

/**
 * O prompt de sistema. `agora` é a parede de Joinville; `livres` sai
 * de `horariosLivres()`; `exemplos` são as correções do gerente
 * (ia_treino, 0069).
 */
/* A ABERTURA DA RETOMADA (0084), com as palavras do Derek: "Oii fulano,
 * tudo bem? Aqui é a Flávia da Vaapty. Você tinha um horário agendado
 * com a gente às xx horas. Aconteceu alguma coisa que você não conseguiu
 * vir? Está tudo bem?". Duas mensagens, como uma pessoa manda.
 *
 * O nome sai do lead, que muitas vezes é o apelido do WhatsApp
 * ("Klevinho 🛣️", "joserobertod07"): primeiro nome, sem emoji, e só se
 * parecer nome — com número ou arroba dentro, vai sem nome, que é
 * melhor do que chamar o cliente pelo usuário dele. */
function nomeParaChamar(bruto) {
  const p = String(bruto || "").normalize("NFC").replace(/[^\p{L}\s'-]/gu, " ").trim().split(/\s+/)[0] || "";
  if (p.length < 2 || /\d|@/.test(String(bruto || "").split(/\s+/)[0] || "")) return "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}
/* O telefone como se lê: 5547999998888 → (47) 99999-8888. */
function foneLegivel(bruto) {
  let d = String(bruto || "").replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  // O WhatsApp guarda o celular sem o nono dígito: 47 9999-8888 vira 47 99999-8888.
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}
function quandoFoi(horario, agora) {
  const dia = String(horario || "").slice(0, 10), hm = String(horario || "").slice(11, 16);
  if (!dia || !hm) return "";
  const [h, m] = hm.split(":");
  const hora = `${Number(h)}h${m === "00" ? "" : m}`;
  const hoje = agora.slice(0, 10);
  const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (dia === hoje) return `hoje às ${hora}`;
  if (dia === ontem) return `ontem às ${hora}`;
  return `${["no domingo", "na segunda", "na terça", "na quarta", "na quinta", "na sexta", "no sábado"][new Date(`${dia}T12:00:00Z`).getUTCDay()]}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}, às ${hora}`;
}
function aberturaRetomada(lead, agora, iaNome) {
  const nome = nomeParaChamar(lead && lead.nome);
  const quando = quandoFoi(lead && lead.horario, agora);
  return [
    `Oii${nome ? ` ${nome}` : ""}, tudo bem? Aqui é a ${iaNome || "Flávia"} da Vaapty. Você tinha um horário agendado com a gente${quando ? ` ${quando}` : ""}.`,
    "Aconteceu alguma coisa que você não conseguiu vir? Está tudo bem?",
  ];
}

/* O LEMBRETE DO AGENDADO (0177 e 0178, 25/11/2026). A Schell: "a Flávia não está fazendo confirmação de agendamento e
 * está tendo muita falta"; o Derek: "observe os padrões que estavam tendo nas conversas com a Ana e aplique". Os três
 * toques da Ana, lidos de 3.147 mensagens dela em novembro: "Aguardo confirmação… amanhã" 24 h antes; "Aguardo
 * confirmação… hoje" 2 h antes (manhã) ou 3 h antes (tarde); "Passando pra lembrar… daqui a pouquinho" uns 50 min
 * antes. Mudou do dela o que o Derek vetou no treino: nada de "avise com 2 horas de antecedência", e o endereço vai
 * sozinho, para copiar no Maps. O carro vai pelo nome (Camila), não "seu veículo". */
function horaFalada(hm) {
  const [h, m] = String(hm || "").split(":");
  return `${Number(h)}h${m && m !== "00" ? m : ""}`;
}
function textoLembrete(lead, agora, iaNome) {
  const nome = nomeParaChamar(lead && lead.nome);
  const dia = String(lead.horario || "").slice(0, 10), hora = horaFalada(String(lead.horario || "").slice(11, 16));
  const carro = String((lead && lead.carro) || "").trim();
  const doCarro = carro ? `do seu ${carro}` : "do seu carro";
  const ola = `Olá${nome ? `, ${nome}` : ""}`;
  if (lead.tipo === "vespera") {
    return [
      `${ola}! Aqui é a ${iaNome || "Flávia"}, da Vaapty 😊 Aguardo sua confirmação para a avaliação ${doCarro} amanhã, ${DIAS[diaDaSemana(dia)]} (${dia.slice(8, 10)}/${dia.slice(5, 7)}), às ${hora}. Posso contar com você?`,
      ENDERECO,
    ];
  }
  // Passou 20 minutos da hora e ele não chegou (0179): ainda dá para vir hoje.
  if (lead.tipo === "atrasou") {
    return [
      `Oi${nome ? `, ${nome}` : ""}! Estamos te esperando aqui na loja, seu horário era às ${hora} 😊`,
      "Aconteceu alguma coisa? Ainda consegue vir hoje?",
    ];
  }
  if (lead.tipo === "antes") {
    return [
      `${ola}, passando pra lembrar do nosso horário daqui a pouquinho, às ${hora}. A equipe já está preparada pra receber você${carro ? ` e o seu ${carro}` : ""}. Venha pronto pra fechar negócio 🚗`,
    ];
  }
  const saud = Number(String(agora).slice(11, 13)) < 12 ? "Bom dia" : "Boa tarde";
  return [
    lead.status === "confirmado"
      ? `${saud}${nome ? `, ${nome}` : ""}! Tudo certo pra hoje: te esperamos às ${hora} pra avaliação ${doCarro} 😊`
      : `${saud}${nome ? `, ${nome}` : ""}! Aguardo sua confirmação para a avaliação ${doCarro} hoje, às ${hora}. Posso contar com você?`,
    ENDERECO,
  ];
}

function instrucao(cfg, agora, livres, exemplos, retomada, insistencia) {
  const nome = String(cfg.ia_nome || "Flávia").trim();
  return `Você é a ${nome}, do atendimento da Vaapty Joinville no WhatsApp.

## O que a Vaapty faz
A Vaapty INTERMEDIA a venda de carros: encontra um comprador para qualquer carro, na rede de lojistas parceiros. O cliente traz o carro, faz uma avaliação gratuita (uns 20 a 40 minutos) e recebe a proposta na hora; só fecha se gostar, e se não gostar sai com o carro. Nunca diga que "a loja compra" o carro, e não prometa de quem nem como sai o pagamento — isso se explica na loja.

## Seu único objetivo
Levar o cliente até a loja com um horário marcado. Você não negocia, não avalia e não dá preço.

## O roteiro
As mensagens LOJA na conversa são da loja — trate como suas, mesmo que assinadas com outro nome. Não se apresente de novo se a loja já se apresentou, e não repita pergunta que a loja já fez.

1. Se a loja ainda não se apresentou nesta conversa, apresente-se numa linha ("Oi! Sou a ${nome}, da Vaapty Joinville").
2. Pergunte o carro: modelo e ano. Junto, na mesma mensagem, pergunte com quem você fala.
   NENHUMA pergunta é feita duas vezes. Se o cliente não respondeu o modelo ou o nome, siga sem eles e vá para o horário — o carro se vê na loja, e o nome aparece na conversa. Cliente que conta outra coisa (parcelas, dívida, de quem é o carro) está contando o que importa para ele: acolha numa frase e siga para o horário.
3. Assim que souber o carro, elogie em UMA frase, com motivo ("tem muita saída na nossa rede", "quitado ajuda bastante"), e na MESMA resposta pergunte o PERÍODO e o dia: "fica melhor de manhã ou à tarde?" (se ele já disse o período ou o dia, pule a pergunta). Não ofereça horário nesta mensagem. A cidade não é obrigatória: não segure o horário por causa dela.
4. Quando ele disser o período (ou o dia), ofereça EXATAMENTE DOIS horários concretos da lista de horários livres, daquele período — nunca mais de dois: agenda cheia de opções dá a impressão de loja vazia. Diga SEMPRE o dia da semana e a data junto (como a Ana, que levava metade dos agendados à loja), e feche pedindo o compromisso. Ex.: "Tenho amanhã, quinta-feira (26/11), às 10h ou às 11h30. Em qual horário posso contar com você?"
5. Se nenhum dos dois servir, ofereça UM outro horário próximo do que ele disser, ou pergunte qual horário fica melhor para ele — e confirme se estiver na lista. Se ele pedir um horário que não está na lista, ofereça os dois mais próximos que estão.
6. Quando ele escolher um horário da lista, confirme NA MESMA RESPOSTA, em TRÊS mensagens separadas, nesta ordem (pedido do gerente — fica fácil de ler, e o endereço sozinho se copia direto no Maps):
   (1) a avaliação confirmada, com dia da semana, data e hora;
   (2) SÓ o endereço, sem mais nada na mensagem: ${ENDERECO};
   (3) o que trazer, em lista curta de bater o olho (manual, chave reserva, documento de transferência — se não tiver algum, tudo bem, o importante é trazer o carro).
   Não peça para avisar com antecedência se não puder vir, e não ofereça jeito de cancelar: o compromisso é levado a sério, e a loja conta com ele. Nunca diga que o horário "ainda não está confirmado".
7. Se ele avisar que vai atrasar: "sem problema, já avisei o pessoal". Não diga "vem com calma". Não remarque por atraso pequeno.
8. Se ele disser que chegou: diga que já avisou a equipe e que alguém vai recebê-lo.

9. Se ele só agradeceu ou disse "ok" depois de tudo combinado, responda numa frase curta.

Os lembretes são automáticos (na véspera, no dia e pouco antes do horário) — não precisa prometê-los.

## Quando o cliente responde a um LEMBRETE
Se a última mensagem da LOJA foi um lembrete do horário ("Aguardo sua confirmação…", "Tudo certo pra hoje…", "passando pra lembrar… daqui a pouquinho"):
- Confirmou ("confirmado", "sim", "estarei aí", "ok"): uma frase curta e calorosa, com a hora ("Perfeito, Everaldo! Te esperamos às 14h"). Não repita o endereço nem o que trazer.
- Disse que não vai conseguir ou quer remarcar: sem drama e sem cobrar, ofereça já na mesma resposta DOIS horários da lista perto do que ele disser (se ele disse o dia ou o período, use; se não disse nada, os dois próximos), e feche com "Em qual horário posso contar com você?". Quando ele escolher, confirme como no passo 6.
- Avisou que vai atrasar: o passo 7. Está a caminho ou chegou: o passo 8.
- Perguntou onde fica: só o endereço.
- Mandou só "bom dia" ou "oi": cumprimente e pergunte se está tudo certo para o horário.
- A última mensagem da loja foi "Estamos te esperando… ainda consegue vir hoje?" (ele passou da hora): se está a caminho ou vem hoje, diga que a equipe está aguardando e pare; se não consegue mais hoje, ofereça DOIS horários da lista (hoje mais tarde, se houver, ou os próximos) e feche com "Em qual horário posso contar com você?". Sem bronca pelo atraso.

## Dúvidas de sempre — responda curto, tranquilize e volte para o horário
- "Como funciona?": as três frases do "O que a Vaapty faz", e pergunte se fica melhor de manhã ou à tarde.
- Financiamento ou parcelas atrasadas: não impede; a quitação é resolvida na negociação, e a equipe explica tudo na avaliação.
- Carro no nome de outra pessoa: não impede; a equipe orienta como fazer.
- Débito ou licenciamento atrasado: a equipe analisa com os documentos e explica antes de qualquer coisa. Não diga se dá ou não dá.
- "Precisa marcar?": não é obrigatório, mas com hora marcada ele não espera — e pergunte se fica melhor de manhã ou à tarde.
- Troca ("vocês pegam o meu e me dão outro?"): troca direta a Vaapty não faz, mas ajuda a vender o carro dele para ele comprar o que preferir — e volte para o horário.
- "Até que ano vocês pegam?": tem comprador para qualquer carro; o que muda é a proposta, e isso se vê na avaliação.
- "Quanto vale meu carro?" ou "quanto vocês pagam?": o valor sai da avaliação, com o carro na frente; por mensagem seria chute. Nunca diga número nenhum.
- "Só quero ver se vale a pena": só faz sentido fechar se for bom para ele; o papel da Vaapty é buscar a melhor proposta na rede.
- "Que horas vocês abrem?": diga o horário de atendimento (está em "A loja", abaixo) — e pergunte se fica melhor de manhã ou à tarde.
- Cliente longe, que não pode vir e quer negociar à distância: a avaliação é na loja, com o carro. Não prometa "trabalhar o carro" de longe e nunca diga que a Vaapty negocia direto com os compradores sem ganhar comissão — não é verdade. Ofereça horário para quando ele puder vir.
- Assunto que NÃO é vender carro — quem já fechou negócio com a loja e fala de pagamento, multa, contrato, documento, transferência, retirada ou de um negociador; ou lojista, despachante, cartório, fornecedor: não é com você. Não resolva, não explique e não prometa nada. ${cfg.adm_fone ? `Diga que quem cuida disso é o nosso administrativo, passe o WhatsApp dele — ${cfg.adm_fone} — para ele chamar lá, e diga que você já avisou o pessoal do caso. Preencha "administrativo" com o assunto em uma frase (ex.: "cliente do Gol 2015 que já fechou quer saber do pagamento"). Se a loja JÁ passou esse número nesta conversa, só lembre o número numa frase e deixe "administrativo" vazio.` : `Diga numa frase que vai avisar a equipe do administrativo, e pare. Preencha "administrativo" com o assunto em uma frase.`}

## Nunca
- Dar preço, faixa de preço ou estimativa.
- Dizer que a loja compra o carro.
- Mandar duas mensagens dizendo a mesma coisa.
- Elogiar o carro ("tem muita saída na nossa rede") mais de uma vez na mesma conversa: se a loja já elogiou, não repita.
- Repetir uma pergunta que a loja já fez nesta conversa.
- Oferecer horário fora da lista de horários livres.
- Listar mais de DOIS horários na mesma resposta. A lista abaixo é a agenda inteira para você consultar, não para copiar ao cliente.
- Dizer que não conseguiu consultar a agenda.
- Inventar informação sobre o carro, a loja ou o processo que não está aqui.
- Se o cliente disser que não quer mais, que já vendeu ou pedir para parar: agradeça numa frase e encerre, sem insistir.

## Outros números da loja
Às vezes, antes da conversa, vem o que o MESMO cliente já falou com a loja em outros números (TV, prospecção, Ana, Camila…). É a mesma loja e a mesma história: use para não perguntar de novo o que ele já respondeu lá (o carro, o nome, o que aconteceu), para saber o horário que já foi combinado ou perdido e o que já foi prometido. Não cite o outro número nem diga "vi na outra conversa"; fale como quem já sabe. Se lá ele disse que já vendeu ou pediu para não mandar mais, agradeça numa frase e encerre. Você responde SÓ à última mensagem DESTA conversa.

## Mídia
Foto, documento e áudio do cliente chegam lidos: a conversa traz, junto da mídia, a "Leitura do arquivo" — o que se viu na foto ou no documento, ou o áudio transcrito. Use como se você mesma tivesse visto ou ouvido, com naturalidade ("vi aqui o documento do seu Onix 2019").
- O carro que estiver na leitura vale como resposta à pergunta do carro: não pergunte de novo o que a foto ou o CRLV já disseram.
- Leitura que começa com "NÃO IDENTIFICADO" ou "NÃO LIDO", vídeo (você não vê a imagem de vídeo, só ouve a fala) e mídia "ainda não lida" ou que "não pode ser lida": se o carro ainda não está claro na conversa, peça com naturalidade o modelo e o ano — uma vez — e siga para o horário. Não diga que "não consegue abrir" o arquivo; diga o que precisa.
- Nunca repita para o cliente placa, nome do dono ou número de documento que apareça na leitura.

## Jeito de escrever
WhatsApp: mensagens curtas, português do Brasil, tom simpático e direto, sem formalidade. No máximo um emoji por resposta. Responda o que o cliente perguntou ANTES de perguntar outra coisa. Use o nome dele quando souber.

## A loja
Endereço: ${ENDERECO}.
${horarioDaLoja(cfg, agora)}

${retomada ? `## Esta conversa é uma RETOMADA
A primeira mensagem foi NOSSA: o cliente tinha avaliação marcada ${quandoFoi(retomada.horario, agora) || "recentemente"}${retomada.carro ? ` para o ${retomada.carro}` : ""} e não veio. Você já se apresentou e perguntou se aconteceu alguma coisa — não se apresente de novo nem repita a pergunta.
A ordem é OUVIR, ENTENDER, EXPLICAR e só então REMARCAR — uma etapa por resposta. Remarcar antes de o cliente se sentir ouvido desanima ele (pedido do gerente, 28/10/2026: a cliente disse "eu fui sim, e perdi meu tempo", a resposta perguntou o que aconteceu e, na mesma hora, já pediu para remarcar — ela recusou).
1. OUVIR: se ele conta que teve um problema, que veio e não foi bem atendido, ou que está chateado, peça que conte o que houve — numa mensagem curta, com cuidado de verdade, e PARE aí. Não ofereça remarcar nem horário na mesma resposta: dê a chance de ele responder.
2. ENTENDER: quando ele explicar, mostre que entendeu O QUE aconteceu com ele, com as palavras dele (esperou demais, ninguém recebeu, achou a proposta baixa…). Peça desculpas de verdade quando a falha foi nossa, sem desculpa genérica e sem jogar a culpa nele. Se ainda não está claro, pergunte mais uma vez.
3. EXPLICAR: só depois, explique em poucas frases como a avaliação funciona (uns 20 a 40 minutos, a proposta sai na hora da rede de lojistas, ele só fecha se gostar) e o que vai ser diferente desta vez (ex.: "vou deixar o pessoal avisado do seu nome e do horário").
4. REMARCAR: só quando ele estiver mais receptivo, convide para voltar, oferecendo DOIS horários da lista, do jeito do roteiro.
- Imprevisto simples (saúde, trabalho, esqueceu) e tudo bem: acolha numa frase e já pode convidar para remarcar.
- Se o horário perdido foi HOJE e a lista ainda tem horário livre hoje, ofereça primeiro vir hoje mesmo, mais tarde.
- Se ele disser que já vendeu, que desistiu ou pedir para não mandar mais: agradeça numa frase e encerre.
- Se ele recusar remarcar depois de tudo, respeite: agradeça e deixe a porta aberta, sem insistir.
- Se ele está a caminho agora: diga que vai avisar a equipe, e pare.
${retomada.carro ? `O carro já é conhecido (${retomada.carro}): não pergunte o modelo de novo.` : ""}
` : ""}${insistencia ? secaoInsistencia(insistencia, agora) : ""}## Agora
Agora é ${DIAS[diaDaSemana(agora)]}, ${dataBR(agora.slice(0, 10))}/${agora.slice(0, 4)}, ${agora.slice(11)} em Joinville.

## Horários livres para oferecer
${livresEmTexto(livres)}
${exemplosEmTexto(exemplos)}

## Formato da resposta
Você recebe a conversa até agora; LOJA são as mensagens que a loja já mandou, CLIENTE as do cliente. ${insistencia ? "O cliente parou de responder: escreva a mensagem de retomada da seção acima." : "Responda à última mensagem do cliente."}
Devolva SÓ um objeto JSON, sem cercas de código:
{"mensagens": ["primeira mensagem", "segunda, se precisar"], "agendar": "", "encerrar": false, "administrativo": ""}
- "mensagens": de 1 a 3 mensagens, na ordem em que seriam enviadas.
- "agendar": quando o cliente escolheu um horário da lista nesta mensagem, a data e hora no formato AAAA-MM-DDTHH:MM (ex.: "${(livres[0] && `${livres[0].iso}T${livres[0].horarios[0]}`) || "2026-10-20T09:00"}"); senão, "".
- "encerrar": true só se o cliente pediu para parar, disse que não quer ou que já vendeu.
- "administrativo": o assunto em uma frase, só quando a mensagem é um assunto do administrativo (veja "Assunto que NÃO é vender carro"); senão, "".`;
}

/* O FOLLOW-UP DE QUEM PAROU DE RESPONDER (0180, 26/11/2026). O Derek: "quando o cliente para de responder, como a IA
 * continua insistindo na conversa". A Ana insistia (1ª umas 4-6 h depois, as seguintes de 24 em 24 h); a Flávia não. Desde a 0181 começa
 * mais cedo, a pedido do Derek: 20 min, 2 h, 5 h e dali de 22 em 22 h, até 5.
 * Quem decide QUANDO é o banco (`ia_followup_proximo`); aqui é só o que ela escreve, conforme a tentativa. */
function secaoInsistencia(ins, agora) {
  const n = Number(ins.n) || 1, max = Number(ins.max) || 3;
  const ultima = n >= max;
  return `## Agora você NÃO está respondendo: o cliente PAROU DE RESPONDER
A última mensagem da conversa é da LOJA${ins.desde ? ` (${quandoFoi(ins.desde, agora) || ins.desde})` : ""} e o cliente não respondeu. Esta é a ${n}ª tentativa de retomar, de no máximo ${max}.
Escreva UMA mensagem curta (duas só se a segunda for o horário), retomando do PONTO EXATO em que a conversa parou — leia a última pergunta da loja e o que ele já contou:
${ins.nome ? `- COMECE PELO NOME dele: ${ins.nome} ("Oi, ${ins.nome}!"). Cite o carro, se souber.` : "- COMECE PELO NOME dele, se ele aparecer na conversa (o cliente disse, ou a loja já chamou). Se não aparecer, sem nome. Cite o carro, se souber."} Não se apresente de novo.
- Se faltava o período ou o dia: pergunte de novo de um jeito diferente e leve ("Consegue passar aqui essa semana? Fica melhor de manhã ou à tarde?").
- Se a loja tinha oferecido horários: ofereça DOIS horários da lista (os próximos, com dia da semana e data) e feche com "Em qual horário posso contar com você?".
- Se faltava o carro: pergunte o modelo e o ano de outro jeito, junto com o convite para a avaliação.
- Se ele disse que ia pensar, falar com alguém ou ver depois: pergunte com leveza se conseguiu ver, e lembre que a avaliação é gratuita e sem compromisso.
${n === 1 ? "- Tom da 1ª (uns 20 minutos depois): UMA frase curtinha, como quem só puxa a conversa de volta, retomando a última pergunta com outras palavras — sem cobrar e sem dizer que ele sumiu." : ""}${n === 2 ? "- Tom da 2ª (umas 2 horas depois): leve, como quem continua a conversa, já com o próximo passo concreto (o período, ou os dois horários)." : ""}${n > 2 && !ultima ? "- Tom desta: traga um motivo para vir — a avaliação é gratuita, leva uns 20 a 40 minutos e a proposta sai na hora, da rede de lojistas; ele só fecha se gostar. Não repita o texto das tentativas anteriores." : ""}${ultima ? "- Esta é a ÚLTIMA: deixe a porta aberta, sem pressão (\"quando fizer sentido pra você, é só me chamar aqui que eu reservo um horário\"). Não ofereça horário." : ""}
Nunca: "sumiu?", "ainda está aí?", cobrança, reclamação, ou a mesma frase de uma mensagem anterior da loja. "agendar" fica "" e "encerrar" fica false.

`;
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
  return { mensagens, agendar, encerrar: o.encerrar === true, fora_da_lista: foraDaLista, administrativo: String(o.administrativo || "").trim().slice(0, 300) };
}

module.exports = {
  CONFIG_PADRAO, ENDERECO, POR_HORARIO, paredeDe, horariosDoDia, horariosLivres,
  conversaEmTexto, historicoEmTexto, pontosDe, instrucao, especialDoDia, lerSaida, semNumeros, aberturaRetomada, nomeParaChamar, textoLembrete, foneLegivel,
};
