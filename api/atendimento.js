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
    const st = String(req.query.status || "");
    if (LEAD_STATUS.indexOf(st) >= 0) f.push(`status=eq.${st}`);
    // A agenda é o que tem hora marcada e ainda não foi resolvido; o
    // funil é o resto. Separar aqui evita a tela filtrar 500 linhas
    // para mostrar 8.
    if (fila === "agenda") f.push("status=in.(agendado,confirmado)");
    else if (fila === "funil" && !f.length) f.push("status=in.(novo,em_contato)");
    const de = data(req.query.de), ate = data(req.query.ate);
    if (de) f.push(`agendado_para=gte.${de}T00:00:00`);
    if (ate) f.push(`agendado_para=lte.${ate}T23:59:59`);
    const q = String(req.query.q || "").trim().replace(/[(),*]/g, " ").trim();
    if (q) f.push(`or=(nome.ilike.*${q}*,telefone.ilike.*${q}*,carro.ilike.*${q}*)`);
    const ordem = fila === "agenda" ? "agendado_para.asc" : "criado_em.desc";
    const url = `${base}?select=${CAMPOS_LEAD}&order=${ordem}&limit=300${f.length ? `&${f.join("&")}` : ""}`;
    const lista = await banco(url, { headers: cabecalhos(tok) });
    return res.status(200).json({ leads: lista || [] });
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
      negociador_id: RX_UUID.test(String(corpo.negociador_id || "")) ? corpo.negociador_id : null,
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
    const filtro = STATUS_INDICACAO.indexOf(st) >= 0 ? `&status=eq.${st}` : "";
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

    const r = await banco(`${REST_V}?on_conflict=atendimento_id`, {
      method: "POST",
      headers: json(tok, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(linha),
    });
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
      const r = await banco(`${REST_V}?select=*&atendimento_id=eq.${aid}`, { headers: cabecalhos(tok) });
      return res.status(200).json({ viva: (r || [])[0] || null });
    }

    // O painel: as negociações de hoje e de ontem. Mais que isso vira
    // arquivo, e o gestor quer o que está acontecendo.
    const dias = Math.min(30, Math.max(1, Number(req.query.dias) || 2));
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
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

  const de = data(req.query.de);
  const ate = data(req.query.ate);
  const filtro = [de ? `data=gte.${de}` : "", ate ? `data=lte.${ate}` : ""].filter(Boolean).join("&");
  const ats = await banco(
    `${REST("atendimento")}?select=id,cliente_nome,carro_descricao,status,negociador_nome,data,valor_fechado,` +
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

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  try {
    if (String(req.query.recurso || "") === "tatica") {
    try { return await tatica(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: "Não consegui analisar." }); }
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
