/**
 * /api/atendimento — a lista do CRM e cada linha dela.
 *
 * GET                      as últimas, com filtro
 * GET ?id=                 um atendimento, com o veículo e as propostas
 * POST                     abre um atendimento
 * PATCH ?id=               atualiza
 *
 * Filtros do GET de lista: status, origem, negociador_id,
 * negociador_nome (ou `__sem__`), de, ate, q
 * (q busca em cliente, carro e placa), limite.
 *
 * ?recurso=indicacoes      GET lista · POST cria · PATCH ?id= atualiza
 *
 * As indicações moram aqui, e não em api/indicacao.js, porque a Vercel
 * do plano Hobby para em 12 funções e nós estamos nas 12. Um lead de
 * indicação nasce dentro de um atendimento, então é o vizinho menos
 * estranho — mas é acomodação de teto, não arquitetura.
 *
 * Como todo o resto de api/, fala com o banco pelo token do usuário —
 * quem decide o que ele enxerga é a RLS da 0004, não código daqui.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

const REST = (t) => `${URL_BASE}/rest/v1/${t}`;

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

const limpar = (s) => String(s == null ? "" : s);

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORIGENS = ["fluxo_loja", "prospeccao", "indicacao", "tv", "google",
                 "facebook", "outdoor", "recuperacao", "faceleads", "outro"];
// Os quinze status reais da planilha (0009) mais os três da primeira
// versão. Esta lista ficou nos cinco antigos por três dias: a tela
// mandava `cliente_na_loja`, daLista() devolvia null, e o banco
// recusava o INSERT — e as pílulas de status novas na lista não
// filtravam nada, porque o filtro também passava por aqui. Manter
// igual à do api/importar.js.
const STATUS = [
  "fechado", "cliente_na_loja", "aguardando", "baixar_expectativa", "vai_voltar",
  "consignado", "vendeu_fora", "perseguir", "em_negociacao", "nao_avaliou",
  "nao_lancado", "falta_proposta", "quitacao_futura", "rescisao", "restricao",
  "aberto", "aguardando_propostas", "perdido",
];

/* ------------------ conversões ------------------ */

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};

// Aceita 51371, 51.371 e 51.371,50 — o mesmo do api/veiculo.js.
const decimal = (v) => {
  let s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// A planilha usa dd/mm/aaaa; o banco quer aaaa-mm-dd.
const data = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (!m) return null;
  const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${ano}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

const daLista = (v, lista) => (lista.indexOf(String(v || "")) >= 0 ? String(v) : null);

// O relógio da casa é America/Sao_Paulo, não UTC — mesmo de api/funil.js.
const hojeAqui = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

// "4 horas" e "3 dias" na mesma régua: a pré-venda responde em
// minutos, e exigir um dia inteiro para chamar alguém de sumido
// esconde a janela em que ainda dá para recuperar.
const rotuloPrazo = (d) => (d < 1
  ? `${Math.round(d * 24)} hora${Math.round(d * 24) > 1 ? "s" : ""}`
  : `${d} dia${d > 1 ? "s" : ""}`);

// O id do usuário, do miolo do token. Quem valida é o banco.
function donoDoToken(tok) {
  try {
    const meio = String(tok).replace(/^Bearer\s+/, "").split(".")[1];
    if (!meio) return null;
    const base = meio.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(base, "base64").toString("utf8")).sub || null;
  } catch (e) { return null; }
}

/**
 * De qual campo veio cada coluna. Como no api/veiculo.js: coluna que
 * a tela não mandou não é apagada no update. Coluna nova exige entrada
 * aqui, senão nunca é gravada.
 */
const FONTE = {
  data: "data", negociador_id: "negociador_id", negociador_nome: "negociador_nome",
  prospec: "prospec", cliente_nome: "cliente_nome", cliente_telefone: "cliente_telefone",
  cliente_cpf: "cliente_cpf", cliente_rg: "cliente_rg", cliente_endereco: "cliente_endereco",
  origem: "origem", status: "status", carro_descricao: "carro_descricao",
  pretensao: "pretensao", valor_fechado: "valor_fechado",
  forma_fechamento: "forma_fechamento", proximo_contato: "proximo_contato",
  observacoes: "observacoes",
};

function paraColunas(c) {
  return {
    data: data(c.data),
    negociador_id: RX_UUID.test(String(c.negociador_id || "")) ? c.negociador_id : null,
    negociador_nome: texto(c.negociador_nome),
    prospec: texto(c.prospec),
    cliente_nome: texto(c.cliente_nome),
    cliente_telefone: texto(c.cliente_telefone),
    cliente_cpf: texto(c.cliente_cpf),
    cliente_rg: texto(c.cliente_rg),
    cliente_endereco: texto(c.cliente_endereco),
    cliente_email: texto(c.cliente_email),
    cliente_cidade: texto(c.cliente_cidade),
    cliente_uf: texto(c.cliente_uf),
    cliente_cep: texto(c.cliente_cep),
    cliente_bairro: texto(c.cliente_bairro),
    // O comprador é o lojista que leva o carro (0014): a outra parte do
    // contrato final, e não o cliente que vende.
    comprador_nome: texto(c.comprador_nome),
    comprador_cpf: texto(c.comprador_cpf),
    comprador_nacionalidade: texto(c.comprador_nacionalidade),
    comprador_estado_civil: texto(c.comprador_estado_civil),
    comprador_profissao: texto(c.comprador_profissao),
    comprador_endereco: texto(c.comprador_endereco),
    comprador_email: texto(c.comprador_email),
    comprador_telefone: texto(c.comprador_telefone),
    origem: daLista(c.origem, ORIGENS),
    status: daLista(c.status, STATUS),
    carro_descricao: texto(c.carro_descricao),
    pretensao: decimal(c.pretensao),
    valor_fechado: decimal(c.valor_fechado),
    forma_fechamento: texto(c.forma_fechamento),
    proximo_contato: data(c.proximo_contato),
    observacoes: texto(c.observacoes),
  };
}

const somenteEnviadas = (linha, corpo) => {
  const r = {};
  Object.keys(linha).forEach((col) => {
    if (corpo[FONTE[col]] !== undefined) r[col] = linha[col];
  });
  return r;
};

/* ------------------ banco ------------------ */

async function banco(url, opcoes) {
  let r;
  try {
    r = await fetch(url, opcoes);
  } catch (e) {
    const erro = new Error("Não consegui falar com o banco.");
    erro.status = 502;
    throw erro;
  }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a operação.";
    const erro = new Error(limpar(msg));
    erro.status = r.status === 401 ? 401 : r.status === 403 ? 403 : 502;
    throw erro;
  }
  return dado;
}

async function lerCorpo(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : null;
}

/* ------------------ handler ------------------ */

// O veículo e as propostas vêm junto na mesma consulta: uma ida ao
// banco em vez de três, e a lista já mostra placa e melhor proposta.
// Os valores do check list viajam junto porque o estoque (0019) monta
// o custo previsto a partir deles — sem isso seria uma consulta por
// carro só para descobrir quanto foi combinado na mesa.
// `checklist(adm_conferido_em)` entra só para a tela do administrativo
// saber, na lista, o que já foi conferido — sem isso seria uma consulta
// por linha. Vem como objeto porque a 0008 tem unique em
// atendimento_id; a tela aceita os dois formatos por segurança.
const EMBUTIDO = "*,veiculo(id,placa,marca_modelo,ano_fabricacao,ano_modelo,km_atual,fipe_valor,valor_por,status),proposta(id,lojista,valor,apresentada),checklist(adm_conferido_em,valor_debitos,valor_quitacao,valor_cautelar,comissao_vaapty,valor_cliente)";

const STATUS_INDICACAO = ["novo", "em_contato", "agendado", "virou_atendimento", "sem_interesse"];

/**
 * A leitura da conversa por IA.
 *
 * O que a busca por expressão não faz: entender ironia, negação e
 * contexto. "Não tenho outra proposta" acende o mesmo sinal que "tenho
 * outra proposta" numa busca de termo — aqui não.
 *
 * A chave é `ANTHROPIC_API_KEY`, e ela **só existe no ambiente**: não
 * está no repositório, não vai ao navegador, não aparece em log. Sem
 * ela, o endpoint diz isso em vez de falhar em silêncio — descobrir
 * que a variável não subiu no meio de uma negociação seria pior.
 *
 * Só o texto da conversa é enviado. Nome, telefone e CPF do cliente
 * não vão junto: a transcrição já é dado sensível, e mandar o cadastro
 * junto seria ampliar o vazamento sem ganhar nada na leitura.
 */
const IA_CHAVE = process.env.ANTHROPIC_API_KEY || "";
// Haiku é o mais barato da família e sobra para esta tarefa: ler
// meia página de transcrição e dizer qual manobra é. Trocar o modelo
// não precisa de deploy — basta a variável IA_MODELO no ambiente.
const IA_MODELO = process.env.IA_MODELO || "claude-haiku-4-5-20251001";
// Só o fim da conversa importa, e cada caractere a mais é dinheiro.
// 2.500 caracteres são uns cinco minutos de fala.
const IA_JANELA = Math.max(500, Math.min(20000, Number(process.env.IA_JANELA) || 2500));

const INSTRUCAO_TATICA = [
  "Você ajuda um negociador da Vaapty, que COMPRA carros de pessoas físicas para revender a lojistas.",
  "Você recebe a transcrição imperfeita de uma conversa ao vivo, feita por reconhecimento de voz do navegador:",
  "há palavras trocadas, pontuação faltando e trechos sem sentido. Leia com essa margem.",
  "",
  "Diga qual manobra o CLIENTE está usando agora, se alguma, e o que o negociador deve fazer.",
  "Use estes nomes quando couber: ancoragem alta, proposta concorrente, autoridade limitada, ultimato,",
  "silêncio, valor sentimental, vitimização, recuo tático, concessão fatiada, desqualificação da oferta,",
  "informação retida, balão de ensaio. Se nada se encaixar, descreva em poucas palavras.",
  "",
  "Responda SÓ com um objeto JSON, sem cercas de código, com estas chaves:",
  '  "tatica"  nome curto da manobra, ou "" se não houver nenhuma clara',
  '  "leitura" uma frase sobre o que está acontecendo na mesa',
  '  "faca"    uma frase com a ação concreta do negociador agora',
  '  "frase"   uma frase pronta para ele falar em voz alta, em português do Brasil, respeitosa e direta',
  "",
  "Se a transcrição for curta ou confusa demais para uma leitura honesta, devolva tatica vazia e diga isso em leitura.",
].join("\n");

async function tatica(req, res, tok) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
  if (!IA_CHAVE) {
    return res.status(501).json({
      erro: "A leitura por IA não está ligada. Falta a variável ANTHROPIC_API_KEY nas configurações da Vercel — as táticas por expressão continuam funcionando.",
    });
  }
  const c = await lerCorpo(req);
  const texto = String((c && c.texto) || "").trim();
  if (texto.length < 40) return res.status(400).json({ erro: "Conversa curta demais para ler." });

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": IA_CHAVE, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IA_MODELO,
        max_tokens: 300,
        system: INSTRUCAO_TATICA,
        messages: [{ role: "user", content: texto.slice(-IA_JANELA) }],
      }),
    });
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com a IA." });
  }
  const corpo = await r.text();
  if (!r.ok) {
    // A mensagem da API pode conter a chave em eco; nada dela volta ao
    // cliente por isso.
    return res.status(502).json({ erro: r.status === 401 ? "A chave da IA foi recusada." : "A IA não respondeu." });
  }
  let saida = "";
  try {
    const d = JSON.parse(corpo);
    saida = ((d.content || []).filter((x) => x.type === "text")[0] || {}).text || "";
  } catch (e) {}
  // O modelo às vezes embrulha o JSON em cerca de código, mesmo pedindo
  // que não. Pegar do primeiro { ao último } é mais barato que insistir.
  const i = saida.indexOf("{"), j = saida.lastIndexOf("}");
  let obj = null;
  if (i >= 0 && j > i) { try { obj = JSON.parse(saida.slice(i, j + 1)); } catch (e) {} }
  if (!obj) return res.status(502).json({ erro: "A IA respondeu fora do formato. Tente de novo." });

  // O consumo volta junto: quem paga por chamada precisa ver o que
  // cada clique custou, não descobrir na fatura.
  let uso = null;
  try { const d = JSON.parse(corpo); uso = d.usage || null; } catch (e) {}
  return res.status(200).json({
    tatica: texto0(obj.tatica), leitura: texto0(obj.leitura),
    faca: texto0(obj.faca), frase: texto0(obj.frase),
    modelo: IA_MODELO, uso,
  });
}
const texto0 = (v) => String(v == null ? "" : v).trim().slice(0, 600);

/**
 * ===== o resumo da conversa =====
 *
 * O gestor não lê transcrição. Meia hora de fala vira duas mil
 * palavras em texto corrido, com o que o reconhecimento de voz errou
 * no meio — e o painel existe para ele ajudar a tempo, não para
 * arquivar. O que ele precisa saber cabe em três parágrafos: o que o
 * cliente quer e por quê, como a negociação andou, e se o negociador
 * seguiu o processo da casa.
 *
 * **A janela aqui é a conversa inteira, não o fim dela.** A tática
 * (decisão 31) lê os últimos 2.500 caracteres porque a manobra
 * acontece agora; o resumo precisa do começo, que é onde o cliente
 * conta o motivo da venda. Por isso `IA_JANELA_RESUMO`, separada — e
 * quando o texto passa do teto o corte é no MEIO: as pontas são a
 * pesquisa e o fechamento, e é o miolo que se repete.
 *
 * **Uma chamada por pedido, e o resultado fica guardado** (0038).
 * Sem o cache, abrir a ficha três vezes custaria três chamadas para
 * ler o mesmo texto.
 *
 * Só a transcrição e os números do negócio são enviados. Nome,
 * telefone e CPF do cliente não vão junto, pela mesma razão da
 * decisão 31 — e aqui pesa mais, porque o texto enviado é maior.
 */
const IA_JANELA_RESUMO = Math.max(1000, Math.min(60000, Number(process.env.IA_JANELA_RESUMO) || 14000));

const INSTRUCAO_RESUMO = [
  "Você escreve para o GERENTE de uma loja da Vaapty, que COMPRA carros de pessoas físicas para revender a lojistas.",
  "Ele vai revisar o atendimento e dar um retorno ao negociador. Ele não vai ler a transcrição — você é o resumo dela.",
  "",
  "A transcrição é imperfeita: foi feita pelo reconhecimento de voz do navegador, com palavras trocadas,",
  "sem pontuação e com trechos sem sentido. Leia com essa margem e NÃO invente o que não está lá.",
  "Quando algo não aparecer na conversa, diga que não apareceu — é exatamente isso que o gerente precisa cobrar.",
  "",
  "O processo da casa tem oito etapas: Abordagem (receber, combinar o tempo), Pesquisa (por que vende, quanto quer,",
  "se o decisor está na mesa, se há dívida), Demonstração (mostrar como a Vaapty trabalha e um depoimento de cliente),",
  "Lançamento (ficha e descritivo do carro para a rede), Espera (os 15 minutos das propostas),",
  "Negociação (as rodadas de extrato e contraproposta), Fechamento (aceite e assinatura) e",
  "Relacionamento (avaliação no Google e indicações).",
  "",
  "Responda SÓ com um objeto JSON, sem cercas de código, com estas chaves, todas em português do Brasil:",
  '  "cliente"    2 a 3 frases: quem é, por que está vendendo, o que precisa, qual a pressa, o que ele quer de valor',
  '  "negociacao" 2 a 3 frases: como a conversa andou, o que o cliente objetou, como o negociador respondeu, onde parou',
  '  "processo"   2 a 3 frases: o que o negociador FEZ bem e o que ele PULOU, citando as etapas pelo nome',
  '  "atencao"    uma frase com o ponto que o gerente deve cobrar, ou "" se não houver nada a cobrar',
  "",
  "Frases curtas e diretas, sem elogio vazio e sem repetir os números que já estão na ficha.",
  "Se a transcrição for curta ou confusa demais para uma leitura honesta, diga isso em cada campo em vez de inventar.",
].join("\n");

// Conversa longa: o meio é o que se repete. As pontas são a pesquisa
// (começo) e o fechamento (fim), e são as duas que o resumo precisa.
function janelaDoResumo(t) {
  if (t.length <= IA_JANELA_RESUMO) return t;
  const meio = Math.floor(IA_JANELA_RESUMO / 2);
  return t.slice(0, meio) + "\n\n[...trecho do meio da conversa omitido...]\n\n" + t.slice(t.length - meio);
}

async function resumo(req, res, tok) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
  if (!IA_CHAVE) {
    return res.status(501).json({
      erro: "O resumo por IA não está ligado. Falta a variável ANTHROPIC_API_KEY nas configurações da Vercel.",
    });
  }
  const c = await lerCorpo(req);
  const aid = String((c && c.atendimento_id) || "");
  if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

  // A transcrição vem do BANCO, pelo token de quem pediu: é a RLS da
  // 0033 que decide se esta pessoa pode ler esta conversa. Aceitar o
  // texto pelo corpo deixaria qualquer um pagar uma chamada nossa para
  // resumir o que quisesse.
  const linhas = await banco(
    `${URL_BASE}/rest/v1/negociacao_viva?select=transcricao&atendimento_id=eq.${aid}`,
    { headers: cabecalhos(tok) },
  );
  const bruto = String(((linhas || [])[0] || {}).transcricao || "").trim();
  if (!bruto) return res.status(404).json({ erro: "Não há transcrição gravada neste atendimento." });
  if (bruto.length < 200) return res.status(400).json({ erro: "Conversa curta demais para resumir." });

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": IA_CHAVE, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: IA_MODELO,
        max_tokens: 700,
        system: INSTRUCAO_RESUMO,
        messages: [{ role: "user", content: janelaDoResumo(bruto) }],
      }),
    });
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com a IA." });
  }
  const corpo = await r.text();
  // A mensagem de erro da API pode ecoar a chave; nada dela volta ao cliente.
  if (!r.ok) return res.status(502).json({ erro: r.status === 401 ? "A chave da IA foi recusada." : "A IA não respondeu." });

  let saida = "";
  let uso = null;
  try {
    const d = JSON.parse(corpo);
    saida = ((d.content || []).filter((x) => x.type === "text")[0] || {}).text || "";
    uso = d.usage || null;
  } catch (e) {}
  const i = saida.indexOf("{"), j = saida.lastIndexOf("}");
  let obj = null;
  if (i >= 0 && j > i) { try { obj = JSON.parse(saida.slice(i, j + 1)); } catch (e) {} }
  if (!obj) return res.status(502).json({ erro: "A IA respondeu fora do formato. Tente de novo." });

  const feito = {
    cliente: texto1(obj.cliente), negociacao: texto1(obj.negociacao),
    processo: texto1(obj.processo), atencao: texto1(obj.atencao),
  };

  // Guardar é do gerente, e quem confere o papel é a função do banco
  // (0038): a política de escrita da `negociacao_viva` é do
  // negociador, e abrir a tabela para o gerente abriria a transcrição
  // e o valor fechado junto. Falhar aqui não perde o resumo — ele volta
  // para a tela do mesmo jeito, só não fica guardado.
  let guardado = false;
  try {
    guardado = !!(await banco(`${URL_BASE}/rest/v1/rpc/gravar_resumo_ia`, {
      method: "POST",
      headers: json(tok),
      body: JSON.stringify({ p_atendimento: aid, p_texto: JSON.stringify(feito), p_modelo: IA_MODELO }),
    }));
  } catch (e) {}

  return res.status(200).json({ resumo: feito, guardado, em: new Date().toISOString(), modelo: IA_MODELO, uso });
}
const texto1 = (v) => String(v == null ? "" : v).trim().slice(0, 900);

/**
 * O `negociador_id` do atendimento aponta para `perfil`, não para
 * `negociador`.
 *
 * São duas tabelas com as mesmas pessoas e ids diferentes: `perfil` é
 * quem tem login (0004), `negociador` é o cadastro de metas (0010). A
 * tela de novo atendimento oferece a lista do CADASTRO — é ela que tem
 * todo mundo, inclusive quem não tem login — e gravava aquele id aqui,
 * o que viola a chave estrangeira.
 *
 * **O erro era invisível para quem testava.** Ele só acontece quando o
 * nome escolhido existe no cadastro: o perfil do dono chama-se
 * "dereksdmelo", que não está lá, então o campo nascia vazio e caía no
 * id dele. Para o ANDRÉ BRUNO, que tem o mesmo nome nas duas tabelas,
 * o campo se preenchia sozinho e o insert estourava — 12/09/2026, com
 * o cliente na frente dele.
 *
 * Aqui o id é conferido contra `perfil` antes de ir ao banco. Não
 * sendo de lá, o vínculo cai para nulo e **o nome continua gravado** —
 * que é como os 89 atendimentos importados já vivem, e o que a régua
 * do mês (decisão 22) sabe ler. Perder o vínculo é bem menos grave que
 * recusar o atendimento.
 */
async function idDePerfil(tok, valor) {
  const id = String(valor || "");
  if (!RX_UUID.test(id)) return null;
  try {
    const r = await banco(`${URL_BASE}/rest/v1/perfil?select=id&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
    return (r || []).length ? id : null;
  } catch (e) {
    // A RLS não devolve perfil de quem está inativo, e uma falha de
    // rede aqui não pode derrubar a abertura do atendimento.
    return null;
  }
}

/**
 * ===== a agenda do dia =====
 *
 * A folha de bordo que o negociador preenchia à mão (0046): hora a
 * hora, o que ele fez. Plano e realizado são a mesma linha — `feito_em`
 * nulo é plano.
 *
 * **Mora aqui pelo teto de 12 funções**, mas a costura não é
 * arbitrária: metade do dia dele é atendimento, e a tela mistura as
 * duas listas na mesma linha do tempo.
 *
 * **O atendimento não é copiado para a agenda.** Ele já existe, com
 * hora e status; duplicá-lo criaria uma segunda verdade que envelhece
 * no minuto seguinte. Quem junta as duas fontes é a tela, na hora de
 * desenhar.
 */
const AGENDA_TIPOS = ["atendimento", "recuperacao", "prospeccao", "ligacao", "reuniao", "almoco", "pausa", "outro"];
const RX_DIA = /^\d{4}-\d{2}-\d{2}$/;
const RX_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const horaOuNulo = (v) => (RX_HORA.test(String(v || "")) ? String(v) : null);

async function agenda(req, res, tok) {
  const REST_A = `${URL_BASE}/rest/v1/agenda`;

  if (req.method === "GET") {
    const de = String(req.query.de || "");
    const ate = String(req.query.ate || de);
    if (!RX_DIA.test(de) || !RX_DIA.test(ate)) {
      return res.status(400).json({ erro: "Informe de e ate no formato aaaa-mm-dd." });
    }
    // Quem pode ler o quê é a RLS da 0046: o próprio, e o gerente vê
    // todos. Repetir a regra aqui criaria duas versões dela.
    const f = [`dia=gte.${de}`, `dia=lte.${ate}`, "order=dia.asc,hora.asc.nullslast,criado_em.asc", "limit=500"];
    const quem = String(req.query.perfil_id || "");
    if (RX_UUID.test(quem)) f.push(`perfil_id=eq.${quem}`);
    const linhas = await banco(`${REST_A}?select=*&${f.join("&")}`, { headers: cabecalhos(tok) });
    return res.status(200).json({ acoes: linhas || [] });
  }

  if (req.method === "POST") {
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const titulo = texto(c.titulo);
    if (!titulo) return res.status(400).json({ erro: "Escreva o que é." });
    const dia = String(c.dia || "");
    if (!RX_DIA.test(dia)) return res.status(400).json({ erro: "Dia inválido." });

    // **`perfil_id` não é escolhido aqui, e não é procurado aqui.**
    // A primeira versão fazia `select id from perfil limit 1` — o que
    // para um negociador funciona por acidente (a RLS devolve só a
    // própria linha) e **para o gerente traz o primeiro da equipe**,
    // que é outra pessoa. Quem diz o dono é o banco, pelo default
    // `auth.uid()` da 0047: mesma fonte que a política confere.
    const linha = {
      dia,
      hora: horaOuNulo(c.hora),
      fim: horaOuNulo(c.fim),
      tipo: AGENDA_TIPOS.indexOf(String(c.tipo || "")) >= 0 ? c.tipo : "outro",
      titulo,
      atendimento_id: RX_UUID.test(String(c.atendimento_id || "")) ? c.atendimento_id : null,
      // O registro rápido nasce feito; o item do plano nasce em aberto.
      feito_em: c.feito ? new Date().toISOString() : null,
    };
    const r = await banco(REST_A, {
      method: "POST", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify(linha),
    });
    return res.status(201).json({ ok: true, acao: (Array.isArray(r) ? r[0] : r) || null });
  }

  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    const mud = {};
    if (c.titulo !== undefined) mud.titulo = texto(c.titulo);
    if (c.hora !== undefined) mud.hora = horaOuNulo(c.hora);
    if (c.fim !== undefined) mud.fim = horaOuNulo(c.fim);
    if (c.dia !== undefined && RX_DIA.test(String(c.dia))) mud.dia = c.dia;
    if (c.tipo !== undefined && AGENDA_TIPOS.indexOf(String(c.tipo)) >= 0) mud.tipo = c.tipo;
    // Marcar e desmarcar: o toque que diz "isto aconteceu" precisa
    // desfazer, porque ele é dado por engano o tempo todo.
    if (c.feito !== undefined) mud.feito_em = c.feito ? new Date().toISOString() : null;
    if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para atualizar." });

    const r = await banco(`${REST_A}?id=eq.${id}`, {
      method: "PATCH", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify(mud),
    });
    const salvo = Array.isArray(r) ? r[0] : r;
    // Vazio é a RLS recusando: a agenda é de quem a vive.
    if (!salvo) return res.status(403).json({ erro: "Esta agenda é de outra pessoa." });
    return res.status(200).json({ ok: true, acao: salvo });
  }

  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    await banco(`${REST_A}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos(tok) });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
}

const LEAD_STATUS = ["novo", "em_contato", "agendado", "confirmado", "compareceu", "nao_compareceu", "perdido"];
const CAMPOS_LEAD = "*,negociador(id,nome)";

/**
 * Pré-vendas (0022): o lead e o agendamento na mesma linha.
 *
 *   GET  ?recurso=lead&fila=funil|agenda|hoje  &status= &q=
 *   POST ?recurso=lead
 *   PATCH ?recurso=lead&id=
 *   POST ?recurso=lead&id=&acao=compareceu  → cria o atendimento
 *
 * Mora aqui porque o lead vira atendimento — e porque a Vercel do
 * Hobby para em 12 funções, que já estão todas ocupadas.
 */
function paraLead(c) {
  const l = {};
  if (c.nome !== undefined) l.nome = texto(c.nome);
  if (c.telefone !== undefined) l.telefone = texto(c.telefone);
  if (c.carro !== undefined) l.carro = texto(c.carro);
  if (c.origem !== undefined) l.origem = daLista(c.origem, ORIGENS) || "outro";
  if (c.status !== undefined && LEAD_STATUS.indexOf(String(c.status)) >= 0) l.status = c.status;
  if (c.negociador_id !== undefined) l.negociador_id = RX_UUID.test(String(c.negociador_id || "")) ? c.negociador_id : null;
  if (c.negociador_nome !== undefined) l.negociador_nome = texto(c.negociador_nome);
  // "Vai voltar" sem data é promessa que ninguém cobra (0036).
  if (c.volta_em !== undefined) l.volta_em = data(c.volta_em);
  if (c.prospector_nome !== undefined) l.prospector_nome = texto(c.prospector_nome);
  if (c.proximo_contato !== undefined) l.proximo_contato = data(c.proximo_contato);
  if (c.observacoes !== undefined) l.observacoes = texto(c.observacoes);
  if (c.agendado_para !== undefined) {
    const t = String(c.agendado_para || "").trim();
    l.agendado_para = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t) ? t : null;
  }
  return l;
}

async function leads(req, res, tok) {
  const base = REST("lead");
  const cabJson = json(tok);

  if (req.method === "GET") {
    const f = [];
    const fila = String(req.query.fila || "funil");
    // "O que eu tenho para ligar neste dia" — é o que leva o lead para
    // a agenda do Meu dia sem virar linha na tabela `agenda`.
    const proximo = String(req.query.proximo || "");
    const st = String(req.query.status || "");
    if (LEAD_STATUS.indexOf(st) >= 0) f.push(`status=eq.${st}`);
    // A agenda é o que tem hora marcada e ainda não foi resolvido; o
    // funil é o resto. Separar aqui evita a tela filtrar 500 linhas
    // para mostrar 8.
    if (fila === "agenda") f.push("status=in.(agendado,confirmado)");
    // **Perdido tem fila própria, e não é lixeira.** É onde se confere
    // se o cliente foi mesmo embora — vendeu fora, ou não tem
    // interesse no negócio — e de onde ele volta se mudar de ideia.
    else if (fila === "perdidos") f.push("status=eq.perdido");
    // **`nao_compareceu` entra no funil, e isso era um vazamento.** A
    // fila da agenda só mostra `agendado` e `confirmado`; ao marcar
    // "não veio" o lead saía dos dois e não entrava em lista nenhuma —
    // sumia do sistema com o cliente ainda por atender. O Derek viu em
    // 15/09/2026. Quem não veio é justamente quem precisa de ligação.
    else if (fila === "funil" && !f.length) f.push("status=in.(novo,em_contato,nao_compareceu)");
    /* O EXCLUÍDO SAI DE TODA FILA, menos da dele.
     *
     * **Esconder, não apagar** (0060): lead é a origem do funil, e
     * linha que some leva junto a conversão do canal e o histórico de
     * quem já falou com a loja. Número que muda sozinho, sem ninguém
     * saber por quê, é número que deixa de ser lido. */
    if (fila === "excluidos") f.push("excluido_em=not.is.null");
    else f.push("excluido_em=is.null");
    const de = data(req.query.de), ate = data(req.query.ate);
    if (de) f.push(`agendado_para=gte.${de}T00:00:00`);
    if (ate) f.push(`agendado_para=lte.${ate}T23:59:59`);
    const q = String(req.query.q || "").trim().replace(/[(),*]/g, " ").trim();
    if (q) f.push(`or=(nome.ilike.*${q}*,telefone.ilike.*${q}*,carro.ilike.*${q}*)`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(proximo)) f.push(`proximo_contato=eq.${proximo}`);
    const ordem = fila === "agenda" ? "agendado_para.asc"
      : fila === "excluidos" ? "excluido_em.desc" : "criado_em.desc";
    const url = `${base}?select=${CAMPOS_LEAD}&order=${ordem}&limit=300${f.length ? `&${f.join("&")}` : ""}`;
    const lista = await banco(url, { headers: cabecalhos(tok) });
    return res.status(200).json({ leads: lista || [] });
  }

  /* EXCLUIR E DESFAZER.
   *
   * **A justificativa é obrigatória**, e é ela que separa limpeza de
   * faxina: sem motivo escrito, "excluir" vira o botão que se aperta
   * para tirar da tela — a mesma armadilha que o motivo de "perdido"
   * evita (decisão 27). Com o motivo, dá para responder depois se o
   * que se exclui é engano de digitação ou cliente difícil.
   *
   * **Quem excluiu é carimbado pelo servidor**, do token: a tela não
   * escolhe o nome (mesma regra da 0008).
   */
  /* A LIGAÇÃO É CONTADA PELO BOTÃO, nunca digitada.
   *
   * Ninguém anota "foi a terceira" com o telefone na orelha; o que se
   * faz é apertar ligar. Campo digitado aqui ficaria em branco como
   * todo campo que se pede para preencher depois.
   *
   * **Conta tentativa, não conversa** — o sistema não sabe se
   * atenderam, e fingir que sabe seria pior. "4ª call" quer dizer que
   * se tentou quatro vezes, que é exatamente o que faz decidir se
   * vale a quinta.
   */
  if (req.method === "POST" && String(req.query.acao || "") === "ligacao") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const atual = (await banco(`${base}?select=ligacoes&id=eq.${id}`, { headers: cabecalhos(tok) }) || [])[0];
    if (!atual) return res.status(404).json({ erro: "Lead não encontrado." });
    const r = await banco(`${base}?id=eq.${id}`, {
      method: "PATCH", headers: json(tok, { Prefer: "return=representation" }),
      body: JSON.stringify({ ligacoes: (Number(atual.ligacoes) || 0) + 1, ultima_ligacao_em: new Date().toISOString() }),
    });
    const linha = (Array.isArray(r) ? r[0] : r) || null;
    if (!linha) return res.status(403).json({ erro: "Não consegui registrar a ligação." });
    return res.status(200).json({ lead: linha });
  }

  if (req.method === "POST" && String(req.query.acao || "") === "excluir") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c2 = (req.body && typeof req.body === "object") ? req.body : {};
    const motivo = String(c2.motivo || "").trim();
    if (motivo.length < 3) return res.status(400).json({ erro: "Escreva por que está excluindo." });
    const r = await banco(`${base}?id=eq.${id}`, {
      method: "PATCH", headers: json(tok, { Prefer: "return=representation" }),
      body: JSON.stringify({
        excluido_em: new Date().toISOString(), excluido_por: donoDoToken(tok),
        excluido_motivo: motivo.slice(0, 400),
      }),
    });
    const linha = (Array.isArray(r) ? r[0] : r) || null;
    if (!linha) return res.status(403).json({ erro: "Não consegui excluir." });
    return res.status(200).json({ lead: linha });
  }

  if (req.method === "POST" && String(req.query.acao || "") === "restaurar") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    // O motivo fica: ele conta por que a linha saiu e voltou, e apagar
    // junto seria perder metade da história.
    const r = await banco(`${base}?id=eq.${id}`, {
      method: "PATCH", headers: json(tok, { Prefer: "return=representation" }),
      body: JSON.stringify({ excluido_em: null, excluido_por: null }),
    });
    const linha = (Array.isArray(r) ? r[0] : r) || null;
    if (!linha) return res.status(403).json({ erro: "Não consegui restaurar." });
    return res.status(200).json({ lead: linha });
  }

  if (req.method === "POST" && String(req.query.acao || "") === "compareceu") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const atual = (await banco(`${base}?select=*&id=eq.${id}`, { headers: cabecalhos(tok) }) || [])[0];
    if (!atual) return res.status(404).json({ erro: "Lead não encontrado." });
    if (atual.atendimento_id) return res.status(200).json({ ok: true, atendimento_id: atual.atendimento_id, ja_existia: true });

    // O atendimento nasce com o que a pré-venda já perguntou ao
    // telefone. É o ponto inteiro desta tela: ninguém redigita nome,
    // telefone e carro com o cliente parado na frente da mesa.
    const corpo = await lerCorpo(req) || {};
    const novoAt = {
      data: hojeAqui(),
      cliente_nome: atual.nome,
      cliente_telefone: atual.telefone,
      carro_descricao: atual.carro,
      origem: atual.origem || "outro",
      status: "cliente_na_loja",
      negociador_id: await idDePerfil(tok, corpo.negociador_id),
      negociador_nome: texto(corpo.negociador_nome) || atual.negociador_nome,
      prospec: atual.prospector_nome,
      observacoes: atual.observacoes,
    };
    const criado = await banco(REST("atendimento"), {
      method: "POST", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify(novoAt),
    });
    const at = Array.isArray(criado) ? criado[0] : criado;
    if (!at) return res.status(403).json({ erro: "O banco recusou a criação do atendimento." });

    await banco(`${base}?id=eq.${id}`, {
      method: "PATCH", headers: cabJson,
      body: JSON.stringify({ status: "compareceu", atendimento_id: at.id }),
    });
    return res.status(201).json({ ok: true, atendimento: at, atendimento_id: at.id });
  }

  if (req.method === "POST") {
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const l = paraLead(c);
    if (!l.nome) return res.status(400).json({ erro: "Informe o nome." });
    if (l.agendado_para && !l.status) l.status = "agendado";
    const r = await banco(base, { method: "POST", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify(l) });
    const salvo = Array.isArray(r) ? r[0] : r;
    if (!salvo) return res.status(403).json({ erro: "O banco recusou o lead." });
    return res.status(201).json({ ok: true, lead: salvo });
  }

  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const l = paraLead(c);

    // Remarcar guarda a data antiga. Sem isso, "remarcou três vezes"
    // — que é o que diz se o cliente vem mesmo — some no primeiro
    // clique.
    if (l.agendado_para !== undefined) {
      const atual = (await banco(`${base}?select=agendado_para,remarcacoes,status&id=eq.${id}`, { headers: cabecalhos(tok) }) || [])[0];
      if (atual && atual.agendado_para && l.agendado_para && atual.agendado_para !== l.agendado_para) {
        const hist = Array.isArray(atual.remarcacoes) ? atual.remarcacoes : [];
        l.remarcacoes = hist.concat([{ de: atual.agendado_para, para: l.agendado_para, em: new Date().toISOString(), motivo: texto(c.motivo) }]);
        // Remarcou: a confirmação anterior não vale mais.
        l.status = l.status || "agendado";
        l.confirmado_em = null; l.confirmado_por = null;
      } else if (atual && !atual.agendado_para && l.agendado_para && !l.status) {
        l.status = "agendado";
      }
    }
    if (c.confirmado === true) { l.status = "confirmado"; l.confirmado_em = new Date().toISOString(); l.confirmado_por = donoDoToken(tok); }
    if (c.confirmado === false) { l.status = "agendado"; l.confirmado_em = null; l.confirmado_por = null; }
    if (!Object.keys(l).length) return res.status(400).json({ erro: "Nada para atualizar." });

    const r = await banco(`${base}?id=eq.${id}`, { method: "PATCH", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify(l) });
    const salvo = Array.isArray(r) ? r[0] : r;
    if (!salvo) return res.status(403).json({ erro: "A regra do banco recusou a alteração." });
    return res.status(200).json({ ok: true, lead: salvo });
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
}

/**
 * Leads de indicação (0011).
 *
 * O nome do negociador e o do cliente vêm em texto e ficam gravados em
 * texto: o lead precisa se explicar sozinho meses depois, quando
 * ninguém lembrar de qual atendimento ele saiu.
 *
 * Status fora da lista vira `novo` em vez de 400 — a tela manda o que
 * o botão oferece, e recusar o atendimento inteiro por causa de um
 * rótulo de lead seria desproporcional.
 */
async function indicacoes(req, res, tok) {
  if (req.method === "GET") {
    const st = String(req.query.status || "");
    let filtro = STATUS_INDICACAO.indexOf(st) >= 0 ? `&status=eq.${st}` : "";
    // "O que eu tenho para ligar neste dia" — o que leva a indicação
    // para a agenda do Meu dia sem virar linha na tabela `agenda`.
    const proximo = String(req.query.proximo || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(proximo)) filtro += `&proximo_contato=eq.${proximo}`;
    const lim = Math.min(500, Math.max(1, Number(req.query.limite) || 200));
    const lista = await banco(
      `${REST("indicacao")}?select=*&order=criado_em.desc&limit=${lim}${filtro}`,
      { headers: cabecalhos(tok) }
    );
    return res.status(200).json({ indicacoes: Array.isArray(lista) ? lista : [] });
  }

  if (req.method === "POST") {
    const corpo = await lerCorpo(req);
    if (!corpo) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    const nomes = Array.isArray(corpo.indicacoes) ? corpo.indicacoes : [corpo];
    const linhas = nomes
      .map((c) => ({
        atendimento_id: RX_UUID.test(String(c.atendimento_id || "")) ? c.atendimento_id : null,
        nome: texto(c.nome),
        telefone: texto(c.telefone),
        negociador_nome: texto(c.negociador_nome),
        cliente_nome: texto(c.cliente_nome),
        cliente_telefone: texto(c.cliente_telefone),
        status: STATUS_INDICACAO.indexOf(String(c.status || "")) >= 0 ? c.status : "novo",
        observacoes: texto(c.observacoes),
      }))
      .filter((l) => l.nome);

    if (!linhas.length) return res.status(400).json({ erro: "Indicação sem nome." });

    // Lote só de ida: mandar cinco indicações é uma requisição, não cinco.
    const salvo = await banco(REST("indicacao"), {
      method: "POST",
      headers: json(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(linhas),
    });
    return res.status(201).json({ ok: true, indicacoes: Array.isArray(salvo) ? salvo : [] });
  }

  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });

    const corpo = await lerCorpo(req);
    if (!corpo) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    const linha = { atualizado_em: new Date().toISOString() };
    if (corpo.status != null) {
      if (STATUS_INDICACAO.indexOf(String(corpo.status)) < 0) {
        return res.status(400).json({ erro: "Status de indicação desconhecido." });
      }
      linha.status = corpo.status;
    }
    ["nome", "telefone", "negociador_nome", "cliente_nome", "cliente_telefone", "observacoes"]
      .forEach((k) => { if (corpo[k] != null) linha[k] = texto(corpo[k]); });
    // A data do próximo contato (0049). Vazia limpa o retorno — é como
    // se tira da fila do dia quem já foi resolvido.
    if (corpo.proximo_contato !== undefined) {
      const d = String(corpo.proximo_contato || "");
      linha.proximo_contato = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
    }

    const r = await banco(`${REST("indicacao")}?id=eq.${id}`, {
      method: "PATCH",
      headers: json(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(linha),
    });
    const salvo = Array.isArray(r) ? r[0] : r;
    if (!salvo) return res.status(403).json({ erro: "Indicação fora do seu alcance." });
    return res.status(200).json({ ok: true, indicacao: salvo });
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
}

/* ===================== painel do gestor (0033) ===================== */

/**
 * O espelho da negociação aberta.
 *
 * PUT — o aparelho do negociador manda o estado de agora e sobrescreve.
 *       Não é histórico: é onde ele está neste momento. O histórico das
 *       rodadas já existe em `documento`, com protocolo.
 * GET — sem `atendimento_id`, devolve as negociações vivas para o
 *       painel; com, devolve uma.
 *
 * Quem pode ler o quê é decidido pela RLS da 0033, não aqui: gerente vê
 * todas, o negociador vê a dele. Repetir a regra neste arquivo criaria
 * duas versões dela para manter em sincronia.
 */
/**
 * OUVIR A MESA — só o combinado da chamada (0052).
 *
 * O som vai do celular do negociador direto para o computador do
 * gestor (WebRTC). **Nada de áudio passa por aqui**; o que trafega é
 * o SDP dos dois lados. É isso que mantém verdadeira a frase que o
 * cliente ouviu: não há lugar onde o áudio pudesse ficar guardado.
 *
 * **A trava do consentimento é AQUI, não na tela.** A tela esconder o
 * botão é conveniência; a recusa é do servidor — mesma régua do
 * `api/checklist.js` com os vistos do administrativo (decisão 19).
 * Sem aceite, ou com aceite anterior à redação de 16/09/2026
 * (`escuta_versao` nulo, 0051), não abre sessão nenhuma: aquele
 * cliente autorizou a transcrição e não autorizou ninguém ouvir a
 * sala.
 */
async function escuta(req, res, tok) {
  const REST_E = `${URL_BASE}/rest/v1/escuta_sessao`;

  // STUN é de graça e resolve a maioria das redes. TURN é o
  // retransmissor para quando a conexão direta não fecha — serviço
  // pago, opcional, e as credenciais só saem daqui para quem já está
  // autenticado. Sem as variáveis, vai só o STUN e a tela avisa se a
  // conexão não fechar.
  const ice = () => {
    const lista = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
    if (process.env.TURN_URL && process.env.TURN_USUARIO && process.env.TURN_SENHA) {
      lista.push({
        urls: String(process.env.TURN_URL).split(",").map((x) => x.trim()).filter(Boolean),
        username: process.env.TURN_USUARIO,
        credential: process.env.TURN_SENHA,
      });
    }
    return lista;
  };

  if (req.method === "POST") {
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const aid = String(c.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    const oferta = String(c.oferta || "");
    if (!oferta) return res.status(400).json({ erro: "Sem a oferta da chamada." });

    // O aceite do cliente, lido do banco — nunca do corpo.
    const viv = await banco(
      `${URL_BASE}/rest/v1/negociacao_viva?select=escuta_ok,escuta_versao&atendimento_id=eq.${aid}`,
      { headers: cabecalhos(tok) });
    const v = (viv || [])[0];
    if (!v || !v.escuta_ok) {
      return res.status(403).json({ erro: "O cliente não autorizou a escuta neste atendimento." });
    }
    if (!v.escuta_versao) {
      return res.status(403).json({
        erro: "O aceite deste atendimento é anterior a 16/09/2026: ele autoriza a transcrição, não ouvir a conversa.",
      });
    }

    // Uma aberta por vez (índice único da 0052). Encerrar a anterior
    // antes é o que deixa o gestor tentar de novo depois de uma
    // tentativa que ficou pendurada.
    await banco(`${REST_E}?atendimento_id=eq.${aid}&encerrado_em=is.null`, {
      method: "PATCH", headers: json(tok),
      body: JSON.stringify({ encerrado_em: new Date().toISOString() }),
    }).catch(() => {});

    const r = await banco(REST_E, {
      method: "POST",
      headers: json(tok, { Prefer: "return=representation" }),
      // `gestor_id` não vai no corpo: o padrão da coluna é `auth.uid()`
      // (0052). Quem é identificado por um id não pode ser quem o
      // escolhe — mesma lição da agenda (0047).
      body: JSON.stringify({ atendimento_id: aid, oferta }),
    });
    const sessao = Array.isArray(r) ? r[0] : r;
    if (!sessao) return res.status(403).json({ erro: "Só o gerente pode ouvir a mesa." });
    return res.status(200).json({ sessao, ice: ice() });
  }

  if (req.method === "GET") {
    const id = String(req.query.id || "");
    if (RX_UUID.test(id)) {
      const r = await banco(`${REST_E}?select=*&id=eq.${id}`, { headers: cabecalhos(tok) });
      return res.status(200).json({ sessao: (r || [])[0] || null });
    }
    const aid = String(req.query.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "Informe id ou atendimento_id." });
    const r = await banco(
      `${REST_E}?select=*&atendimento_id=eq.${aid}&encerrado_em=is.null&order=criado_em.desc&limit=1`,
      { headers: cabecalhos(tok) });
    return res.status(200).json({ sessao: (r || [])[0] || null, ice: ice() });
  }

  if (req.method === "PATCH") {
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const id = String(c.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });

    const mud = {};
    if (c.resposta !== undefined) mud.resposta = String(c.resposta || "") || null;
    // O erro é para ser LIDO pelo gestor: microfone ocupado pela
    // transcrição, permissão negada, aparelho sem suporte. Sem isso
    // ele fica olhando para um botão que não acontece.
    if (c.erro !== undefined) mud.erro = texto(c.erro);
    if (c.encerrar) mud.encerrado_em = new Date().toISOString();
    if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para mudar." });

    const r = await banco(`${REST_E}?id=eq.${id}`, {
      method: "PATCH", headers: json(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(mud),
    });
    const sessao = Array.isArray(r) ? r[0] : r;
    if (!sessao) return res.status(403).json({ erro: "Esta chamada não é sua." });
    return res.status(200).json({ sessao });
  }

  return res.status(405).json({ erro: "Método não suportado." });
}

async function viva(req, res, tok) {
  const REST_V = `${URL_BASE}/rest/v1/negociacao_viva`;

  if (req.method === "PUT") {
    const c = await lerCorpo(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const aid = String(c.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

    const linha = { atendimento_id: aid, atualizado_em: new Date().toISOString() };
    if (c.etapa !== undefined) linha.etapa = texto(c.etapa);
    if (c.objecao !== undefined) linha.objecao = texto(c.objecao);
    if (c.valor_fechado !== undefined) linha.valor_fechado = decimal(c.valor_fechado);
    if (c.escuta_ok !== undefined) linha.escuta_ok = !!c.escuta_ok;
    if (c.escuta_em !== undefined) linha.escuta_em = c.escuta_em || null;
    // Qual redação o cliente ouviu (0051). Nulo é "aceite antigo", que
    // é a resposta certa para tudo que veio antes de 16/09/2026.
    if (c.escuta_versao !== undefined) linha.escuta_versao = texto(c.escuta_versao) || null;
    // A transcrição tem teto. Uma conversa de uma hora dá uns 30 KB; o
    // teto existe para o caso de o reconhecimento entrar em laço e
    // encher a coluna — e corta o COMEÇO, porque o fim é o que importa
    // para quem está acompanhando agora.
    if (c.transcricao !== undefined) {
      const t = String(c.transcricao || "");
      linha.transcricao = t.length > 120000 ? t.slice(t.length - 120000) : t;
    }
    // O resultado de `etapaConcluida()`, não a regra: quem decide se a
    // etapa fechou é a tela do negociador, e reescrever isso aqui faria
    // o painel cobrar coisa que a tela não pede.
    // O retrato da pesquisa: motivo, pretensão, dívida, decisor. É o
    // que o gestor lê no lugar da transcrição.
    if (c.pesquisa && typeof c.pesquisa === "object") {
      const p = c.pesquisa;
      linha.pesquisa = {
        motivo: texto(p.motivo), motivo_detalhe: texto(p.motivo_detalhe),
        pretensao: decimal(p.pretensao), quitacao: decimal(p.quitacao), debitos: decimal(p.debitos),
        decisor: !!p.decisor, entrega_hoje: !!p.entrega_hoje,
        necessidade: texto(p.necessidade), objecao: texto(p.objecao),
        forma: texto(p.forma), canais: Math.trunc(Number(p.canais) || 0),
      };
    }
    if (Array.isArray(c.etapas_ok)) {
      linha.etapas_ok = c.etapas_ok.filter((x) => typeof x === "string").slice(0, 12);
    }
    if (Array.isArray(c.rodadas)) {
      linha.rodadas = c.rodadas.slice(0, 20).map((r) => ({
        impresso: decimal(r && r.impresso),
        contra: decimal(r && r.contra),
        em: (r && r.em) || null,
      }));
    }

    // A ficha de trabalho inteira (0050). Ela volta para a tela do
    // outro aparelho, então aqui não se recorta nada: campo que este
    // arquivo não conhecesse sumiria no caminho de volta, e o
    // negociador veria o dado evaporar — que é o problema que a 0050
    // existe para resolver.
    //
    // **Grande demais é erro, não silêncio.** Enquanto o espelho
    // servia só ao painel do gestor, engolir a falha era o certo: não
    // se interrompe um atendimento por causa de um relatório. Agora
    // ele carrega o trabalho da pessoa, e sincronização que falha
    // calada é exatamente como o dado do 206 sumiu.
    if (c.ficha !== undefined) {
      if (!c.ficha || typeof c.ficha !== "object" || Array.isArray(c.ficha)) {
        return res.status(400).json({ erro: "ficha fora do formato." });
      }
      if (JSON.stringify(c.ficha).length > 600000) {
        return res.status(413).json({ erro: "A ficha passou do tamanho que cabe na sincronização." });
      }
      linha.ficha = c.ficha;
    }

    // **RLS aqui não é erro, é resposta.** A política da 0033 deixa
    // escrever só quem conduz o atendimento — nem o gerente escreve no
    // de outro, de propósito: o espelho vem do aparelho de quem está
    // com o cliente. Sem esta tradução, o gerente que abre o
    // atendimento de um negociador para OLHAR leva na tela o texto cru
    // do Postgres ("new row violates row-level security policy for
    // table negociacao_viva") dentro de uma tarja laranja dizendo que
    // o trabalho dele pode se perder. Não pode: ele não está digitando
    // nada.
    let r;
    try {
      r = await banco(`${REST_V}?on_conflict=atendimento_id`, {
        method: "POST",
        headers: json(tok, { Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(linha),
      });
    } catch (e) {
      if (/row-level security|violates row/i.test(String(e && e.message))) {
        return res.status(403).json({ erro: "alheio", detalhe: "Este atendimento é de outro negociador." });
      }
      throw e;
    }
    const salvo = Array.isArray(r) ? r[0] : r;
    // Vazio é a RLS recusando: quem não conduz o atendimento não
    // espelha. A tela não mostra isso — o espelho é silencioso de
    // propósito, para não interromper o atendimento por causa dele.
    return res.status(200).json({ ok: !!salvo });
  }

  if (req.method === "GET") {
    const aid = String(req.query.atendimento_id || "");
    if (aid) {
      if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
      // O pedido de escuta vem junto (0052). O aparelho do negociador
      // já bate aqui de cinco em cinco segundos; uma consulta própria
      // para isso dobraria o tráfego dele para uma pergunta que quase
      // sempre responde "ninguém está ouvindo".
      const [r, ses] = await Promise.all([
        banco(`${REST_V}?select=*&atendimento_id=eq.${aid}`, { headers: cabecalhos(tok) }),
        banco(`${URL_BASE}/rest/v1/escuta_sessao?select=*&atendimento_id=eq.${aid}&encerrado_em=is.null&order=criado_em.desc&limit=1`,
          { headers: cabecalhos(tok) }).catch(() => []),
      ]);
      return res.status(200).json({ viva: (r || [])[0] || null, sessao: (ses || [])[0] || null });
    }

    // O painel é o que está na mesa AGORA. Um atendimento presencial
    // dura menos de uma hora — a própria tela combina "cerca de 40
    // minutos" com o cliente —, então a janela é de horas, não de
    // dias. O que passou disso não está mais acontecendo: está na fila
    // de revisão, que é outra pergunta. O teto é 12 h — um dia de loja —
    // e não é configurável de fora: janela maior transformaria o painel
    // em lista de arquivo, que é o que ele existe para não ser.
    const horas = Math.min(12, Math.max(1, Number(req.query.horas) || 3));
    const desde = new Date(Date.now() - horas * 3600000).toISOString();
    const linhas = await banco(
      `${REST_V}?select=*&atualizado_em=gte.${desde}&order=atualizado_em.desc&limit=200`,
      { headers: cabecalhos(tok) }) || [];

    if (!linhas.length) return res.status(200).json({ negociacoes: [] });

    // Os dados do atendimento numa consulta só, e as mensagens não
    // lidas noutra. Duas idas ao banco em vez de duas por linha.
    const ids = linhas.map((x) => x.atendimento_id);
    const [ats, recados] = await Promise.all([
      banco(`${REST("atendimento")}?select=id,cliente_nome,cliente_telefone,carro_descricao,status,negociador_nome,data,` +
            `veiculo(placa,marca_modelo,fipe_valor,valor_por)&id=in.(${ids.join(",")})`, { headers: cabecalhos(tok) }),
      banco(`${REST("mensagem")}?select=atendimento_id,de,criado_em,lida_em&atendimento_id=in.(${ids.join(",")})` +
            `&order=criado_em.desc&limit=500`, { headers: cabecalhos(tok) }),
    ]);
    const porId = {};
    (ats || []).forEach((a) => { porId[a.id] = a; });
    const naoLidas = {};
    const ultima = {};
    (recados || []).forEach((m) => {
      if (!m.lida_em) naoLidas[m.atendimento_id] = (naoLidas[m.atendimento_id] || 0) + 1;
      if (!ultima[m.atendimento_id]) ultima[m.atendimento_id] = m.criado_em;
    });

    return res.status(200).json({
      negociacoes: linhas.map((v) => ({
        ...v,
        atendimento: porId[v.atendimento_id] || null,
        nao_lidas: naoLidas[v.atendimento_id] || 0,
        ultima_mensagem: ultima[v.atendimento_id] || null,
      })),
    });
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ erro: "Use GET ou PUT." });
}

/**
 * A revisão do gestor.
 *
 * GET  ?de=&ate=          a fila: atendimentos do período, com a
 *                         revisão quando existe. Sem linha = pendente.
 * PUT  { atendimento_id, feedback }   grava o retorno.
 * PATCH ?atendimento_id=  o negociador marca como lido.
 *
 * A fila é toda a lista do período, e não só os fechados: **acompanhar
 * ao vivo ajuda um atendimento, revisar depois ensina o próximo** — e
 * o que mais ensina costuma ser o que não fechou.
 */
/**
 * Quem prometeu voltar, e quando.
 *
 * É o status mais comum depois de "baixar expectativa", e o único que
 * deixa um compromisso em aberto. A lista vem ordenada pela data, com
 * o que já venceu primeiro — o vencido é o que custa dinheiro.
 */
async function voltas(req, res, tok) {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const linhas = await banco(
    `${REST("atendimento")}?select=id,cliente_nome,cliente_telefone,carro_descricao,volta_em,status,negociador_nome,` +
    `veiculo(placa,marca_modelo)&status=eq.vai_voltar&order=volta_em.asc.nullslast&limit=200`,
    { headers: cabecalhos(tok) }) || [];
  return res.status(200).json({
    hoje,
    voltas: linhas.map((a) => ({
      ...a,
      // `sem_data` é o caso que mais importa: alguém marcou "vai
      // voltar" e não combinou quando. Some da cobrança e some do
      // funil junto.
      sem_data: !a.volta_em,
      atrasada: !!a.volta_em && a.volta_em < hoje,
    })),
  });
}

async function revisao(req, res, tok) {
  const REST_R = REST("revisao");

  if (req.method === "PUT") {
    const c = await lerCorpo(req);
    const aid = String((c && c.atendimento_id) || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    const fb = texto(c && c.feedback);
    if (!fb) return res.status(400).json({ erro: "Escreva o retorno." });
    const eu = donoDoToken(tok);

    const r = await banco(`${REST_R}?on_conflict=atendimento_id`, {
      method: "POST",
      headers: json(tok, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({
        atendimento_id: aid, feedback: fb.slice(0, 4000),
        revisado_por: eu, revisado_em: new Date().toISOString(),
        // Reescrever o retorno zera o "ele leu": é outro texto, e o
        // negociador precisa ver o novo.
        lida_em: null,
      }),
    });
    const salvo = Array.isArray(r) ? r[0] : r;
    if (!salvo) return res.status(403).json({ erro: "Só o gerente escreve a revisão." });
    return res.status(200).json({ ok: true, revisao: salvo });
  }

  if (req.method === "PATCH") {
    const aid = String(req.query.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    await banco(`${URL_BASE}/rest/v1/rpc/marcar_feedback_lido`, {
      method: "POST", headers: json(tok), body: JSON.stringify({ alvo: aid }),
    }).catch(() => {});
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, PUT, PATCH");
    return res.status(405).json({ erro: "Use GET, PUT ou PATCH." });
  }

  // Uma só, para o negociador ver o retorno dentro do atendimento dele.
  const um = String(req.query.atendimento_id || "");
  if (um) {
    if (!RX_UUID.test(um)) return res.status(400).json({ erro: "atendimento_id inválido." });
    const r = await banco(`${REST_R}?select=*&atendimento_id=eq.${um}`, { headers: cabecalhos(tok) });
    const linha = (r || [])[0] || null;
    let quem = null;
    if (linha && linha.revisado_por) {
      const g = await banco(`${URL_BASE}/rest/v1/perfil?select=nome&id=eq.${linha.revisado_por}`, { headers: cabecalhos(tok) });
      quem = (g || [])[0] ? g[0].nome : null;
    }
    return res.status(200).json({ revisao: linha ? { ...linha, por_nome: quem } : null });
  }

  const de = data(req.query.de);
  const ate = data(req.query.ate);
  const filtro = [de ? `data=gte.${de}` : "", ate ? `data=lte.${ate}` : ""].filter(Boolean).join("&");
  const ats = await banco(
    // `pretensao` e `observacoes` vêm junto: para o atendimento
    // importado — que nunca teve espelho — são a única pesquisa que
    // existe, e é o que o gestor tem para ler.
    `${REST("atendimento")}?select=id,cliente_nome,carro_descricao,status,negociador_nome,data,valor_fechado,` +
    `pretensao,observacoes,origem,` +
    `veiculo(placa,marca_modelo,fipe_valor)&order=data.desc&limit=300${filtro ? `&${filtro}` : ""}`,
    { headers: cabecalhos(tok) }) || [];
  if (!ats.length) return res.status(200).json({ fila: [] });

  const ids = ats.map((a) => a.id);
  const [revs, vivas] = await Promise.all([
    banco(`${REST_R}?select=*&atendimento_id=in.(${ids.join(",")})`, { headers: cabecalhos(tok) }),
    banco(`${URL_BASE}/rest/v1/negociacao_viva?select=*&atendimento_id=in.(${ids.join(",")})`, { headers: cabecalhos(tok) }),
  ]);
  const porRev = {}; (revs || []).forEach((r) => { porRev[r.atendimento_id] = r; });
  const porViva = {}; (vivas || []).forEach((v) => { porViva[v.atendimento_id] = v; });

  return res.status(200).json({
    fila: ats.map((a) => ({
      atendimento: a,
      revisao: porRev[a.id] || null,
      viva: porViva[a.id] || null,
    })),
  });
}

/**
 * O recado entre gestor e negociador.
 *
 * `de` NÃO vem do corpo: sai do token. Aceitar do cliente permitiria
 * mandar recado assinado por outra pessoa — e a RLS da 0033 recusaria,
 * mas a tela mostraria um erro sem sentido em vez de simplesmente não
 * ter o problema.
 */
async function mensagem(req, res, tok) {
  const REST_M = REST("mensagem");
  const aid = String(req.query.atendimento_id || "");
  if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

  if (req.method === "GET") {
    const linhas = await banco(
      `${REST_M}?select=*&atendimento_id=eq.${aid}&order=criado_em.asc&limit=300`,
      { headers: cabecalhos(tok) }) || [];
    // Os nomes numa consulta à parte: são chaves estrangeiras para
    // `perfil`, e o embed do PostgREST pediria o nome exato da
    // constraint — que muda se a migração for reescrita.
    const gente = await banco(`${URL_BASE}/rest/v1/perfil?select=id,nome`, { headers: cabecalhos(tok) }) || [];
    const nomes = {};
    gente.forEach((p) => { nomes[p.id] = p.nome; });
    return res.status(200).json({
      mensagens: linhas.map((m) => ({ ...m, de_nome: nomes[m.de] || null })),
      eu: donoDoToken(tok),
    });
  }

  if (req.method === "POST") {
    const c = await lerCorpo(req);
    const t = texto(c && c.texto);
    if (!t) return res.status(400).json({ erro: "Escreva a mensagem." });
    const eu = donoDoToken(tok);
    if (!eu) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });
    const r = await banco(REST_M, {
      method: "POST", headers: json(tok, { Prefer: "return=representation" }),
      body: JSON.stringify({ atendimento_id: aid, de: eu, texto: t.slice(0, 2000) }),
    });
    const salvo = Array.isArray(r) ? r[0] : r;
    if (!salvo) return res.status(403).json({ erro: "Sem permissão para mandar recado neste atendimento." });
    return res.status(201).json({ ok: true, mensagem: salvo });
  }

  // Marcar como lidas as que NÃO são minhas: marcar a própria não diz
  // nada, e apagaria o "ele ainda não viu" do outro lado.
  if (req.method === "PATCH") {
    const eu = donoDoToken(tok);
    if (!eu) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });
    await banco(`${REST_M}?atendimento_id=eq.${aid}&lida_em=is.null&de=neq.${eu}`, {
      method: "PATCH", headers: json(tok),
      body: JSON.stringify({ lida_em: new Date().toISOString() }),
    });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
}

/* ===================== A PONTE DO WHATSAPP =====================
 *
 * Quem chama aqui é o container do Baileys, não um navegador: **não há
 * usuário e não há token**, então isto vem ANTES da checagem de sessão
 * -- como o webhook do ZapSign em api/documento.js.
 *
 * A porta é um segredo compartilhado (`PONTE_SEGREDO`), o mesmo dos
 * dois lados. E a escrita passa pelas funções estreitas da 0055, não
 * pela chave de serviço: se este segredo vazar, o estrago é gravar
 * conversa, não ler a tabela `atendimento` com CPF de cliente dentro
 * (decisões 9 e 42).
 *
 * Mora em api/atendimento.js porque **o teto de 12 funções da Vercel
 * está cheio** e porque a conversa existe para virar lead e
 * atendimento, que é o assunto deste arquivo (mesma razão da
 * decisão 27).
 */
/* A DATA E A HORA QUE A IA CONFIRMOU.
 *
 * O Derek mostrou a mensagem da Ana — "confirmado para o dia
 * 05/10/2026 às 10:00" — e avisou que **a Camila escreve algo
 * completamente diferente, mas sempre confirma uma data e uma hora**.
 * Então o que se procura são as duas coisas juntas, não um molde de
 * frase: molde quebra no dia em que alguém reescreve o texto da IA, e
 * quebra em silêncio.
 *
 * **As duas são obrigatórias.** Hora sozinha ("às 10h") aparece em
 * conversa o tempo todo — "ligo às 10h", "abrimos às 9h" — e viraria
 * agendamento inventado. Data sozinha também: "o carro é de 2019".
 *
 * **Só olha o que SAIU daqui.** O cliente propondo "pode ser dia 7 às
 * 15h?" não é agendamento; agendamento é a loja confirmando.
 *
 * **Data no passado é descartada**, porque é quase sempre referência a
 * outra coisa (a data da compra, a do CRLV). O teto de 120 dias à
 * frente é pela mesma razão, do outro lado.
 */
const MESES_TXT = {
  jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};
const SEMANA_TXT = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };

/* CONFIRMAR NÃO É PROPOR, e essa é a distinção inteira.
 *
 * Lendo 22 mensagens reais da Ana e da Camila ficou claro que a maior
 * parte das que falam em hora é **proposta**, não confirmação:
 *
 *   "Tenho quarta-feira às 9h ou às 10h. Qual horário fica melhor?"
 *   "Já liberei seu horário das 15:30. Quer deixar marcado pra amanhã?"
 *   "Perfeito! Sábado às 10h é sua preferência. Ainda não está confirmado."
 *
 * Achar data e hora não basta — **essas três viram agendamento falso**,
 * e agendamento falso é pior que nenhum: põe na agenda da semana gente
 * que não vai aparecer, e a pré-venda deixa de ligar para quem ainda
 * não marcou.
 *
 * Então são três travas, e todas precisam passar:
 *
 *  1. **UMA hora só.** "às 9h ou às 10h" é escolha, não marcação.
 *  2. **Uma palavra de fechamento** (confirmado, agendado, combinado,
 *     te espero, fechado…). É vocabulário de intenção, não molde de
 *     frase: a Ana e a Camila escrevem diferente e as duas usam essas
 *     palavras.
 *  3. **Nenhuma palavra que desmarca** — "ainda não", "qual horário",
 *     "prefere", "tenho vaga". Elas ganham da trava 2, porque
 *     "confirmado" aparece também em "ainda não está confirmado".
 *
 * **O erro que se prefere é o de deixar passar.** Lead que fica em
 * AGENDAR quando já tinha hora marcada custa uma conferência; lead que
 * vai para AGENDADO sem ter hora custa um horário vazio na loja.
 */
const FECHA = /confirmad|agendad|combin(?:ad|ou|amos|ei)|te espero|te aguardo|esperamos voc|fechado|deixei tudo certo|marcad[oa]\s+(?:pra|para)|ficou agendada|j[aá] est[aá] marcad/i;
const DESMARCA = /ainda n[aã]o|n[aã]o est[aá] confirmad|sujeito a|preciso confirmar|qual (?:hor[aá]rio|desses|dia|fica)|fica melhor|prefere|gostaria|quer aproveitar|ficaria bom|hor[aá]rio livre|tenho vaga|tenho dispon[ií]vel|liberei|posso te (?:oferecer|dar)|op[cç][oõ]es/i;

function dataHoraConfirmada(texto, base) {
  const t = String(texto || "");
  if (!t) return null;
  const limpo = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  if (!FECHA.test(limpo)) return null;
  if (DESMARCA.test(limpo)) return null;

  // TODAS as horas do texto: duas ou mais e é proposta.
  const horas = [];
  const rxH = /\b(\d{1,2})\s*(?::|h)\s*(\d{2})?\b/g;
  let m;
  while ((m = rxH.exec(limpo))) {
    const h = Number(m[1]), mi = m[2] == null ? 0 : Number(m[2]);
    if (h > 23 || mi > 59) continue;
    // "das 08:30 às 12:30" é horário de funcionamento, não marcação —
    // e aparece como duas horas, que a regra abaixo já recusa.
    const chave = `${h}:${mi}`;
    if (horas.indexOf(chave) < 0) horas.push(chave);
  }
  if (horas.length !== 1) return null;
  const [hora, min] = horas[0].split(":").map(Number);

  const ref = base ? new Date(base) : new Date();
  // O dia de hoje em Joinville, que é o que "amanhã" quer dizer.
  const hojeAqui = new Date(ref.getTime() - 3 * 3600000);
  let ano = null, mes = null, dia = null;

  const md = limpo.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  const mx = limpo.match(/\b(\d{1,2})\s+de\s+([a-z]{3})/);
  const mdia = limpo.match(/\bdia\s+(\d{1,2})\b(?!\s*\/)/);
  const msem = limpo.match(/\b(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\b/);

  if (md) {
    dia = Number(md[1]); mes = Number(md[2]);
    if (md[3]) { ano = Number(md[3]); if (ano < 100) ano += 2000; }
  } else if (mx && MESES_TXT[mx[2]]) {
    dia = Number(mx[1]); mes = MESES_TXT[mx[2]];
  } else if (/\bamanha\b/.test(limpo)) {
    const d = new Date(hojeAqui.getTime() + 86400000);
    ano = d.getUTCFullYear(); mes = d.getUTCMonth() + 1; dia = d.getUTCDate();
  } else if (/\bhoje\b/.test(limpo)) {
    ano = hojeAqui.getUTCFullYear(); mes = hojeAqui.getUTCMonth() + 1; dia = hojeAqui.getUTCDate();
  } else if (mdia) {
    // "dia 7" sem mês: o mês corrente, e o seguinte se o dia já passou.
    dia = Number(mdia[1]);
    ano = hojeAqui.getUTCFullYear(); mes = hojeAqui.getUTCMonth() + 1;
    if (dia < hojeAqui.getUTCDate()) { mes += 1; if (mes > 12) { mes = 1; ano += 1; } }
  } else if (msem) {
    // "sábado" é o próximo sábado; hoje mesmo não, porque quem marca
    // para hoje escreve "hoje".
    const alvo = SEMANA_TXT[msem[1]];
    const d = new Date(hojeAqui);
    const falta = ((alvo - d.getUTCDay()) + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() + falta);
    ano = d.getUTCFullYear(); mes = d.getUTCMonth() + 1; dia = d.getUTCDate();
  } else return null;

  if (!(dia >= 1 && dia <= 31) || !(mes >= 1 && mes <= 12)) return null;
  if (ano == null) {
    ano = hojeAqui.getUTCFullYear();
    if (Date.UTC(ano, mes - 1, dia) < hojeAqui.getTime() - 7 * 86400000) ano += 1;
  }

  /* O RELÓGIO É O DE JOINVILLE. "às 10:00" na mensagem quer dizer 10
   * da manhã aqui; guardar como UTC puro jogaria o compromisso para as
   * 7h na agenda (mesma armadilha da decisão 22). UTC−3 o ano todo. */
  const quando = new Date(Date.UTC(ano, mes - 1, dia, hora + 3, min, 0));
  if (isNaN(quando.getTime())) return null;
  const agora = ref.getTime();
  if (quando.getTime() < agora - 2 * 3600000) return null;
  if (quando.getTime() > agora + 120 * 86400000) return null;
  return quando.toISOString();
}

async function ponte(req, res) {
  const segredo = process.env.PONTE_SEGREDO || "";
  if (!segredo || req.headers["x-ponte-segredo"] !== segredo) {
    return res.status(401).json({ ok: false, erro: "sem permissão" });
  }
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false }); }

  const c = (req.body && typeof req.body === "object") ? req.body : {};
  const canal = String(c.canal || "").trim();
  const acao = String(req.query.acao || "");

  // `fetch` direto na RPC: estas funções são o único caminho de
  // escrita da ponte, e chamá-las pela chave anônima é o que mantém a
  // de serviço fora daqui.
  const rpc = async (nome, corpo) => {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const txt = await r.text();
    if (!r.ok) { const e = new Error(txt.slice(0, 200)); e.status = r.status; throw e; }
    try { return txt ? JSON.parse(txt) : null; } catch (x) { return null; }
  };

  if (acao === "entrada") {
    const tipo = ["texto", "midia", "botao", "reacao"].indexOf(String(c.tipo)) >= 0 ? String(c.tipo) : null;
    if (!tipo) return res.status(200).json({ ok: true, pulado: "tipo não tratado" });
    // Botão e mídia viajam inteiros em `anexo`: o formato é da ponte e
    // pode crescer sem migration nova.
    const anexo = c.tipo === "midia" ? (c.midia || null) : c.tipo === "botao" ? (c.botao || null) : c.tipo === "reacao" ? (c.reacao || null) : null;
    const texto = c.tipo === "texto" ? String(c.texto || "")
      : c.tipo === "botao" ? String((c.botao && c.botao.title) || "")
      : c.tipo === "midia" ? String((c.midia && c.midia.legenda) || "") : "";
    try {
      const id = await rpc("wa_receber", {
        p_canal: canal, p_telefone: String(c.fone || ""), p_nome: String(c.nome || ""),
        p_wa_id: String(c.id || ""), p_eco: !!c.eco, p_tipo: tipo, p_texto: texto,
        p_anexo: anexo, p_quando: new Date(Number(c.quando) || Date.now()).toISOString(),
        p_anuncio: c.referral || null,
      });
      /* A CONVERSA MOVE O LEAD (0059), e aqui só se diz o que
       * aconteceu — quem decide se isso muda alguma coisa é a função
       * do banco. A regra viver em dois lugares é como ela passa a
       * divergir de si mesma.
       *
       * Falha em silêncio: o funil é consequência da conversa, e um
       * erro aqui não pode fazer a ponte devolver erro e reentregar a
       * mensagem em laço. */
      if (id) {
        try {
          const quando = c.eco ? dataHoraConfirmada(texto, c.quando ? Number(c.quando) : Date.now()) : null;
          const DO_CANAL = { "prospeccao-ativa": "prospeccao", tv: "tv", loja: "fluxo_loja" };
          await rpc("wa_lead_avanca", {
            p_mensagem: id,
            p_evento: quando ? "agendou" : c.eco ? "nada" : "respondeu",
            p_quando: quando,
            p_origem: c.referral ? "facebook" : (DO_CANAL[canal] || "outro"),
          });
        } catch (e) {}
      }
      // `novo: false` = a ponte reentregou algo que já estava aqui.
      return res.status(200).json({ ok: true, novo: !!id });
    } catch (e) { return res.status(200).json({ ok: false, erro: String(e.message || e).slice(0, 180) }); }
  }

  if (acao === "status") {
    try {
      const ok = await rpc("wa_estado", {
        p_canal: canal, p_telefone: String(c.fone || ""),
        p_wa_id: String(c.id || ""), p_estado: String(c.status || ""),
      });
      return res.status(200).json({ ok: !!ok });
    } catch (e) { return res.status(200).json({ ok: false }); }
  }

  if (acao === "estado") {
    // Guarda o número assim que o QR é lido -- antes disso ninguém
    // sabe qual número aquele canal virou.
    const fone = String(c.numero || "").replace(/\D/g, "");
    // Pela função da 0056, não por PATCH: a RLS da 0054 recusaria a
    // chave anônima com 0 linhas e silêncio, e a coluna ficaria vazia
    // para sempre sem ninguém saber por quê.
    if (fone && canal) {
      try { await rpc("wa_numero", { p_canal: canal, p_telefone: fone }); } catch (e) {}
    }
    return res.status(200).json({ ok: true });
  }

  /* COLETA NÃO GUARDA ARQUIVO, e isso é decisão, não esquecimento.
   * Guardar mídia pediria a chave de serviço no Storage -- um terceiro
   * uso que a decisão 9 proíbe sem conversa. A mensagem fica
   * registrada com tipo, mime, nome e legenda; o arquivo em si
   * continua no WhatsApp. Quando a mídia for necessária, isto vira
   * assunto próprio. */
  if (acao === "midia") return res.status(200).json({ ok: true, chave: "" });

  return res.status(400).json({ ok: false, erro: "ação desconhecida" });
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  // Antes da checagem de sessão: quem chama é servidor, não gente.
  if (String(req.query.recurso || "") === "ponte") {
    try { return await ponte(req, res); }
    catch (e) { return res.status(200).json({ ok: false, erro: "falhou" }); }
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  /* ===================== AS AÇÕES =====================
   *
   * Pedido do Derek em 05/10/2026: *"tarefas para o meu pré-vendas
   * fazer de acordo com certas situações. como se fosse uma
   * programação de automação, mas feita manualmente através de listas
   * de ação"*. O exemplo dele é a primeira regra: cliente há três dias
   * em AGENDAR que ainda não agendou.
   *
   * **O quadro mostra onde cada um está; as ações dizem em quem
   * encostar hoje.** São perguntas diferentes: o quadro é o estado, e
   * olhar estado não diz quem está parado há tempo demais. Sem isto,
   * o lead que ninguém tocou continua no mesmo lugar para sempre e
   * ninguém percebe — é o vazamento silencioso que a decisão 27 já
   * descreve no agendamento que passou.
   *
   * **As regras são calculadas, não gravadas.** Nada de uma tabela de
   * tarefas que precisa ser criada, marcada como feita e limpa: a
   * lista é consequência do estado, então ela se esvazia sozinha
   * quando o trabalho é feito — e volta a encher sozinha. Marcar
   * "feito" sem mudar o lead seria mentira que o quadro desmente.
   *
   * **A ordem das listas é a ordem de urgência**, porque é a ordem em
   * que elas devem ser trabalhadas: primeiro quem está na loja hoje,
   * depois quem está esperando resposta agora, e por último quem
   * esfriou.
   */
  if (String(req.query.recurso || "") === "acoes") {
    const dias = Math.min(60, Math.max(0.05, Number(req.query.dias) || 3));
    /* O FILTRO DE CALL monta a lista personalizada que o Derek pediu:
     * "só de primeira call", por exemplo. `10` quer dizer dez OU MAIS
     * — quem já levou dez ligações é uma decisão, não um número. */
    const call = req.query.call == null || req.query.call === "" ? null : Number(req.query.call);
    const agora = Date.now();
    const atras = (n) => new Date(agora - n * 86400000).toISOString();

    const [leads, convs] = await Promise.all([
      banco(`${REST("lead")}?select=${CAMPOS_LEAD}&excluido_em=is.null&limit=1000`, { headers: cabecalhos(tok) }),
      banco(`${URL_BASE}/rest/v1/wa_conversa?select=telefone,lead_id,ultima_de_fora,respondida_em,ultima_em,wa_canal(slug,nome,comercial)&limit=1000`,
        { headers: cabecalhos(tok) }).catch(() => []),
    ]);

    /* QUEM ESTÁ CALADO, E DE QUAL LADO — a pergunta do Derek em
     * 05/10/2026: *"aqui o parado seria: o cliente não respondeu,
     * certo?"*. Estava impreciso: "parado" queria dizer **nada
     * mudou**, que junta dois problemas opostos.
     *
     *  - a ÚLTIMA foi deles  → nós é que devemos resposta;
     *  - a ÚLTIMA foi nossa  → o cliente sumiu.
     *
     * São ações diferentes: no primeiro caso responde-se agora, no
     * segundo liga-se. Juntos numa lista só, a pré-venda não sabe o
     * que fazer com o nome que está vendo.
     */
    const esperando = {};   // eles falaram por último
    const semResposta = {}; // nós falamos por último
    (convs || []).forEach((c) => {
      const ca = Array.isArray(c.wa_canal) ? c.wa_canal[0] : c.wa_canal;
      if (!ca || ca.comercial === false || !c.lead_id) return;
      const deles = c.ultima_de_fora || "";
      const nossa = c.respondida_em || "";
      if (deles && (!nossa || nossa < deles)) esperando[c.lead_id] = deles;
      else if (nossa) semResposta[c.lead_id] = c.ultima_em || nossa;
    });

    const hoje = hojeAqui();
    const todos = leads || [];
    const vivo = (l) => ["compareceu", "perdido"].indexOf(l.status) < 0;

    const naCall = (l) => call == null ? true
      : call >= 10 ? (Number(l.ligacoes) || 0) >= 10
      : (Number(l.ligacoes) || 0) === call;

    const listas = [
      {
        id: "hoje",
        titulo: "Na loja hoje",
        porque: "Confirme que vêm, e marque quem chegou.",
        cor: "verde",
        leads: todos.filter((l) => ["agendado", "confirmado"].indexOf(l.status) >= 0 &&
          String(l.agendado_para || "").slice(0, 10) === hoje),
      },
      {
        id: "passou",
        titulo: "Passou a hora e ninguém marcou",
        porque: "Diga se veio ou não — sem isso o lead fica parado e o funil não fecha.",
        cor: "laranja",
        leads: todos.filter((l) => ["agendado", "confirmado"].indexOf(l.status) >= 0 &&
          l.agendado_para && l.agendado_para < new Date(agora - 2 * 3600000).toISOString()),
      },
      {
        id: "amanha",
        titulo: "Amanhã, ainda sem confirmar",
        porque: "A confirmação da véspera é o que separa agendado de comparecido.",
        cor: "roxo",
        leads: todos.filter((l) => l.status === "agendado" && !l.confirmado_em &&
          String(l.agendado_para || "").slice(0, 10) ===
            new Date(Date.parse(`${hoje}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)),
      },
      {
        id: "esperando",
        titulo: "Escreveram e ninguém respondeu",
        porque: "O cliente está esperando agora. É o que esfria mais rápido.",
        cor: "laranja",
        leads: todos.filter((l) => vivo(l) && esperando[l.id]),
      },
      {
        id: "sumiu",
        titulo: `Mandamos e o cliente sumiu há ${rotuloPrazo(dias)}`,
        porque: "A última palavra foi nossa e ele não voltou. É ligação, não mensagem — mensagem ele já não respondeu.",
        cor: "roxo",
        leads: todos.filter((l) => vivo(l) && semResposta[l.id] && semResposta[l.id] < atras(dias)),
      },
      {
        id: "parado",
        titulo: `Em Agendar há ${rotuloPrazo(dias)}, sem conversa`,
        porque: "Entrou por fora do WhatsApp e ninguém moveu. Só o telefone resolve.",
        cor: "roxo",
        leads: todos.filter((l) => l.status === "em_contato" && !esperando[l.id] && !semResposta[l.id] &&
          String(l.atualizado_em || l.criado_em) < atras(dias)),
      },
      {
        id: "novo",
        titulo: "Novos que ninguém tocou",
        porque: "Entraram e ninguém falou com eles ainda.",
        cor: "roxo",
        leads: todos.filter((l) => l.status === "novo" && String(l.criado_em) < atras(1)),
      },
      {
        id: "remarcar",
        titulo: "Não vieram e não foram remarcados",
        porque: "Quem não veio é justamente quem precisa de ligação (decisão 27).",
        cor: "laranja",
        leads: todos.filter((l) => l.status === "nao_compareceu" &&
          String(l.atualizado_em || l.criado_em) < atras(dias)),
      },
      {
        id: "voltar",
        titulo: "Perdidos de seis meses atrás",
        porque: "Quem não quis naquele dia pode querer agora — enquanto tem carro, é lead.",
        cor: "cinza",
        leads: todos.filter((l) => l.status === "perdido" && String(l.atualizado_em || l.criado_em) < atras(180)),
      },
    ];

    // Lista vazia não aparece: painel cheio de zeros ensina a ignorar
    // o painel.
    return res.status(200).json({
      dias,
      call,
      listas: listas.map((x) => ({ ...x, leads: x.leads.filter(naCall) }))
        .filter((x) => x.leads.length).map((x) => ({
        ...x,
        leads: x.leads
          .sort((a, b) => String(a.agendado_para || a.atualizado_em || "").localeCompare(String(b.agendado_para || b.atualizado_em || "")))
          .slice(0, 60),
        total: x.leads.length,
      })),
    });
  }

  /* A CAIXA DE ENTRADA: TODAS AS CONVERSAS NUM LUGAR SÓ.
   *
   * Era o pedido do Derek desde o começo -- seis números de WhatsApp,
   * e hoje cada um só existe no celular em que está.
   *
   * **É da equipe, não do gerente.** A RLS da 0054 abre `wa_conversa`
   * e `wa_mensagem` para `e_equipe()`: quem atende precisa ver a
   * conversa. Só o CADASTRO dos números é do gerente (`?recurso=wa`).
   *
   * **A lista traz o canal e a última mensagem na mesma consulta**,
   * pelo embutido do PostgREST. Uma ida ao banco em vez de uma por
   * linha -- mesma razão da lista do CRM (decisão 10).
   */
  if (String(req.query.recurso || "") === "conversas") {
    const REST_CV = `${URL_BASE}/rest/v1/wa_conversa`;
    const id = String(req.query.id || "");

    /* "VIRAR LEAD": o elo que faltava, e sem redigitar nada.
     *
     * Em 03/10/2026 havia 205 conversas e SEIS leads no sistema
     * inteiro, nenhum da última semana. Não é que o canal não
     * converta: é que a conversa nunca vira registro, então não há o
     * que medir por canal (decisão 37). Pedir que a pré-venda digite
     * de novo um nome e um telefone que já estão na tela é como esse
     * registro deixa de ser feito -- a mesma lição do "chegou" da
     * decisão 27.
     *
     * **A ligação é gravada aqui**, em `wa_conversa.lead_id`. O funil
     * também casa por telefone, para alcançar lead criado por outro
     * caminho; isto é o vínculo explícito, que não depende de o
     * telefone ter sido digitado igual.
     *
     * **Idempotente**: conversa que já tem lead devolve o mesmo, como
     * o "chegou". Dois toques no botão não criam duas fichas.
     */
    if (RX_UUID.test(id) && req.method === "POST" && String(req.query.acao || "") === "lead") {
      const atual = (await banco(`${REST_CV}?select=id,telefone,nome,lead_id,anuncio,wa_canal(slug,nome,comercial)&id=eq.${id}`,
        { headers: cabecalhos(tok) }) || [])[0];
      if (!atual) return res.status(404).json({ erro: "Conversa não encontrada." });
      if (atual.lead_id) return res.status(200).json({ lead_id: atual.lead_id, ja_existia: true });

      const ca = Array.isArray(atual.wa_canal) ? atual.wa_canal[0] : atual.wa_canal;
      /* NEM TODO NÚMERO É CANAL COMERCIAL (0058). O administrativo
       * atende lojista, cartório e despachante: quem escreve ali não é
       * cliente querendo vender carro, e virar lead sujaria as duas
       * pontas do funil — infla o volume e derruba a conversão de um
       * número que nunca teve a intenção de converter.
       *
       * A recusa é aqui e não só na tela: esconder o botão é
       * conveniência, não controle. */
      if (ca && ca.comercial === false) {
        return res.status(409).json({ erro: `"${ca.nome}" não é canal comercial — conversa dele não vira lead.` });
      }
      /* A ORIGEM SAI DO CANAL, que é o que esta tela toda existe para
       * medir. Anúncio na primeira mensagem ganha do canal: ele diz de
       * onde a pessoa veio, enquanto o canal diz só por onde ela
       * entrou. O que não se sabe vira `outro` em vez de um palpite --
       * origem errada estraga o funil inteiro. */
      const DO_CANAL = { "prospeccao-ativa": "prospeccao", tv: "tv", loja: "fluxo_loja", "administrativo-da-loja": "fluxo_loja" };
      const c2 = (req.body && typeof req.body === "object") ? req.body : {};
      const origem = ORIGENS.indexOf(String(c2.origem || "")) >= 0 ? String(c2.origem)
        : atual.anuncio ? "facebook"
        : (DO_CANAL[(ca && ca.slug) || ""] || "outro");

      // O telefone entra como o lead guarda: sem o 55 do país, que é
      // coisa do WhatsApp (ver `chaveFone` no api/funil.js).
      const fone = String(atual.telefone || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
      const r = await banco(REST("lead"), {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({
          nome: String(c2.nome || atual.nome || "").trim() || fone,
          telefone: fone, origem, status: "novo",
          carro: String(c2.carro || "").trim() || null,
          observacoes: `Veio do WhatsApp${ca && ca.nome ? ` — ${ca.nome}` : ""}.`,
        }),
      });
      const lead = (Array.isArray(r) ? r[0] : r) || null;
      if (!lead) return res.status(403).json({ erro: "Não consegui criar o lead." });
      // Falhar aqui não perde o lead: ele existe, e o funil ainda o
      // alcança pelo telefone. Por isso o PATCH não derruba a resposta.
      try {
        await banco(`${REST_CV}?id=eq.${id}`, {
          method: "PATCH", headers: json(tok, { Prefer: "return=minimal" }),
          body: JSON.stringify({ lead_id: lead.id }),
        });
      } catch (e) {}
      return res.status(200).json({ lead_id: lead.id, lead });
    }

    // A conversa aberta: as mensagens, em ordem de relógio.
    if (RX_UUID.test(id)) {
      const msgs = await banco(
        `${URL_BASE}/rest/v1/wa_mensagem?select=*&conversa_id=eq.${id}&order=quando.asc&limit=500`,
        { headers: cabecalhos(tok) });
      return res.status(200).json({ mensagens: msgs || [] });
    }

    const canal = String(req.query.canal || "").replace(/[^\w-]/g, "");
    // `!inner` quando há filtro de canal: sem ele o PostgREST filtra só
    // o embutido e devolve TODAS as conversas, com `wa_canal` nulo nas
    // que não casam -- a lista viria errada parecendo certa.
    const emb = canal ? "wa_canal!inner(slug,nome,atendente,comercial)" : "wa_canal(slug,nome,atendente,comercial)";
    const partes = [
      `select=id,telefone,nome,ultima_em,primeira_em,ultima_de_fora,respondida_em,anuncio,atendimento_id,lead_id,${emb}`,
      "order=ultima_em.desc",
      `limit=${Math.min(200, Number(req.query.limite) || 60)}`,
    ];
    if (canal) partes.push(`wa_canal.slug=eq.${encodeURIComponent(canal)}`);
    const busca = String(req.query.busca || "").trim();
    if (busca) {
      // Vírgula e parêntese são sintaxe do `or=` do PostgREST: um nome
      // com vírgula quebraria a consulta inteira (mesma lição da
      // decisão 10).
      const b = busca.replace(/[(),]/g, " ");
      partes.push(`or=(nome.ilike.*${encodeURIComponent(b)}*,telefone.ilike.*${encodeURIComponent(b)}*)`);
    }
    const linhas = await banco(`${REST_CV}?${partes.join("&")}`, { headers: cabecalhos(tok) });

    /* A PRÉVIA VEM NUMA CONSULTA SÓ, não uma por conversa. O PostgREST
     * não sabe trazer "a última filha de cada mãe", então pegamos as
     * últimas mensagens DAS CONVERSAS DESTA PÁGINA e ficamos com a
     * primeira de cada -- elas já vêm em ordem decrescente de relógio. */
    const ids = (linhas || []).map((l) => l.id);
    const previa = {};
    if (ids.length) {
      const m = await banco(
        `${URL_BASE}/rest/v1/wa_mensagem?select=conversa_id,eco,tipo,texto,quando&conversa_id=in.(${ids.join(",")})&order=quando.desc&limit=${ids.length * 8}`,
        { headers: cabecalhos(tok) });
      for (const x of m || []) if (!previa[x.conversa_id]) previa[x.conversa_id] = x;
    }

    /* O ESTÁGIO VIAJA COM A CONVERSA.
     *
     * O Derek em 03/10/2026: *"não tem nenhum sinal de que a conversa
     * (que na verdade é LEAD) virou um agendamento pelo menos"*. Tem
     * razão nas duas pontas — a conversa **é** o lead, e a caixa de
     * entrada não mostrava nada do que aconteceu depois dela. Uma fila
     * que não diz o que já foi resolvido obriga a pessoa a abrir cada
     * uma para descobrir.
     *
     * O lead é alcançado pelo vínculo gravado e, quando não há, pelo
     * telefone — a mesma dupla do `api/funil.js`. São poucos leads e
     * uma página de conversas, então vêm numa consulta só em vez de
     * uma por linha.
     */
    const fones = {};
    const chave = (f) => {
      let d = String(f || "").replace(/\D/g, "");
      if (d.length > 11 && d.slice(0, 2) === "55") d = d.slice(2);
      return d.length < 10 ? null : d.slice(0, 2) + d.slice(-8);
    };
    let porId = {};
    try {
      const leads = await banco(
        `${URL_BASE}/rest/v1/lead?select=id,nome,telefone,status,agendado_para,atendimento_id&limit=1000`,
        { headers: cabecalhos(tok) }) || [];
      const ORDEM = { perdido: 0, novo: 1, em_contato: 2, nao_compareceu: 3, agendado: 4, confirmado: 5, compareceu: 6 };
      leads.forEach((l) => {
        porId[l.id] = l;
        const k = chave(l.telefone);
        if (!k) return;
        // O mais adiantado manda: a mesma pessoa pode ter voltado, e
        // mostrar o retorno como "não veio" apagaria a visita que houve.
        if (!fones[k] || (ORDEM[l.status] || 0) >= (ORDEM[fones[k].status] || 0)) fones[k] = l;
      });
    } catch (e) { porId = {}; }

    return res.status(200).json({
      conversas: (linhas || []).map((l) => {
        const { wa_canal, ...resto } = l;
        const lead = (l.lead_id && porId[l.lead_id]) || fones[chave(l.telefone)] || null;
        return {
          ...resto,
          canal: wa_canal || null,
          lead: lead ? { id: lead.id, status: lead.status, agendado_para: lead.agendado_para, atendimento_id: lead.atendimento_id } : null,
          // "Esperando resposta" é a pergunta de todo dia, e ela é
          // derivada aqui para a tela não repetir a regra.
          esperando: !!(l.ultima_de_fora && (!l.respondida_em || l.respondida_em < l.ultima_de_fora)),
          ultima: previa[l.id] || null,
        };
      }),
    });
  }

  /* A TELA DO QR, E POR QUE ELA NÃO USA O SEGREDO DA PONTE.
   *
   * Tudo no Worker da ponte exige o `PONTE_SEGREDO`, então o navegador
   * não alcança o QR sozinho -- e não deve: segredo que chega ao
   * navegador deixou de ser segredo (decisão 9). Quem fala com a ponte
   * é esta função, com o token do GERENTE na entrada e o segredo só na
   * saída. Ligar um número da loja é ato de gerente, não de equipe.
   */
  if (String(req.query.recurso || "") === "wa") {
    // No Cloudflare quem fala com a ponte é o BINDING (`req.ponte`),
    // porque fetch de Worker para Worker pelo endereço workers.dev não
    // chega. `PONTE_URL` fica como caminho de quem roda em servidor
    // comum, onde o endereço funciona.
    const base = process.env.PONTE_URL || "";
    const segredo = process.env.PONTE_SEGREDO || "";
    if ((!req.ponte && !base) || !segredo) {
      return res.status(503).json({ erro: "A ponte do WhatsApp não está configurada." });
    }
    // Pelo id DO TOKEN, nunca por `limit=1`: a RLS deixa o gerente ler
    // a equipe inteira, então a primeira linha pode ser de outra
    // pessoa -- e foi isso que recusou o próprio dono na primeira
    // abertura da tela.
    const meuId = donoDoToken(tok);
    if (!meuId) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });
    const eu = await banco(`${URL_BASE}/rest/v1/perfil?select=papel&id=eq.${meuId}`, { headers: cabecalhos(tok) });
    if (((eu || [])[0] || {}).papel !== "gerente") {
      return res.status(403).json({ erro: "Só o gerente liga e desliga os números." });
    }

    const canal = String(req.query.canal || "").replace(/[^\w-]/g, "").slice(0, 60);
    const REST_C = `${URL_BASE}/rest/v1/wa_canal`;

    /* O CADASTRO DOS NÚMEROS.
     *
     * Quem decide é a RLS da 0054 (`wa_canal_gere`, do gerente) -- a
     * conferência de papel aí em cima é a mesma de sempre: conveniência
     * para a mensagem sair legível, não controle.
     */
    if (req.method === "GET" && !canal) {
      // A contagem vem embutida: sem ela seria uma consulta por número
      // só para saber se dá para apagar.
      const canais = await banco(`${REST_C}?select=*,wa_conversa(count)&order=slug`, { headers: cabecalhos(tok) });
      return res.status(200).json({
        canais: (canais || []).map((c) => {
          const n = Array.isArray(c.wa_conversa) ? ((c.wa_conversa[0] || {}).count || 0) : 0;
          const { wa_conversa, ...resto } = c;
          return { ...resto, conversas: n };
        }),
      });
    }

    if (req.method === "POST" && !canal) {
      const c2 = (req.body && typeof req.body === "object") ? req.body : {};
      // O slug vira o nome do container e viaja na URL, então ele é
      // apertado de propósito -- e a mensagem diz a regra, em vez de
      // devolver o erro cru do check do banco.
      const slug = String(c2.slug || "").trim().toLowerCase();
      if (!/^[a-z0-9_-]{2,40}$/.test(slug)) {
        return res.status(400).json({ erro: "O apelido aceita letras minúsculas, números, hífen e _, de 2 a 40 caracteres." });
      }
      const nome = String(c2.nome || "").trim();
      if (!nome) return res.status(400).json({ erro: "Falta o nome do número." });
      const atendente = c2.atendente === "ia" ? "ia" : "humano";
      try {
        const r = await banco(REST_C, {
          method: "POST",
          headers: json(tok, { Prefer: "return=representation" }),
          body: JSON.stringify({ slug, nome, atendente }),
        });
        const linha = (Array.isArray(r) ? r[0] : r) || null;
        if (!linha) return res.status(403).json({ erro: "Só o gerente cadastra número." });
        return res.status(200).json({ canal: { ...linha, conversas: 0 } });
      } catch (e) {
        const t = String((e && e.message) || e);
        if (/duplicate key|already exists/i.test(t)) return res.status(409).json({ erro: `Já existe um número com o apelido "${slug}".` });
        throw e;
      }
    }

    if (!canal) return res.status(400).json({ erro: "faltou o canal" });

    if (req.method === "PATCH") {
      const c2 = (req.body && typeof req.body === "object") ? req.body : {};
      const mud = {};
      if (typeof c2.nome === "string" && c2.nome.trim()) mud.nome = c2.nome.trim();
      if (c2.atendente === "ia" || c2.atendente === "humano") mud.atendente = c2.atendente;
      if (typeof c2.ativo === "boolean") mud.ativo = c2.ativo;
      if (typeof c2.comercial === "boolean") mud.comercial = c2.comercial;
      if (!Object.keys(mud).length) return res.status(400).json({ erro: "nada para mudar" });
      const r = await banco(`${REST_C}?slug=eq.${encodeURIComponent(canal)}`, {
        method: "PATCH",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify(mud),
      });
      // Lista vazia é a RLS recusando, não "não achei" -- o PostgREST
      // responde 200 com nada (mesma tradução da decisão 10).
      const linha = (Array.isArray(r) ? r[0] : r) || null;
      if (!linha) return res.status(403).json({ erro: "Só o gerente muda número." });
      return res.status(200).json({ canal: linha });
    }

    if (req.method === "DELETE") {
      /* APAGAR LEVA A CONVERSA JUNTO. O `canal_id` da 0054 é
       * `on delete cascade`: apagar o número apaga toda a conversa e
       * toda a mensagem dele, e isso não se desfaz. Então só sai o
       * número que nunca recebeu nada -- apelido digitado errado. Para
       * o resto existe DESATIVAR, que é o que a loja quer dizer quando
       * diz "tira esse número": `wa_receber()` recusa canal inativo, e
       * o histórico fica de pé. */
      const tem = await banco(`${REST_C}?select=id,wa_conversa(count)&slug=eq.${encodeURIComponent(canal)}`, { headers: cabecalhos(tok) });
      const linha = (tem || [])[0];
      if (!linha) return res.status(404).json({ erro: "número não encontrado" });
      const n = Array.isArray(linha.wa_conversa) ? ((linha.wa_conversa[0] || {}).count || 0) : 0;
      if (n > 0) {
        return res.status(409).json({
          erro: `Este número já tem ${n} conversa${n > 1 ? "s" : ""} guardada${n > 1 ? "s" : ""}. Apagar levaria tudo junto — desative em vez de apagar.`,
        });
      }
      const r = await banco(`${REST_C}?slug=eq.${encodeURIComponent(canal)}`, {
        method: "DELETE",
        headers: json(tok, { Prefer: "return=representation" }),
      });
      if (!((Array.isArray(r) ? r[0] : r) || null)) return res.status(403).json({ erro: "Só o gerente apaga número." });
      return res.status(200).json({ ok: true });
    }

    const acao = String(req.query.acao || "estado");
    const CAMINHO = { estado: "/estado", reiniciar: "/_reiniciar", sair: "/sair" };
    if (!CAMINHO[acao]) return res.status(400).json({ erro: "ação desconhecida" });
    try {
      const alvo = `${base || "https://ponte.invalido"}${CAMINHO[acao]}?canal=${encodeURIComponent(canal)}`;
      const pedido = { method: acao === "estado" ? "GET" : "POST", headers: { "x-ponte-segredo": segredo } };
      const r = req.ponte ? await req.ponte.fetch(alvo, pedido) : await fetch(alvo, pedido);
      const d = await r.json().catch(() => ({}));
      // 503 é a ponte LIGANDO, não erro: o container leva uns segundos
      // na primeira pergunta, e a tela precisa saber esperar em vez de
      // dizer que falhou.
      return res.status(r.ok ? 200 : r.status === 503 ? 200 : r.status).json(d);
    } catch (e) {
      return res.status(502).json({ erro: "a ponte não respondeu" });
    }
  }

  try {
    if (String(req.query.recurso || "") === "tatica") {
    try { return await tatica(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: "Não consegui analisar." }); }
  }

  if (String(req.query.recurso || "") === "agenda") {
    try { return await agenda(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

  if (String(req.query.recurso || "") === "resumo") {
    try { return await resumo(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Não consegui resumir." }); }
  }

  if (String(req.query.recurso || "") === "escuta") {
    try { return await escuta(req, res, tok); }
    catch (e) { return res.status(500).json({ erro: limpar(e.message) }); }
  }

  if (String(req.query.recurso || "") === "viva") {
    try { return await viva(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

  if (String(req.query.recurso || "") === "voltas") {
    try { return await voltas(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

  if (String(req.query.recurso || "") === "revisao") {
    try { return await revisao(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

  if (String(req.query.recurso || "") === "mensagem") {
    try { return await mensagem(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

  if (String(req.query.recurso || "") === "lead") {
    try { return await leads(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: limpar(e.message) }); }
  }

  if (String(req.query.recurso || "") === "indicacoes") {
      return await indicacoes(req, res, tok);
    }

    if (req.method === "GET") {
      const id = String(req.query.id || "");
      if (id) {
        if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
        const r = await banco(`${REST("atendimento")}?select=${EMBUTIDO}&id=eq.${id}&limit=1`,
                              { headers: cabecalhos(tok) });
        const linha = Array.isArray(r) ? r[0] : null;
        if (!linha) return res.status(404).json({ erro: "Atendimento não encontrado." });
        return res.status(200).json({ atendimento: linha });
      }

      const f = [];
      const status = daLista(req.query.status, STATUS);
      const origem = daLista(req.query.origem, ORIGENS);
      const de = data(req.query.de);
      const ate = data(req.query.ate);
      const neg = String(req.query.negociador_id || "");
      // Pelo NOME, e não só pelo id, porque é o nome que existe: dos
      // 267 atendimentos, 4 têm negociador_id. O resto veio da planilha
      // do CRM, onde o negociador é texto — filtrar só por id deixaria
      // o filtro sem nada para achar. Os parênteses e a vírgula saem
      // pelo mesmo motivo do `q`: quebram a sintaxe do PostgREST.
      const negNome = String(req.query.negociador_nome || "").replace(/[(),*]/g, " ").trim();
      const q = String(req.query.q || "").trim();

      if (status) f.push(`status=eq.${status}`);
      if (origem) f.push(`origem=eq.${origem}`);
      if (de) f.push(`data=gte.${de}`);
      if (ate) f.push(`data=lte.${ate}`);
      if (RX_UUID.test(neg)) f.push(`negociador_id=eq.${neg}`);
      // `__sem__` é o "sem negociador" da tela. Sem ele, os 263 sem
      // dono ficariam invisíveis em qualquer filtro — e são justamente
      // os que precisam de alguém para reivindicá-los.
      if (negNome === "__sem__") f.push("negociador_nome=is.null");
      else if (negNome) f.push(`negociador_nome=ilike.${encodeURIComponent(negNome)}`);
      if (q) {
        // Vírgula e parêntese quebram a sintaxe do or= do PostgREST.
        const t = q.replace(/[(),*]/g, " ").trim();
        if (t) f.push(`or=(cliente_nome.ilike.*${t}*,carro_descricao.ilike.*${t}*,cliente_telefone.ilike.*${t}*)`);
      }

      const limite = Math.min(200, Math.max(1, Number(req.query.limite) || 100));
      const url = `${REST("atendimento")}?select=${EMBUTIDO}&order=data.desc,criado_em.desc&limit=${limite}` +
                  (f.length ? `&${f.join("&")}` : "");

      const lista = await banco(url, { headers: cabecalhos(tok) });
      return res.status(200).json({ atendimentos: lista || [] });
    }

    if (req.method === "POST") {
      const corpo = await lerCorpo(req);
      if (!corpo) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

      const linha = somenteEnviadas(paraColunas(corpo), corpo);
      // A chave estrangeira é para `perfil`; a tela oferece a lista de
      // `negociador`. Ver `idDePerfil`.
      if (linha.negociador_id !== undefined) {
        linha.negociador_id = await idDePerfil(tok, linha.negociador_id);
      }
      const r = await banco(REST("atendimento"), {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify(linha),
      });
      const salvo = Array.isArray(r) ? r[0] : r;
      return res.status(201).json({ ok: true, atendimento: salvo });
    }

    if (req.method === "PATCH") {
      const id = String(req.query.id || "");
      if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });

      const corpo = await lerCorpo(req);
      if (!corpo) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

      const linha = somenteEnviadas(paraColunas(corpo), corpo);
      if (linha.negociador_id !== undefined) {
        linha.negociador_id = await idDePerfil(tok, linha.negociador_id);
      }
      if (!Object.keys(linha).length) return res.status(400).json({ erro: "Nada para atualizar." });

      const r = await banco(`${REST("atendimento")}?id=eq.${id}`, {
        method: "PATCH",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify(linha),
      });
      const salvo = Array.isArray(r) ? r[0] : r;
      // A RLS deixa ler e recusa escrever: o PATCH volta vazio, sem erro.
      if (!salvo) return res.status(403).json({ erro: "Este atendimento é de outro negociador." });
      return res.status(200).json({ ok: true, atendimento: salvo });
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no atendimento." });
  }
};
