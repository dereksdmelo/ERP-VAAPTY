/**
 * /api/financeiro — a área restrita (0021)
 *
 *   ?recurso=conta         GET · POST · PATCH ?id=
 *   ?recurso=categoria     GET · POST · PATCH ?id=
 *   ?recurso=lancamento    GET ?competencia=&conta_id= · POST · PATCH ?id= · DELETE ?id=
 *   ?recurso=importar      POST { conta_id, linhas }   a aba Lançamentos colada
 *   ?recurso=dre           GET ?competencia=           por categoria + rentabilidade = lucro
 *   ?recurso=carros        GET ?competencia=           o estoque cruzado com os lançamentos
 *   ?recurso=funcionario   GET · POST · PATCH ?id=
 *   ?recurso=vale          GET ?competencia= · POST · PATCH ?id=
 *   ?recurso=folha         GET ?competencia= · PUT     salário + comissão + bonificação − vales
 *   ?recurso=pendencias    GET                         tudo que pede ação, num lugar só (0066)
 *   ?recurso=saldos        GET                         o saldo de hoje de cada conta (0070)
 *   ?recurso=lancamento&acao=transferir  POST { de, para, valor, data }   duas linhas, Transferência
 *   ?recurso=ano           GET ?ano=                  os doze meses do fechamento lado a lado
 *   ?recurso=recebimentos  GET ?competencia= · POST ?acao=automatico|casar|explicar · DELETE ?id=   (0067)
 *
 * Quem decide o acesso é a RLS (e_financeiro): esta função só repassa
 * o token. Para quem não é do financeiro, o banco devolve lista vazia
 * e recusa escrita — e a tela nem mostra o destino, porque /api/perfil
 * entrega o sinalizador `financeiro`.
 *
 * Esta é a 12ª função. A vaga veio do api/config.js, que virou
 * ?recurso=config em api/perfil.js.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};
const cab = (tok, extra) => ({ apikey: ANON, Authorization: tok, "Content-Type": "application/json", ...extra });
const REP = { Prefer: "return=representation" };
const base = (t) => `${URL_BASE}/rest/v1/${t}`;
const RX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v) => { const s = String(v == null ? "" : v).trim(); return s === "" ? null : s; };
const decimal = (v) => {
  let s = String(v == null ? "" : v).trim().replace(/^R\$\s*/, "");
  if (s === "" || s === "-") return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
// dd/mm/aaaa, aaaa-mm-dd, ou o serial do Excel (45293 = 02/01/2024).
const dataISO = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
};
const hojeAqui = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const competenciaDe = (v) => { const d = dataISO(v); return d ? `${d.slice(0, 8)}01` : null; };
const fimDoMes = (comp) => {
  const [a, m] = comp.split("-").map(Number);
  const u = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${comp.slice(0, 8)}${String(u).padStart(2, "0")}`;
};

async function supa(url, opcoes) {
  let r;
  try { r = await fetch(url, opcoes); }
  catch (e) { const erro = new Error("Não consegui falar com o banco."); erro.status = 502; throw erro; }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    let msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a operação.";
    /* **Erro de banco não é mensagem para gente** (decisão 46). Até
     * 30/09/2026 a tela do financeiro mostrava, em laranja e sem mais
     * nada, "duplicate key value violates unique constraint
     * fin_favorecido_nome" -- verdadeiro, inútil, e sem dizer o que
     * fazer. Quem lê isso não sabe se perdeu o arquivo, se pode tentar
     * de novo, nem o que quebrou. */
    const uni = /duplicate key value violates unique constraint "?([a-z_]+)"?/i.exec(String(msg));
    if (uni) {
      const ONDE = {
        fin_favorecido_nome: "já existe um fornecedor com esse nome",
        fin_favorecido_doc: "já existe um fornecedor com esse CNPJ/CPF",
        fin_lancamento_chave: "esse movimento do banco já foi importado",
        fin_orcamento_cat: "essa categoria já foi orçada neste mês",
        fin_recibo_numero: "esse número de recibo já existe",
      };
      msg = (ONDE[uni[1]] || `um registro repetido barrou a gravação (${uni[1]})`) +
        ". Nada foi gravado nesta chamada; o que já entrou antes continua lá.";
    }
    const erro = new Error(String(msg));
    erro.status = r.status === 401 ? 401 : 502;
    throw erro;
  }
  return dado;
}
async function corpoDe(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : null;
}
const um = (r) => (Array.isArray(r) ? r[0] : r) || null;
const recusado = (res, msg) => res.status(403).json({ erro: msg || "Sem acesso ao financeiro." });

/* ------------------ cadastros simples ------------------ */

function cadastro(tabela, campos, ordem) {
  return async function (req, res, tok) {
    if (req.method === "GET") {
      const lista = await supa(`${base(tabela)}?select=*&order=${ordem}`, { headers: cab(tok) });
      return res.status(200).json({ lista: lista || [] });
    }
    if (req.method === "POST" || req.method === "PATCH") {
      const c = await corpoDe(req);
      if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
      const linha = {};
      campos.forEach(([k, conv]) => { if (c[k] !== undefined) linha[k] = conv(c[k]); });
      if (!Object.keys(linha).length) return res.status(400).json({ erro: "Nada para gravar." });
      if (req.method === "POST") {
        const r = await supa(base(tabela), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(linha) });
        if (!um(r)) return recusado(res);
        return res.status(201).json({ ok: true, item: um(r) });
      }
      const id = String(req.query.id || "");
      if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
      const r = await supa(`${base(tabela)}?id=eq.${id}`, { method: "PATCH", headers: cab(tok, REP), body: JSON.stringify(linha) });
      if (!um(r)) return recusado(res);
      return res.status(200).json({ ok: true, item: um(r) });
    }
    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
  };
}

const bool = (v) => !!v;
const inteiro = (v) => Math.trunc(Number(v) || 0);
const GRUPOS = ["despesa", "receita", "negociacao", "retirada", "transferencia", "saldo"];
const grupo = (v) => (GRUPOS.indexOf(String(v)) >= 0 ? String(v) : "despesa");
const idOuNulo = (v) => (RX_ID.test(String(v || "")) ? String(v) : null);

/**
 * O CNPJ ou CPF que o extrato do Itaú já traz na descrição.
 *
 * "PIX ENVIADO BARBOSA CONSULTORIA LTDA 62.762.461/0001-59" carrega o
 * documento de graça. É a chave certa para o cadastro de favorecidos:
 * o nome vem escrito de um jeito no extrato e de outro no contrato, o
 * documento não muda.
 */
const docNa = (desc) => {
  const t = String(desc || "");
  const cnpj = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/.exec(t);
  if (cnpj) return cnpj[1].replace(/\D/g, "");
  const cpf = /(\d{3}\.\d{3}\.\d{3}-\d{2})/.exec(t);
  return cpf ? cpf[1].replace(/\D/g, "") : null;
};
// O nome, sem o verbo do banco e sem o documento.
const nomeNa = (desc) => {
  const t = String(desc || "")
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, "")
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, "")
    .replace(/^\s*(PIX\s+(ENVIADO|RECEBIDO)|TED\s*(RECEBIDA|ENVIADA)?|DOC|TRANSFERENCIA|TRANSFER[ÊE]NCIA|PAGAMENTO)\s*/i, "")
    .replace(/\d{2}\/\d{2}/g, "")
    .replace(/\s+/g, " ").trim();
  return t.length >= 3 ? t.slice(0, 120) : null;
};
const documento = (v) => { const d = String(v || "").replace(/\D/g, ""); return d ? d : null; };

const favorecido = cadastro("fin_favorecido",
  [["nome", texto], ["documento", documento], ["tipo", texto], ["observacao", texto], ["ativo", bool]],
  "nome.asc");

// `tipo` e `descricao` (0070): a caixinha da gaveta e o caixa da casa
// do Derek são contas como o Itaú, só que sem extrato.
const tipoConta = (v) => (String(v) === "dinheiro" ? "dinheiro" : "banco");
const conta = cadastro("fin_conta",
  [["nome", texto], ["banco", texto], ["empresa", texto], ["saldo_inicial", (v) => decimal(v) || 0],
   ["saldo_inicial_em", dataISO], ["ativa", bool], ["tipo", tipoConta], ["descricao", texto]], "nome.asc");
const TIPOS_CUSTO = ["receita", "variavel", "fixa", "fora"];
const tipoCusto = (v) => (TIPOS_CUSTO.indexOf(String(v)) >= 0 ? String(v) : "fixa");
const categoria = cadastro("fin_categoria",
  [["nome", texto], ["grupo", grupo], ["no_dre", bool], ["ordem", inteiro], ["ativa", bool],
   ["pede_funcionario", bool], ["tipo_custo", tipoCusto]], "ordem.asc,nome.asc");
const funcionario = cadastro("fin_funcionario",
  [["nome", texto], ["salario_base", (v) => decimal(v) || 0], ["negociador_id", idOuNulo], ["ativo", bool]], "nome.asc");

/* ------------------ lançamentos ------------------ */

const TIPOS_NEG = ["pagto_cliente", "quitacao", "debitos", "pagto_lojista", "reembolso", "outro"];
const SITUACOES = ["aberto", "efetivado", "cancelado"];
const CAMPOS_LANC = "*,fin_categoria(id,nome,grupo,no_dre,pede_funcionario)," +
  "fin_conta(id,nome,empresa),fin_favorecido(id,nome,documento),estoque(id,veiculo(placa,marca_modelo)),fin_funcionario(id,nome)," +
  "fin_rateio(id,valor,categoria_id,estoque_id,tipo_negociacao,funcionario_id,descricao)";

/**
 * Como um lançamento se reparte, para quem soma.
 *
 * Sem rateio, ele é uma parte só: a categoria do cabeçalho. Com
 * rateio, são as linhas do rateio MAIS o que sobrou, que continua na
 * categoria do cabeçalho — dinheiro rateado pela metade não pode
 * sumir da soma.
 *
 * O sinal vem do lançamento (débito ou crédito, nunca os dois) e vale
 * para todas as partes; por isso `fin_rateio.valor` é sempre positivo.
 */
function partesDe(l) {
  const cred = Number(l.credito) || 0, deb = Number(l.debito) || 0;
  const sinal = cred > 0 ? 1 : -1;
  const total = cred + deb;
  const rateios = Array.isArray(l.fin_rateio) ? l.fin_rateio : [];
  const partes = rateios.map((r) => ({
    valor: sinal * (Number(r.valor) || 0),
    categoria_id: r.categoria_id, estoque_id: r.estoque_id,
    tipo_negociacao: r.tipo_negociacao, funcionario_id: r.funcionario_id,
  }));
  const usado = rateios.reduce((t, r) => t + (Number(r.valor) || 0), 0);
  const sobra = Math.round((total - usado) * 100) / 100;
  if (!rateios.length || sobra > 0) {
    partes.push({
      valor: sinal * (rateios.length ? sobra : total),
      categoria_id: l.categoria_id, estoque_id: l.estoque_id,
      tipo_negociacao: l.tipo_negociacao, funcionario_id: l.funcionario_id,
    });
  }
  return partes;
}

// "Pagto cliente Uno_AYL0614" → a placa e a parte do negócio. É a
// convenção da planilha; quem escrever descrição de outro jeito só
// perde o vínculo automático, que dá para fazer à mão.
const placaNa = (desc) => {
  const m = /([A-Z]{3})[-_ ]?([0-9][A-Z0-9][0-9]{2})\b/i.exec(String(desc || "").toUpperCase());
  return m ? (m[1] + m[2]).toUpperCase() : null;
};
// "Pagto cliente Uno_AYL0614 (2ª parte)" → "pagto cliente uno": sem
// placa, sem número, sem parêntese. É a chave da memória de categoria.
const normDesc = (d) => String(d || "").toLowerCase()
  .replace(/[a-z]{3}[-_ ]?[0-9][a-z0-9][0-9]{2}\b/g, "").replace(/\(.*?\)/g, "")
  .replace(/[\d.,/]+/g, "").replace(/[^a-zà-ú ]/g, " ").replace(/\s+/g, " ").trim();
const tipoNegNa = (desc) => {
  const d = String(desc || "").toLowerCase();
  if (/reembolso/.test(d)) return "reembolso";
  if (/quita/.test(d)) return "quitacao";
  if (/d[eé]bito|ipva|multa|licenc/.test(d)) return "debitos";
  if (/lojista/.test(d)) return "pagto_lojista";
  if (/cliente/.test(d)) return "pagto_cliente";
  return null;
};

function linhaLancamento(c, tok) {
  const l = {};
  if (c.conta_id !== undefined) l.conta_id = idOuNulo(c.conta_id);
  if (c.data !== undefined) l.data = dataISO(c.data);
  if (c.competencia !== undefined) l.competencia = competenciaDe(c.competencia);
  if (c.categoria_id !== undefined) l.categoria_id = idOuNulo(c.categoria_id);
  if (c.descricao !== undefined) l.descricao = texto(c.descricao);
  if (c.debito !== undefined) l.debito = Math.abs(decimal(c.debito) || 0);
  if (c.credito !== undefined) l.credito = Math.abs(decimal(c.credito) || 0);
  if (c.estoque_id !== undefined) l.estoque_id = idOuNulo(c.estoque_id);
  if (c.tipo_negociacao !== undefined) l.tipo_negociacao = TIPOS_NEG.indexOf(String(c.tipo_negociacao)) >= 0 ? c.tipo_negociacao : null;
  if (c.funcionario_id !== undefined) l.funcionario_id = idOuNulo(c.funcionario_id);
  if (c.conciliado !== undefined) l.conciliado = !!c.conciliado;
  if (c.situacao !== undefined && SITUACOES.indexOf(String(c.situacao)) >= 0) l.situacao = c.situacao;
  if (c.vencimento !== undefined) l.vencimento = dataISO(c.vencimento);
  if (c.favorecido !== undefined) l.favorecido = texto(c.favorecido);
  if (c.observacao !== undefined) l.observacao = texto(c.observacao);
  if (c.revisar !== undefined) l.revisar = !!c.revisar;
  if (c.favorecido_id !== undefined) l.favorecido_id = idOuNulo(c.favorecido_id);
  return l;
}

async function lancamento(req, res, tok) {
  if (req.method === "GET") {
    const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
    const conta = idOuNulo(req.query.conta_id);
    // Por data do movimento (o extrato), não por competência: é assim
    // que se confere contra o banco. A competência é filtro à parte.
    const porData = String(req.query.por || "") !== "competencia";
    const f = porData
      ? `&data=gte.${comp}&data=lte.${fimDoMes(comp)}`
      : `&competencia=eq.${comp}`;
    // Só o que passou no banco: título em aberto tem tela própria, e
    // misturado aqui viraria saldo que o banco não tem.
    const lista = await supa(
      `${base("fin_lancamento")}?select=${CAMPOS_LANC}&situacao=eq.efetivado${conta ? `&conta_id=eq.${conta}` : ""}${f}&order=data.asc,criado_em.asc&limit=2000`,
      { headers: cab(tok) });
    /* O saldo que entra no mês: o saldo de ABERTURA da conta mais o que
     * se moveu entre a abertura e o começo do mês.
     *
     * A abertura é digitada pelo financeiro (15/10/2026: "quer começar
     * do valor que começou o mês"). `saldo_inicial` é o saldo no COMEÇO
     * do dia `saldo_inicial_em`, e o que veio antes dele não entra na
     * conta — é histórico importado que nunca foi conferido, e foi ele
     * que deixou o saldo de outubro em −27 mil com o banco positivo.
     * Mês anterior à abertura não tem saldo: `saldo_anterior` vai nulo e
     * a tela diz por quê. */
    let saldoAnterior = null, abertura = null;
    if (conta && porData) {
      const ct = um(await supa(`${base("fin_conta")}?select=saldo_inicial,saldo_inicial_em&id=eq.${conta}`, { headers: cab(tok) }));
      const inicio = ct && ct.saldo_inicial_em ? String(ct.saldo_inicial_em).slice(0, 10) : null;
      abertura = { data: inicio, valor: ct ? Number(ct.saldo_inicial) || 0 : 0 };
      if (!inicio || comp >= inicio) {
        const antes = await supa(`${base("fin_lancamento")}?select=debito,credito&situacao=eq.efetivado&conta_id=eq.${conta}` +
          `${inicio ? `&data=gte.${inicio}` : ""}&data=lt.${comp}&limit=100000`, { headers: cab(tok) });
        saldoAnterior = abertura.valor +
          (antes || []).reduce((t, x) => t + (Number(x.credito) || 0) - (Number(x.debito) || 0), 0);
      }
    }
    // Sugestão de categoria para o que está sem: a categoria mais usada
    // nas descrições iguais (sem números, sem placa). É o que o BPO
    // faria de cabeça — "Facebook" é sempre MKT — só que sem digitar.
    const semCat = (lista || []).filter((l) => !l.categoria_id);
    const sugestoes = {};
    if (semCat.length) {
      const hist = await supa(`${base("fin_lancamento")}?select=descricao,categoria_id&categoria_id=not.is.null&order=criado_em.desc&limit=5000`, { headers: cab(tok) });
      const conta = {};
      (hist || []).forEach((h) => {
        const k = normDesc(h.descricao); if (!k) return;
        conta[k] = conta[k] || {}; conta[k][h.categoria_id] = (conta[k][h.categoria_id] || 0) + 1;
      });
      semCat.forEach((l) => {
        const k = normDesc(l.descricao); const c = conta[k]; if (!c) return;
        sugestoes[l.id] = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
      });
    }
    return res.status(200).json({ competencia: comp, lancamentos: lista || [], saldo_anterior: saldoAnterior, abertura, sugestoes, truncado: (lista || []).length >= 2000 });
  }
  if (req.method === "POST") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const l = linhaLancamento(c, tok);
    const aberto = l.situacao === "aberto";
    // Título em aberto ainda não tem banco; a data provisória é o
    // vencimento, e a real chega quando o extrato o efetivar.
    if (aberto) {
      if (!l.vencimento) return res.status(400).json({ erro: "Informe o vencimento." });
      if (!l.data) l.data = l.vencimento;
    } else if (!l.conta_id) {
      return res.status(400).json({ erro: "Escolha a conta." });
    }
    if (!l.data) return res.status(400).json({ erro: "Informe a data." });
    if (!l.competencia) l.competencia = competenciaDe(l.data);
    if (!(l.debito > 0) && !(l.credito > 0)) return res.status(400).json({ erro: "Informe débito ou crédito." });
    if (l.debito > 0 && l.credito > 0) return res.status(400).json({ erro: "Um lançamento é débito ou crédito, não os dois." });
    l.origem = "manual";
    const r = await supa(base("fin_lancamento"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(l) });
    if (!um(r)) return recusado(res);
    return res.status(201).json({ ok: true, lancamento: um(r) });
  }
  /* TRANSFERÊNCIA ENTRE CONTAS (0070). O dinheiro da caixinha sai de um
   * saque no banco; sem isto seriam dois lançamentos digitados à mão, e
   * o segundo é o que ninguém lembra. São duas linhas — sai de uma conta,
   * entra na outra — na categoria Transferência (fora do DRE: mudar
   * dinheiro de lugar não é receita nem despesa), amarradas pelo
   * `grupo_id`.
   *
   * Quando o extrato do banco trouxer o saque, a segunda rede da
   * importação (decisão 29: mesma conta, data e valor) o reconhece como
   * já lançado e não duplica. */
  if (req.method === "POST" && String(req.query.acao || "") === "transferir") {
    const c = await corpoDe(req) || {};
    const de = idOuNulo(c.de), para = idOuNulo(c.para);
    const valor = Math.abs(decimal(c.valor) || 0);
    const data = dataISO(c.data) || hojeAqui();
    if (!de || !para) return res.status(400).json({ erro: "Escolha a conta de onde sai e para onde vai." });
    if (de === para) return res.status(400).json({ erro: "As duas contas são a mesma." });
    if (!(valor > 0)) return res.status(400).json({ erro: "Informe o valor." });
    const [cats, cts] = await Promise.all([
      supa(`${base("fin_categoria")}?select=id&grupo=eq.transferencia&order=ordem&limit=1`, { headers: cab(tok) }),
      supa(`${base("fin_conta")}?select=id,nome&id=in.(${de},${para})`, { headers: cab(tok) }),
    ]);
    const nomeDe = ((cts || []).find((x) => x.id === de) || {}).nome || "outra conta";
    const nomePara = ((cts || []).find((x) => x.id === para) || {}).nome || "outra conta";
    const catId = (um(cats) || {}).id || null;
    const obs = texto(c.descricao);
    const grupo = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : null;
    const linha = (contaId, deb, cred, desc) => ({
      conta_id: contaId, data, competencia: competenciaDe(data), categoria_id: catId,
      descricao: desc, debito: deb, credito: cred, situacao: "efetivado", conciliado: true,
      origem: "manual", observacao: obs, grupo_id: grupo,
    });
    const r = await supa(base("fin_lancamento"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify([
      linha(de, valor, 0, `Transferência para ${nomePara}`),
      linha(para, 0, valor, `Transferência de ${nomeDe}`),
    ]) });
    if ((r || []).length !== 2) return recusado(res);
    return res.status(201).json({ ok: true });
  }

  if (req.method === "PATCH" && String(req.query.acao || "") === "lote") {
    // Vários de uma vez: aplicar sugestões de categoria, conciliar o mês.
    const c = await corpoDe(req);
    const itens = c && Array.isArray(c.itens) ? c.itens.slice(0, 500) : [];
    if (!itens.length) return res.status(400).json({ erro: "Nada para atualizar." });
    let ok = 0;
    for (const it of itens) {
      if (!RX_ID.test(String(it.id || ""))) continue;
      const l = linhaLancamento(it, tok); delete l.conta_id;
      if (!Object.keys(l).length) continue;
      const r = await supa(`${base("fin_lancamento")}?id=eq.${it.id}`, { method: "PATCH", headers: cab(tok, REP), body: JSON.stringify(l) });
      if (um(r)) ok += 1;
    }
    return res.status(200).json({ ok: true, atualizados: ok });
  }
  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const l = linhaLancamento(c, tok);
    if (!Object.keys(l).length) return res.status(400).json({ erro: "Nada para atualizar." });
    const r = await supa(`${base("fin_lancamento")}?id=eq.${id}`, { method: "PATCH", headers: cab(tok, REP), body: JSON.stringify(l) });
    if (!um(r)) return recusado(res);
    return res.status(200).json({ ok: true, lancamento: um(r) });
  }
  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const r = await supa(`${base("fin_lancamento")}?id=eq.${id}`, { method: "DELETE", headers: cab(tok, REP) });
    if (!um(r)) return recusado(res);
    return res.status(200).json({ ok: true });
  }
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
}

/**
 * A aba Lançamentos colada: Data | Competência | Tipo pgt | Descrição |
 * Débito | Crédito. Categoria que não existe é criada como despesa;
 * "Saldo" vira o saldo inicial da conta, não lançamento. A chave
 * data+descrição+valor impede o mesmo movimento entrar duas vezes —
 * colar o mês de novo só acrescenta o que faltava.
 */
async function importar(req, res, tok) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
  const c = await corpoDe(req);
  if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
  const contaId = idOuNulo(c.conta_id);
  if (!contaId) return res.status(400).json({ erro: "Escolha a conta." });
  const linhas = Array.isArray(c.linhas) ? c.linhas : [];
  if (!linhas.length) return res.status(400).json({ erro: "Nenhuma linha." });
  if (linhas.length > 1500) return res.status(400).json({ erro: "Cole no máximo 1.500 linhas por vez." });
  // `conferir` não grava nada: diz o que entraria e o que já existe.
  const soConferir = String(req.query.acao || "") === "conferir";

  const cats = await supa(`${base("fin_categoria")}?select=id,nome,grupo`, { headers: cab(tok) });
  const catPor = {};
  (cats || []).forEach((x) => { catPor[x.nome.toLowerCase()] = x; });
  const nomesNovos = Array.from(new Set(linhas.map((l) => texto(l.categoria)).filter((n) => n && !catPor[n.toLowerCase()])));
  if (nomesNovos.length) {
    const criadas = await supa(base("fin_categoria"), {
      method: "POST", headers: cab(tok, REP),
      body: JSON.stringify(nomesNovos.map((n) => ({ nome: n, grupo: "despesa", no_dre: true, ordem: 50 }))),
    });
    (criadas || []).forEach((x) => { catPor[x.nome.toLowerCase()] = x; });
  }

  // as placas, para ligar ao estoque
  const placas = Array.from(new Set(linhas.map((l) => placaNa(l.descricao)).filter(Boolean)));
  const estoquePorPlaca = {};
  if (placas.length) {
    const est = await supa(`${base("estoque")}?select=id,veiculo!inner(placa)&veiculo.placa=in.(${placas.join(",")})`, { headers: cab(tok) });
    (est || []).forEach((e) => { const p = e.veiculo && e.veiculo.placa; if (p && !estoquePorPlaca[p]) estoquePorPlaca[p] = e.id; });
  }

  // Memória de categoria para o que vier sem "Tipo pgt".
  const hist = await supa(`${base("fin_lancamento")}?select=descricao,categoria_id&categoria_id=not.is.null&order=criado_em.desc&limit=5000`, { headers: cab(tok) });
  const memoria = {};
  (hist || []).forEach((h) => { const k = normDesc(h.descricao); if (k && !memoria[k]) memoria[k] = h.categoria_id; });

  // Os títulos em aberto, para o casamento automático. Só valor e
  // vencimento — nome de favorecido no extrato do banco raramente bate
  // com o que se digitou, e casar por nome erraria mais que acertaria.
  const abertos = await supa(
    `${base("fin_lancamento")}?select=id,debito,credito,vencimento,descricao,favorecido,conta_id&situacao=eq.aberto&limit=2000`,
    { headers: cab(tok) });
  const casados = [];
  const usados = {};
  const diasEntre = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
  // Uma janela de sete dias: boleto pago no dia seguinte ao vencimento
  // é a regra, não a exceção. Mais que isso começa a casar coisa
  // diferente que por acaso tem o mesmo valor.
  const casar = (data, deb, cred) => {
    const cand = (abertos || []).filter((t) =>
      !usados[t.id] &&
      // Título marcado para sair de OUTRA conta (a caixinha, por
      // exemplo) não é pago por este extrato, por mais que o valor bata.
      (!t.conta_id || t.conta_id === contaId) &&
      Math.abs((Number(t.debito) || 0) - deb) < 0.005 &&
      Math.abs((Number(t.credito) || 0) - cred) < 0.005 &&
      t.vencimento && diasEntre(t.vencimento, data) <= 7);
    // Dois títulos do mesmo valor na mesma semana: não dá para saber
    // qual é, e chutar é pior que deixar para a pessoa.
    return cand.length === 1 ? cand[0] : null;
  };

  // Favorecidos: o documento na descrição é a chave. Quem ainda não
  // existe é criado com o nome que o banco escreveu — e o BPO corrige
  // o nome depois, uma vez, para todos os lançamentos daquele CNPJ.
  const docs = {};
  linhas.forEach((l) => {
    const d = docNa(l.descricao);
    if (d && !docs[d]) docs[d] = nomeNa(l.descricao) || d;
  });
  const listaDocs = Object.keys(docs);
  const favPor = {};
  if (listaDocs.length) {
    const jaTem = await supa(`${base("fin_favorecido")}?select=id,documento&documento=in.(${listaDocs.join(",")})`, { headers: cab(tok) });
    (jaTem || []).forEach((f) => { favPor[f.documento] = f.id; });
    const faltam = listaDocs.filter((d) => !favPor[d]);
    /* **São DOIS índices únicos, não um.** Além do documento, a 0026
     * tem `fin_favorecido_nome` em `lower(nome)` -- e esse não é
     * parcial: vale sempre. Conferir só o documento deixava o insert
     * estourar no nome e derrubar a importação INTEIRA, com o erro cru
     * do Postgres na cara de quem estava importando
     * ("duplicate key value violates unique constraint").
     *
     * Acontece porque o extrato do Itaú TRUNCA o nome
     * ("DEPARTAMENTO DE TRANSITO DE"), então CNPJs diferentes chegam
     * com o mesmo nome. Num extrato de nove meses isso é certeza, não
     * azar -- foi assim com os 3.757 movimentos de 30/09/2026.
     *
     * O documento continua sendo a chave (decisão 28): quando o nome
     * já está tomado por OUTRO documento, quem cede é o nome, que
     * ganha o documento junto para virar único. Perder o CNPJ novo
     * seria perder a única coisa que não muda de grafia. */
    /* Lê o cadastro INTEIRO e compara em memória, de propósito. O
     * índice é `lower(nome)` mas a COLUNA guarda o original: procurar
     * por `nome=in.("departamento de transito de")` nunca acha
     * "DEPARTAMENTO DE TRANSITO DE", e foi assim que a primeira versão
     * deste conserto continuou quebrando. PostgREST não tem `in`
     * que ignore maiúscula, e montar um `or=(nome.ilike...)` com
     * centenas de nomes vindos do extrato é pedir para escapar errado
     * um nome com vírgula ou parêntese.
     *
     * O cadastro de fornecedores de uma loja tem centenas de linhas,
     * não milhões -- uma leitura inteira numa importação sai barata. */
    const tomados = {};
    if (faltam.length) {
      const todos = await supa(`${base("fin_favorecido")}?select=id,nome,documento&limit=10000`, { headers: cab(tok) });
      (todos || []).forEach((f) => { tomados[String(f.nome || "").trim().toLowerCase()] = f; });
    }
    const novos = [];
    faltam.forEach((d) => {
      const base_ = String(docs[d] || d).trim();
      const chave = base_.toLowerCase();
      const dono = tomados[chave];
      // Mesmo nome E mesmo documento seria o caso já resolvido acima;
      // aqui o nome bate e o documento não, então desambigua.
      if (dono && !dono.documento) { favPor[d] = dono.id; return; }   // cadastro sem CNPJ: aproveita
      const nome = dono ? `${base_} (${d})` : base_;
      tomados[nome.trim().toLowerCase()] = { nome, documento: d };     // segura o nome contra o resto DO LOTE
      novos.push({ nome, documento: d });
    });
    if (novos.length) {
      // Sem `on_conflict`: o índice de documento é PARCIAL (só onde o
      // documento não é nulo), e o Postgres não infere índice parcial
      // num ON CONFLICT — devolve "no unique or exclusion constraint
      // matching". As duas consultas acima já tiraram os repetidos.
      const criados = await supa(base("fin_favorecido"), {
        method: "POST", headers: cab(tok, REP), body: JSON.stringify(novos),
      });
      (criados || []).forEach((f) => { favPor[f.documento] = f.id; });
    }
  }

  // ---- a rede contra duplicidade ----
  //
  // A chave única (conta + chave_extrato) já barra o MESMO arquivo
  // importado duas vezes. Ela não barra o mesmo movimento vindo por
  // caminhos diferentes: a planilha monta a chave com a descrição, o
  // OFX com o identificador do banco — formatos distintos para o mesmo
  // PIX. E não barra o Itaú reemitindo FITID diferente para o mesmo
  // período, que alguns bancos fazem.
  //
  // Por isso a segunda rede: conta quantos movimentos com aquela DATA e
  // aquele VALOR já existem na conta, e só deixa entrar o excedente.
  // É contagem, não presença — dois PIX de R$ 100 no mesmo dia são dois
  // movimentos de verdade, e barrar o segundo apagaria dinheiro.
  const datas = linhas.map((l) => dataISO(l.data)).filter(Boolean).sort();
  const jaLa = {};
  if (datas.length) {
    const antigos = await supa(
      `${base("fin_lancamento")}?select=data,debito,credito&situacao=eq.efetivado&conta_id=eq.${contaId}` +
      `&data=gte.${datas[0]}&data=lte.${datas[datas.length - 1]}&limit=20000`, { headers: cab(tok) });
    (antigos || []).forEach((x) => {
      const k = `${x.data}|${Number(x.debito) || 0}|${Number(x.credito) || 0}`;
      jaLa[k] = (jaLa[k] || 0) + 1;
    });
  }
  let repetidosData = 0;

  let saldoInicial = null, saldoEm = null, invalidas = 0;
  const corpo = [];
  linhas.forEach((l) => {
    const data = dataISO(l.data);
    const deb = Math.abs(decimal(l.debito) || 0), cred = Math.abs(decimal(l.credito) || 0);
    const catNome = texto(l.categoria);
    if (/^saldo/i.test(catNome || "") || /saldo anterior/i.test(String(l.descricao || ""))) {
      /* O "Saldo anterior" do banco é o saldo no FIM do dia em que ele
       * vem datado; a abertura da conta é o saldo no COMEÇO do dia
       * (decisão 58). Gravar a mesma data contaria duas vezes o que se
       * moveu nela — foi o que tirou R$ 10 mil da abertura de outubro. */
      saldoInicial = cred - deb; saldoEm = data ? somaDias(data, 1) : null; return;
    }
    /* O SALDO DO DIA NÃO É MOVIMENTO. O Itaú imprime "SALDO TOTAL
     * DISPONÍVEL DIA" ao fim de cada dia, com o saldo no campo de
     * crédito — e só "saldo anterior" era reconhecido acima. Foram 194
     * linhas e R$ 29,5 milhões de crédito que nunca entrou, marcados
     * como `cancelado` pela 0067. Não é saldo inicial também: é o
     * fim de um dia no meio do arquivo. */
    if (/^saldo (total|do dia|dispon)/i.test(String(l.descricao || "").trim())) return;
    if (!data || (!deb && !cred) || (deb && cred)) { invalidas += 1; return; }
    const cat = catNome ? catPor[catNome.toLowerCase()] : null;
    const catId = cat ? cat.id : (memoria[normDesc(l.descricao)] || null);
    const placa = placaNa(l.descricao);
    // No OFX o banco dá um identificador por movimento (FITID). É a
    // chave mais confiável que existe: dois PIX iguais no mesmo dia
    // têm FITIDs diferentes e entram os dois; o mesmo arquivo colado
    // duas vezes não duplica nada. O Itaú às vezes repete FITID em
    // lançamentos distintos, então a data e o valor entram junto.
    const fitid = texto(l.fitid);
    const chave = fitid
      ? `ofx:${fitid}|${data}|${deb}|${cred}`
      : `${data}|${String(l.descricao || "").trim().toLowerCase()}|${deb}|${cred}`;

    // Este movimento já está no sistema, por qualquer caminho? Consome
    // uma das ocorrências e sai fora.
    const kData = `${data}|${deb}|${cred}`;
    if (jaLa[kData] > 0) { jaLa[kData] -= 1; repetidosData += 1; return; }

    // Já existe um título aberto com este valor e vencimento perto?
    // Então este movimento é o pagamento dele: efetiva a MESMA linha em
    // vez de criar uma segunda, e acende `revisar`.
    const t = casar(data, deb, cred);
    if (t) {
      usados[t.id] = true;
      casados.push({
        id: t.id, conta_id: contaId, data,
        competencia: competenciaDe(l.competencia) || undefined,
        situacao: "efetivado", conciliado: true, revisar: true, chave_extrato: chave,
        descricao: texto(l.descricao) || t.descricao,
      });
      return;
    }

    corpo.push({
      conta_id: contaId, data, competencia: competenciaDe(l.competencia) || competenciaDe(data),
      categoria_id: catId, descricao: texto(l.descricao), debito: deb, credito: cred,
      estoque_id: placa ? estoquePorPlaca[placa] || null : null,
      tipo_negociacao: cat && cat.grupo === "negociacao" ? (tipoNegNa(l.descricao) || "outro") : null,
      conciliado: true, origem: fitid ? "ofx" : "planilha",
      favorecido_id: favPor[docNa(l.descricao)] || null,
      chave_extrato: chave,
    });
  });

  if (soConferir) {
    return res.status(200).json({
      conferencia: true, entrariam: corpo.length, ja_existiam: repetidosData,
      casariam: casados.length, invalidas, sem_categoria: corpo.filter((x) => !x.categoria_id).length,
      de: datas[0] || null, ate: datas[datas.length - 1] || null,
    });
  }

  // Os casados vão um a um: são poucos, e cada um é um UPDATE em linha
  // diferente — não há upsert em lote que sirva.
  let conciliados = 0;
  for (const k of casados) {
    const { id, ...mud } = k;
    if (mud.competencia === undefined) delete mud.competencia;
    let r;
    try {
      r = await supa(`${base("fin_lancamento")}?id=eq.${id}&situacao=eq.aberto`, {
        method: "PATCH", headers: cab(tok, REP), body: JSON.stringify(mud),
      });
    } catch (e) {
      // A chave do extrato pode já pertencer a outro lançamento desta
      // conta. Baixar o título continua valendo — o que se perde é só a
      // amarração com o identificador do banco.
      const { chave_extrato, ...semChave } = mud;
      r = await supa(`${base("fin_lancamento")}?id=eq.${id}&situacao=eq.aberto`, {
        method: "PATCH", headers: cab(tok, REP), body: JSON.stringify(semChave),
      });
    }
    if (um(r)) conciliados += 1;
  }

  let inseridos = 0;
  if (corpo.length) {
    // ignore-duplicates: o que já entrou (mesma chave na mesma conta) é pulado.
    const r = await supa(`${base("fin_lancamento")}?on_conflict=conta_id,chave_extrato`, {
      method: "POST", headers: cab(tok, { Prefer: "resolution=ignore-duplicates,return=representation" }),
      body: JSON.stringify(corpo),
    });
    inseridos = (r || []).length;
  }
  let fechamentoGravado = null;
  if (decimal(c.saldo_final) != null && dataISO(c.saldo_final_em)) {
    const em = dataISO(c.saldo_final_em);
    const comp = competenciaDe(em);
    if (em === fimDoMes(comp)) {
      await supa(`${base("fin_fechamento")}?on_conflict=conta_id,competencia`, {
        method: "POST", headers: cab(tok, { Prefer: "resolution=merge-duplicates" }),
        body: JSON.stringify({ conta_id: contaId, competencia: comp, saldo_banco: decimal(c.saldo_final) }),
      });
      fechamentoGravado = comp;
    }
  }
  /* O "Saldo anterior" do arquivo só vira abertura de conta que ainda
   * NÃO tem uma. A abertura é digitada pelo financeiro e é a régua do
   * saldo inteiro; cada extrato colado por cima a trocaria pelo saldo de
   * um dia qualquer, e o caixa mudaria sem ninguém ter mexido nele. */
  if (saldoInicial != null) {
    await supa(`${base("fin_conta")}?id=eq.${contaId}&saldo_inicial_em=is.null`, {
      method: "PATCH", headers: cab(tok), body: JSON.stringify({ saldo_inicial: saldoInicial, saldo_inicial_em: saldoEm }),
    });
  }
  return res.status(201).json({
    ok: true, inseridos,
    // Duas redes, dois números: o que a chave do banco barrou e o que a
    // varredura por data e valor barrou.
    repetidos: (corpo.length - inseridos) + repetidosData,
    repetidos_chave: corpo.length - inseridos, repetidos_data: repetidosData,
    invalidas, conciliados,
    favorecidos_criados: listaDocs.filter((d) => docs[d]).length ? Object.keys(favPor).length : 0,
    categorias_criadas: nomesNovos, saldo_inicial: saldoInicial, ligados_a_carro: corpo.filter((x) => x.estoque_id).length,
    sem_categoria: corpo.filter((x) => !x.categoria_id).length, fechamento_gravado: fechamentoGravado,
  });
}

/* ------------------ fechamento / conciliação ------------------ */

/**
 * O saldo que o banco diz no fim do mês contra o que os lançamentos
 * somam. Diferença zero é mês conciliado; diferente de zero é
 * lançamento faltando ou sobrando — e o BPO precisa ver o número, não
 * só um "ok".
 */
async function fechamento(req, res, tok) {
  const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
  const contaId = idOuNulo(req.query.conta_id);
  if (!contaId) return res.status(400).json({ erro: "Escolha a conta." });
  if (req.method === "GET") {
    const [ct, movs, f] = await Promise.all([
      supa(`${base("fin_conta")}?select=saldo_inicial,saldo_inicial_em&id=eq.${contaId}`, { headers: cab(tok) }),
      supa(`${base("fin_lancamento")}?select=data,debito,credito,conciliado&situacao=eq.efetivado&conta_id=eq.${contaId}&data=lte.${fimDoMes(comp)}&limit=100000`, { headers: cab(tok) }),
      supa(`${base("fin_fechamento")}?select=*&conta_id=eq.${contaId}&competencia=eq.${comp}`, { headers: cab(tok) }),
    ]);
    // Desde a abertura, como na lista (acima).
    const ini = um(ct) && um(ct).saldo_inicial_em ? String(um(ct).saldo_inicial_em).slice(0, 10) : "";
    const saldoCalc = (um(ct) ? Number(um(ct).saldo_inicial) || 0 : 0) +
      (movs || []).filter((x) => !ini || String(x.data) >= ini).reduce((t, x) => t + (Number(x.credito) || 0) - (Number(x.debito) || 0), 0);
    const naoConciliados = (movs || []).filter((x) => !x.conciliado).length;
    const fe = um(f);
    return res.status(200).json({
      competencia: comp, saldo_calculado: saldoCalc, saldo_banco: fe ? fe.saldo_banco : null,
      diferenca: fe && fe.saldo_banco != null ? Number(fe.saldo_banco) - saldoCalc : null,
      fechado_em: fe ? fe.fechado_em : null, observacao: fe ? fe.observacao : null, nao_conciliados: naoConciliados,
    });
  }
  if (req.method === "PUT") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const linha = { conta_id: contaId, competencia: comp };
    if (c.saldo_banco !== undefined) linha.saldo_banco = decimal(c.saldo_banco);
    if (c.observacao !== undefined) linha.observacao = texto(c.observacao);
    if (c.fechar !== undefined) linha.fechado_em = c.fechar ? new Date().toISOString() : null;
    const r = await supa(`${base("fin_fechamento")}?on_conflict=conta_id,competencia`, {
      method: "POST", headers: cab(tok, { Prefer: "resolution=merge-duplicates,return=representation" }), body: JSON.stringify(linha),
    });
    if (!um(r)) return recusado(res);
    return res.status(200).json({ ok: true, fechamento: um(r) });
  }
  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ erro: "Use GET ou PUT." });
}

/* ------------------ DRE ------------------ */

// O mesmo cálculo da tela de rentabilidade: venda − compra − custos.
const CUSTO_DO_CARRO = ["debitos", "quitacao", "deducao"];
function rentabilidadeDe(e) {
  const compra = Number(e.valor_compra) || 0;
  const custos = e.estoque_custo || [];
  const val = (l) => (l.realizado == null ? Number(l.previsto) || 0 : Number(l.realizado) || 0);
  const doCarro = custos.filter((l) => CUSTO_DO_CARRO.indexOf(l.tipo) >= 0).reduce((t, l) => t + val(l), 0);
  const daVenda = custos.filter((l) => CUSTO_DO_CARRO.indexOf(l.tipo) < 0).reduce((t, l) => t + val(l), 0);
  const venda = Number(e.valor_venda) || 0;
  return { venda, bruta: venda - compra - doCarro, liquida: venda - compra - doCarro - daVenda };
}
async function vendidosNoMes(tok, comp) {
  const fim = fimDoMes(comp);
  const lista = await supa(
    `${base("estoque")}?select=id,valor_compra,valor_venda,vendido_em,entrou_em,estoque_custo(tipo,previsto,realizado)` +
    `&situacao=eq.vendido&or=(and(vendido_em.gte.${comp},vendido_em.lte.${fim}),and(vendido_em.is.null,entrou_em.gte.${comp},entrou_em.lte.${fim}))&limit=1000`,
    { headers: cab(tok) });
  return lista || [];
}

async function dreMeses(req, res, tok, comp, n) {
  // Os n meses até `comp`, inclusive.
  const [a, m] = comp.split("-").map(Number);
  const meses = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    meses.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`);
  }
  const [lanc, listaCats] = await Promise.all([
    supa(`${base("fin_lancamento")}?select=debito,credito,competencia,categoria_id,` +
      `fin_rateio(valor,categoria_id)&situacao=eq.efetivado&competencia=gte.${meses[0]}&competencia=lte.${comp}&limit=100000`,
      { headers: cab(tok) }),
    supa(`${base("fin_categoria")}?select=id,nome,no_dre,ordem`, { headers: cab(tok) }),
  ]);
  const catPorId = {};
  (listaCats || []).forEach((c) => { catPorId[c.id] = c; });
  const cats = {}; const totais = {}; meses.forEach((x) => { totais[x] = 0; });
  (lanc || []).forEach((l) => {
    const k = String(l.competencia).slice(0, 7) + "-01"; if (totais[k] === undefined) return;
    partesDe(l).forEach((p) => {
      const c = p.categoria_id ? catPorId[p.categoria_id] : null;
      if (!c || !c.no_dre) return;
      cats[c.id] = cats[c.id] || { id: c.id, nome: c.nome, ordem: c.ordem, por_mes: {} };
      cats[c.id].por_mes[k] = (cats[c.id].por_mes[k] || 0) + p.valor; totais[k] += p.valor;
    });
  });
  // rentabilidade de cada mês, em paralelo
  const rent = {};
  await Promise.all(meses.map(async (x) => {
    const v = await vendidosNoMes(tok, x);
    rent[x] = v.reduce((t, e) => t + rentabilidadeDe(e).liquida, 0);
  }));
  const linhas = Object.keys(cats).map((k) => cats[k]).sort((p, q) => p.ordem - q.ordem || p.nome.localeCompare(q.nome));
  const lucro = {}; meses.forEach((x) => { lucro[x] = rent[x] + totais[x]; });
  return res.status(200).json({ meses, linhas, total_despesas: totais, rentabilidade: rent, lucro });
}

async function dre(req, res, tok) {
  const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
  const n = Math.min(24, Math.max(0, Number(req.query.meses) || 0));
  if (n > 1) return dreMeses(req, res, tok, comp, n);
  const d = await dreDoMes(tok, comp);
  /* O DRE PROJETADO (28/10/2026, o Derek: "porque os salários da galera
   * não tá aparecendo direito no DRE projetado?"). O DRE do mês continua
   * sendo o que passou no banco — é o número que se confere. A projeção
   * vem à parte e soma o que ainda vai sair: os títulos em aberto, as
   * contas fixas que ainda nem viraram título, e a folha do combinado
   * MENOS o que dela já entrou (pago ou em título), para o salário não
   * contar duas vezes. A rentabilidade é a de até agora: projetar venda
   * de carro seria número bonito e mentiroso (decisão 22). */
  try {
    const [proj, fixas] = await Promise.all([
      projecaoRemuneracao(tok, comp).catch(() => null),
      fixasDoMes(tok, comp).catch(() => null),
    ]);
    const folhaPrevista = proj ? (proj.aberto ? proj.total_ritmo : proj.total_agora) : 0;
    const folhaALancar = Math.max(0, folhaPrevista - (d.folha_lancada || 0));
    const fixasNaoGeradas = fixas ? fixas.contas.filter((x) => x.ativo && !x.titulo).reduce((t, x) => t + x.previsto, 0) : 0;
    d.projecao = {
      em_aberto: d.em_aberto, fixas_nao_geradas: fixasNaoGeradas,
      folha_prevista: folhaPrevista, folha_lancada: d.folha_lancada || 0, folha_a_lancar: folhaALancar,
      lucro_projetado: d.lucro + d.em_aberto - fixasNaoGeradas - folhaALancar,
    };
  } catch (e) { d.projecao = null; }
  return res.status(200).json(d);
}

/* AS CONTAS FIXAS (0096). A conta fixa é o cadastro; o mês é um título
 * (`fin_lancamento` aberto, com `conta_fixa_id`). "Varia com o consumo"
 * prevê pela média dos três últimos meses PAGOS dela; sem histórico,
 * vale o valor do cadastro. */
async function fixasDoMes(tok, comp) {
  const [contas, doMes, hist] = await Promise.all([
    supa(`${base("fin_conta_fixa")}?select=*,fin_categoria(id,nome),fin_conta(id,nome)&order=nome.asc`, { headers: cab(tok) }),
    supa(`${base("fin_lancamento")}?select=id,conta_fixa_id,debito,credito,situacao,vencimento,data&conta_fixa_id=not.is.null&competencia=eq.${comp}&situacao=neq.cancelado`, { headers: cab(tok) }),
    supa(`${base("fin_lancamento")}?select=conta_fixa_id,debito,competencia&conta_fixa_id=not.is.null&situacao=eq.efetivado&competencia=lt.${comp}&order=competencia.desc&limit=2000`, { headers: cab(tok) }),
  ]);
  const doMesPor = {}; (doMes || []).forEach((l) => { doMesPor[l.conta_fixa_id] = l; });
  const histPor = {}; (hist || []).forEach((l) => { (histPor[l.conta_fixa_id] = histPor[l.conta_fixa_id] || []).push(Number(l.debito) || 0); });
  const lista = (contas || []).map((c) => {
    const ult = (histPor[c.id] || []).slice(0, 3);
    const media = ult.length ? Math.round((ult.reduce((t, v) => t + v, 0) / ult.length) * 100) / 100 : null;
    const estimativa = c.tipo === "variavel" && media != null ? media : Number(c.valor) || 0;
    const t = doMesPor[c.id] || null;
    return { ...c, estimativa, media_3: media, meses_historico: ult.length,
      titulo: t ? { id: t.id, situacao: t.situacao, valor: Number(t.debito) || Number(t.credito) || 0, vencimento: t.vencimento } : null,
      previsto: t ? (Number(t.debito) || 0) : estimativa };
  });
  return { competencia: comp, contas: lista };
}
async function contasFixas(req, res, tok) {
  const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
  const acao = String(req.query.acao || "");
  if (req.method === "GET") {
    const d = await fixasDoMes(tok, comp);
    const ativas = d.contas.filter((x) => x.ativo);
    return res.status(200).json({ ...d,
      total_previsto: ativas.reduce((t, x) => t + x.previsto, 0),
      faltam_gerar: ativas.filter((x) => !x.titulo).length });
  }
  const c = await corpoDe(req) || {};
  if (req.method === "POST" && acao === "gerar") {
    // Um título por conta ativa que ainda não tem o do mês. O índice
    // único (conta, competência) barra a segunda geração do mesmo mês.
    const d = await fixasDoMes(tok, comp);
    const fim = fimDoMes(comp);
    const novos = d.contas.filter((x) => x.ativo && !x.titulo).map((x) => {
      const dia = String(Math.min(Number(x.dia_vencimento) || 10, Number(fim.slice(8, 10)))).padStart(2, "0");
      const venc = `${comp.slice(0, 8)}${dia}`;
      return { conta_id: x.conta_id || null, data: venc, competencia: comp, categoria_id: x.categoria_id || null,
        descricao: x.nome, favorecido: x.favorecido || null, debito: x.estimativa, credito: 0,
        situacao: "aberto", vencimento: venc, origem: "conta_fixa", conta_fixa_id: x.id,
        observacao: x.tipo === "variavel" ? "Valor estimado — ajuste quando a conta chegar." : null };
    }).filter((x) => x.debito > 0);
    if (!novos.length) return res.status(200).json({ ok: true, criados: 0 });
    const r = await supa(base("fin_lancamento"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(novos) });
    return res.status(201).json({ ok: true, criados: (r || []).length });
  }
  // Ajustar o valor do título do mês (a conta de consumo que chegou).
  if (req.method === "PATCH" && acao === "valor") {
    const id = idOuNulo(c.titulo_id);
    const v = decimal(c.valor);
    if (!id || !(v > 0)) return res.status(400).json({ erro: "Título e valor." });
    const r = await supa(`${base("fin_lancamento")}?id=eq.${id}&situacao=eq.aberto`, { method: "PATCH", headers: cab(tok, REP),
      body: JSON.stringify({ debito: v, observacao: null }) });
    if (!um(r)) return res.status(409).json({ erro: "O título não está mais em aberto." });
    return res.status(200).json({ ok: true });
  }
  if (req.method === "POST" || req.method === "PATCH") {
    const id = req.method === "PATCH" ? idOuNulo(req.query.id) : null;
    if (req.method === "PATCH" && !id) return res.status(400).json({ erro: "id inválido." });
    const linha = {};
    if (c.nome !== undefined) linha.nome = texto(c.nome);
    if (c.categoria_id !== undefined) linha.categoria_id = idOuNulo(c.categoria_id);
    if (c.conta_id !== undefined) linha.conta_id = idOuNulo(c.conta_id);
    if (c.favorecido !== undefined) linha.favorecido = texto(c.favorecido);
    if (c.tipo !== undefined) linha.tipo = c.tipo === "variavel" ? "variavel" : "fixa";
    if (c.valor !== undefined) linha.valor = decimal(c.valor) || 0;
    if (c.dia_vencimento !== undefined) linha.dia_vencimento = Math.min(31, Math.max(1, Math.trunc(Number(c.dia_vencimento) || 10)));
    if (c.ativo !== undefined) linha.ativo = !!c.ativo;
    if (c.observacao !== undefined) linha.observacao = texto(c.observacao);
    if (req.method === "POST" && !linha.nome) return res.status(400).json({ erro: "Dê um nome à conta." });
    const r = await supa(req.method === "POST" ? base("fin_conta_fixa") : `${base("fin_conta_fixa")}?id=eq.${id}`,
      { method: req.method, headers: cab(tok, REP), body: JSON.stringify(linha) });
    if (!um(r)) return recusado(res);
    return res.status(200).json({ ok: true, conta: um(r) });
  }
  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
}

// O DRE de um mês, como objeto: a tela o lê pelo `dre`, e o combinado de
// remuneração usa o mesmo lucro — duas contas do lucro seriam dois DREs.
async function dreDoMes(tok, comp) {
  const [lanc, cats] = await Promise.all([
    supa(`${base("fin_lancamento")}?select=debito,credito,situacao,categoria_id,estoque_id,tipo_negociacao,funcionario_id,` +
      `fin_rateio(valor,categoria_id,estoque_id,tipo_negociacao,funcionario_id)&situacao=in.(aberto,efetivado)&competencia=eq.${comp}&limit=10000`,
      { headers: cab(tok) }),
    supa(`${base("fin_categoria")}?select=id,nome,grupo,no_dre,ordem,pede_funcionario`, { headers: cab(tok) }),
  ]);
  const catPorId = {};
  (cats || []).forEach((c) => { catPorId[c.id] = c; });

  const por = {};
  let semCategoria = 0;
  let emAberto = 0;
  // O que da folha já entrou nesta competência (paga ou em título), para
  // a projeção não contar o salário duas vezes.
  let folhaLancada = 0;
  (lanc || []).forEach((l) => {
    // O DRE do mês continua sendo o que passou no banco — é o número
    // que o Derek confere hoje. O que está em aberto vai à parte, para
    // não mudar o significado da linha sem ele saber.
    const aberto = l.situacao === "aberto";
    // Soma pelas PARTES, não pelo cabeçalho: um PIX de despachante
    // pode ser dois carros (fora do DRE) e uma taxa da loja (dentro).
    partesDe(l).forEach((p) => {
      const c = p.categoria_id ? catPorId[p.categoria_id] : null;
      if (c && !c.no_dre) return;
      if ((c && c.pede_funcionario) || p.funcionario_id) folhaLancada += -p.valor;
      if (aberto) { emAberto += p.valor; return; }
      if (!c) { semCategoria += p.valor; return; }
      por[c.id] = por[c.id] || { id: c.id, nome: c.nome, grupo: c.grupo, ordem: c.ordem, valor: 0 };
      // Como na planilha: DRE = crédito − débito, então despesa é negativa.
      por[c.id].valor += p.valor;
    });
  });
  const linhas = Object.keys(por).map((k) => por[k]).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const totalDespesas = linhas.reduce((t, x) => t + x.valor, 0);

  const vendidos = await vendidosNoMes(tok, comp);
  const rent = vendidos.reduce((t, e) => { const r = rentabilidadeDe(e); return { bruta: t.bruta + r.bruta, liquida: t.liquida + r.liquida, venda: t.venda + r.venda }; },
    { bruta: 0, liquida: 0, venda: 0 });

  return {
    competencia: comp, linhas, total_despesas: totalDespesas, sem_categoria: semCategoria, em_aberto: emAberto, folha_lancada: folhaLancada,
    carros_vendidos: vendidos.length, rentabilidade: rent.liquida, rentabilidade_bruta: rent.bruta, faturamento: rent.venda,
    lucro: rent.liquida + totalDespesas + semCategoria,
  };
}

/* ------------------ conferência dos carros ------------------ */

async function carros(req, res, tok) {
  const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
  const fim = fimDoMes(comp);
  const est = await supa(
    `${base("estoque")}?select=id,situacao,entrou_em,vendido_em,valor_compra,valor_venda,veiculo(placa,marca_modelo),comprador(nome),estoque_custo(tipo,previsto,realizado)` +
    `&or=(and(entrou_em.gte.${comp},entrou_em.lte.${fim}),and(vendido_em.gte.${comp},vendido_em.lte.${fim}))&order=entrou_em.desc&limit=500`,
    { headers: cab(tok) });
  const ids = (est || []).map((e) => e.id);
  // Pega tudo que aponta para estes carros — pelo cabeçalho OU por uma
  // linha de rateio. O PIX do despachante repartido entre dois carros
  // só aparece aqui se as partes forem lidas.
  // São DUAS consultas: o PostgREST não aceita coluna de recurso
  // embutido dentro de `or=` ("failed to parse logic tree" — a aba
  // Carros ficou assim até 28/10/2026). Uma pelo cabeçalho, outra pelos
  // lançamentos que algum rateio liga a estes carros; o id junta as duas.
  const SEL = `select=id,estoque_id,tipo_negociacao,data,debito,credito,descricao,fin_rateio(valor,estoque_id,tipo_negociacao,descricao)`;
  let lanc = [];
  if (ids.length) {
    const lista = ids.join(",");
    const [peloCab, rateios] = await Promise.all([
      supa(`${base("fin_lancamento")}?${SEL}&estoque_id=in.(${lista})&order=data.asc&limit=5000`, { headers: cab(tok) }),
      supa(`${base("fin_rateio")}?select=lancamento_id&estoque_id=in.(${lista})&limit=5000`, { headers: cab(tok) }),
    ]);
    const ja = new Set((peloCab || []).map((l) => l.id));
    const faltam = [...new Set((rateios || []).map((r) => r.lancamento_id))].filter((id) => id && !ja.has(id));
    const peloRateio = faltam.length
      ? await supa(`${base("fin_lancamento")}?${SEL}&id=in.(${faltam.join(",")})&limit=5000`, { headers: cab(tok) })
      : [];
    lanc = (peloCab || []).concat(peloRateio || []).sort((a, b) => String(a.data).localeCompare(String(b.data)));
  }
  const porEstoque = {};
  (lanc || []).forEach((l) => {
    partesDe(l).forEach((p) => {
      if (!p.estoque_id) return;
      const cred = Number(l.credito) || 0;
      (porEstoque[p.estoque_id] = porEstoque[p.estoque_id] || []).push({
        id: l.id, data: l.data, descricao: l.descricao, tipo_negociacao: p.tipo_negociacao,
        debito: cred > 0 ? 0 : Math.abs(p.valor), credito: cred > 0 ? Math.abs(p.valor) : 0,
      });
    });
  });

  const val = (l) => (l.realizado == null ? Number(l.previsto) || 0 : Number(l.realizado) || 0);
  const linhas = (est || []).map((e) => {
    const ls = porEstoque[e.id] || [];
    const pago = (tipo, lado) => ls.filter((l) => l.tipo_negociacao === tipo).reduce((t, l) => t + (Number(l[lado]) || 0), 0);
    const quitPrev = (e.estoque_custo || []).filter((x) => x.tipo === "quitacao").reduce((t, x) => t + val(x), 0);
    const debPrev = (e.estoque_custo || []).filter((x) => x.tipo === "debitos").reduce((t, x) => t + val(x), 0);
    return {
      id: e.id, placa: e.veiculo && e.veiculo.placa, carro: e.veiculo && e.veiculo.marca_modelo, situacao: e.situacao,
      entrou_em: e.entrou_em, vendido_em: e.vendido_em, comprador: e.comprador && e.comprador.nome,
      cliente: { previsto: Number(e.valor_compra) || 0, pago: pago("pagto_cliente", "debito") },
      quitacao: { previsto: quitPrev, pago: pago("quitacao", "debito") },
      debitos: { previsto: debPrev, pago: pago("debitos", "debito") },
      lojista: { previsto: Number(e.valor_venda) || 0, recebido: pago("pagto_lojista", "credito") },
      reembolso: pago("reembolso", "credito"),
      lancamentos: ls,
    };
  });
  return res.status(200).json({ competencia: comp, carros: linhas });
}

/**
 * Contas a pagar e a receber: os títulos em aberto.
 *
 *   GET  ?ate=aaaa-mm-dd   os abertos até esse vencimento
 *   POST ?acao=baixar&id=  efetiva à mão, escolhendo o banco
 *
 * Criar título é o POST normal de lançamento com situacao=aberto — é a
 * mesma linha, e ter dois caminhos de criação daria dois formatos.
 */
async function titulo(req, res, tok) {
  if (req.method === "GET") {
    const ate = dataISO(req.query.ate);
    const f = ate ? `&vencimento=lte.${ate}` : "";
    const lista = await supa(
      `${base("fin_lancamento")}?select=${CAMPOS_LANC}&situacao=eq.aberto${f}&order=vencimento.asc.nullslast&limit=1000`,
      { headers: cab(tok) });
    const hoje = hojeAqui();
    const abertos = lista || [];
    return res.status(200).json({
      titulos: abertos,
      a_pagar: abertos.filter((l) => Number(l.debito) > 0).reduce((t, l) => t + Number(l.debito), 0),
      a_receber: abertos.filter((l) => Number(l.credito) > 0).reduce((t, l) => t + Number(l.credito), 0),
      vencidos: abertos.filter((l) => l.vencimento && l.vencimento < hoje).length,
    });
  }

  // Parcelamento e conta fixa são o mesmo gesto: um título vira N,
  // amarrados por `grupo_id`. Não há tarefa agendada neste sistema, e
  // gerar tudo de uma vez é honesto — a fila mostra o que vem, e o
  // extrato baixa cada um quando passar.
  if (req.method === "POST" && String(req.query.acao || "") === "repetir") {
    const id = idOuNulo(req.query.id);
    if (!id) return res.status(400).json({ erro: "id inválido." });
    const c = await corpoDe(req) || {};
    const n = Math.min(60, Math.max(1, Math.trunc(Number(c.vezes) || 0)));
    if (n < 1) return res.status(400).json({ erro: "Quantas vezes?" });
    const base0 = um(await supa(`${base("fin_lancamento")}?select=*&id=eq.${id}`, { headers: cab(tok) }));
    if (!base0) return res.status(404).json({ erro: "Título não encontrado." });

    const grupo = base0.grupo_id || id;
    const venc0 = base0.vencimento || base0.data;
    const dividir = !!c.dividir;      // parcelar o valor, ou repetir o mesmo
    const total = (Number(base0.debito) || 0) + (Number(base0.credito) || 0);
    const cada = dividir ? Math.round((total / (n + 1)) * 100) / 100 : total;

    const novos = [];
    for (let i = 1; i <= n; i++) {
      const d = new Date(`${venc0}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + i);
      const venc = d.toISOString().slice(0, 10);
      novos.push({
        // A conta prevista vai junto: o aluguel que sai do Itaú sai do
        // Itaú nos doze meses.
        conta_id: base0.conta_id || null, data: venc, competencia: competenciaDe(venc),
        categoria_id: base0.categoria_id, descricao: base0.descricao,
        favorecido: base0.favorecido, favorecido_id: base0.favorecido_id,
        debito: Number(base0.debito) > 0 ? cada : 0,
        credito: Number(base0.credito) > 0 ? cada : 0,
        estoque_id: base0.estoque_id, tipo_negociacao: base0.tipo_negociacao,
        funcionario_id: base0.funcionario_id,
        situacao: "aberto", vencimento: venc, origem: "serie",
        grupo_id: grupo, parcela: i + 1, parcelas: n + 1,
      });
    }
    const r = await supa(base("fin_lancamento"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(novos) });
    if (!(r || []).length) return recusado(res);
    // O primeiro passa a fazer parte da série.
    const mud = { grupo_id: grupo, parcela: 1, parcelas: n + 1 };
    if (dividir) { if (Number(base0.debito) > 0) mud.debito = cada; else mud.credito = cada; }
    await supa(`${base("fin_lancamento")}?id=eq.${id}`, { method: "PATCH", headers: cab(tok), body: JSON.stringify(mud) });
    return res.status(201).json({ ok: true, criados: (r || []).length });
  }

  if (req.method === "POST" && String(req.query.acao || "") === "baixar") {
    const id = idOuNulo(req.query.id);
    if (!id) return res.status(400).json({ erro: "id inválido." });
    const c = await corpoDe(req) || {};
    const contaId = idOuNulo(c.conta_id);
    if (!contaId) return res.status(400).json({ erro: "Escolha de qual banco saiu." });
    const quando = dataISO(c.data) || hojeAqui();
    const r = await supa(`${base("fin_lancamento")}?id=eq.${id}&situacao=eq.aberto`, {
      method: "PATCH", headers: cab(tok, REP),
      body: JSON.stringify({ situacao: "efetivado", conta_id: contaId, data: quando, conciliado: !!c.conciliado, revisar: false }),
    });
    if (!um(r)) return res.status(409).json({ erro: "Título não está mais aberto." });
    return res.status(200).json({ ok: true, lancamento: um(r) });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ erro: "Use GET ou POST." });
}

/**
 * O fluxo de caixa projetado: o saldo de hoje mais o que vence.
 *
 * É a pergunta que o BPO faz toda segunda — "dá para pagar a folha
 * dia 5?" — e a única que a lista de títulos sozinha não responde.
 * Semana a semana, para caber na cabeça; o dia exato está na fila.
 */
async function fluxo(req, res, tok) {
  const semanas = Math.min(26, Math.max(2, Math.trunc(Number(req.query.semanas) || 8)));
  const hoje = hojeAqui();
  const [contas, mov, abertos] = await Promise.all([
    supa(`${base("fin_conta")}?select=id,nome,saldo_inicial,saldo_inicial_em&ativa=is.true`, { headers: cab(tok) }),
    supa(`${base("fin_lancamento")}?select=conta_id,data,debito,credito&situacao=eq.efetivado&data=lte.${hoje}&limit=100000`, { headers: cab(tok) }),
    supa(`${base("fin_lancamento")}?select=id,debito,credito,vencimento,descricao,favorecido,fin_favorecido(nome)&situacao=eq.aberto&limit=2000`, { headers: cab(tok) }),
  ]);
  // Cada conta conta a partir da própria abertura, e só conta ativa.
  const inicioDe = {};
  (contas || []).forEach((c) => { inicioDe[c.id] = c.saldo_inicial_em ? String(c.saldo_inicial_em).slice(0, 10) : ""; });
  const saldoHoje = (contas || []).reduce((t, c) => t + (Number(c.saldo_inicial) || 0), 0) +
    (mov || []).filter((l) => l.conta_id in inicioDe && (!inicioDe[l.conta_id] || String(l.data) >= inicioDe[l.conta_id]))
      .reduce((t, l) => t + (Number(l.credito) || 0) - (Number(l.debito) || 0), 0);

  const dia = (iso, mais) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + mais); return d.toISOString().slice(0, 10); };
  const faixas = [];
  for (let i = 0; i < semanas; i++) faixas.push({ de: dia(hoje, i * 7), ate: dia(hoje, i * 7 + 6), entra: 0, sai: 0, vencido: 0 });

  let atrasado = 0;
  (abertos || []).forEach((l) => {
    const v = l.vencimento || hoje;
    const deb = Number(l.debito) || 0, cred = Number(l.credito) || 0;
    if (v < hoje) { atrasado += cred - deb; faixas[0].vencido += deb; return; }
    const f = faixas.filter((x) => v >= x.de && v <= x.ate)[0];
    // O que vence depois da última semana fica de fora e é dito à parte.
    if (!f) return;
    f.entra += cred; f.sai += deb;
  });

  let acumulado = saldoHoje + atrasado;
  const linhas = faixas.map((f) => {
    acumulado += f.entra - f.sai;
    return { ...f, saldo: Math.round(acumulado * 100) / 100 };
  });
  const negativa = linhas.filter((l) => l.saldo < 0)[0] || null;

  return res.status(200).json({
    hoje, saldo_hoje: Math.round(saldoHoje * 100) / 100,
    vencido: Math.round(atrasado * 100) / 100,
    semanas: linhas,
    fica_negativo_em: negativa ? negativa.de : null,
  });
}

/** O histórico de um lançamento: quem mudou o quê. */
async function log(req, res, tok) {
  const id = idOuNulo(req.query.lancamento_id);
  if (!id) return res.status(400).json({ erro: "lancamento_id inválido." });
  const [linhas, quem] = await Promise.all([
    supa(`${base("fin_log")}?select=*&lancamento_id=eq.${id}&order=quando.desc&limit=100`, { headers: cab(tok) }),
    supa(`${URL_BASE}/rest/v1/perfil?select=id,nome`, { headers: cab(tok) }),
  ]);
  const nomes = {};
  (quem || []).forEach((p) => { nomes[p.id] = p.nome; });
  return res.status(200).json({
    log: (linhas || []).map((l) => ({ ...l, quem_nome: nomes[l.quem] || null })),
  });
}

/**
 * O rateio de um lançamento.
 *
 * PUT troca o conjunto inteiro, não faz diferença de linhas: a tela
 * edita a repartição como um bloco, e apagar-e-gravar é o que evita
 * ficar com metade do rateio velho e metade do novo se algo falhar no
 * meio.
 */
async function rateio(req, res, tok) {
  const lid = idOuNulo(req.query.lancamento_id);
  if (!lid) return res.status(400).json({ erro: "lancamento_id inválido." });

  if (req.method === "GET") {
    const lista = await supa(`${base("fin_rateio")}?select=*&lancamento_id=eq.${lid}&order=criado_em.asc`, { headers: cab(tok) });
    return res.status(200).json({ rateios: lista || [] });
  }

  if (req.method === "PUT") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const l = um(await supa(`${base("fin_lancamento")}?select=debito,credito&id=eq.${lid}`, { headers: cab(tok) }));
    if (!l) return res.status(404).json({ erro: "Lançamento não encontrado." });
    const total = (Number(l.debito) || 0) + (Number(l.credito) || 0);

    const itens = (Array.isArray(c.itens) ? c.itens : []).slice(0, 60)
      .map((x) => ({
        lancamento_id: lid,
        valor: Math.abs(decimal(x.valor) || 0),
        categoria_id: idOuNulo(x.categoria_id),
        estoque_id: idOuNulo(x.estoque_id),
        tipo_negociacao: TIPOS_NEG.indexOf(String(x.tipo_negociacao)) >= 0 ? x.tipo_negociacao : null,
        funcionario_id: idOuNulo(x.funcionario_id),
        descricao: texto(x.descricao),
      }))
      .filter((x) => x.valor > 0);

    const soma = itens.reduce((t, x) => t + x.valor, 0);
    // Passar do valor do lançamento inventaria dinheiro; ficar abaixo
    // é permitido, e a sobra continua na categoria do cabeçalho.
    if (Math.round(soma * 100) > Math.round(total * 100)) {
      return res.status(400).json({ erro: `A soma das partes (${soma.toFixed(2)}) passa do valor do lançamento (${total.toFixed(2)}).` });
    }

    await supa(`${base("fin_rateio")}?lancamento_id=eq.${lid}`, { method: "DELETE", headers: cab(tok) });
    let salvos = [];
    if (itens.length) {
      salvos = await supa(base("fin_rateio"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(itens) }) || [];
      if (!salvos.length) return recusado(res);
    }
    return res.status(200).json({ ok: true, rateios: salvos, sobra: Math.round((total - soma) * 100) / 100 });
  }

  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ erro: "Use GET ou PUT." });
}

/**
 * O que a negociação combinou, para conferir contra o lançamento.
 *
 * É daqui que sai o "está de acordo?": o valor previsto de cada parte
 * do negócio daquele carro, e o quanto já foi pago nela.
 */
async function negociacao(req, res, tok) {
  const eid = idOuNulo(req.query.estoque_id);
  if (!eid) return res.status(400).json({ erro: "estoque_id inválido." });
  const [e, lancs] = await Promise.all([
    supa(`${base("estoque")}?select=id,valor_compra,valor_venda,veiculo(placa,marca_modelo),comprador(nome),estoque_custo(tipo,previsto,realizado)&id=eq.${eid}`, { headers: cab(tok) }),
    supa(`${base("fin_lancamento")}?select=id,debito,credito,estoque_id,tipo_negociacao,fin_rateio(valor,estoque_id,tipo_negociacao)&or=(estoque_id.eq.${eid},fin_rateio.estoque_id.eq.${eid})&limit=500`, { headers: cab(tok) }),
  ]);
  const est = um(e);
  if (!est) return res.status(404).json({ erro: "Carro não encontrado." });
  const val = (x) => (x.realizado == null ? Number(x.previsto) || 0 : Number(x.realizado) || 0);
  const soma = (tipo) => (est.estoque_custo || []).filter((x) => x.tipo === tipo).reduce((t, x) => t + val(x), 0);

  const pago = {};
  (lancs || []).forEach((l) => {
    partesDe(l).forEach((p) => {
      if (p.estoque_id !== eid || !p.tipo_negociacao) return;
      pago[p.tipo_negociacao] = (pago[p.tipo_negociacao] || 0) + Math.abs(p.valor);
    });
  });

  return res.status(200).json({
    carro: { placa: est.veiculo && est.veiculo.placa, modelo: est.veiculo && est.veiculo.marca_modelo, comprador: est.comprador && est.comprador.nome },
    previsto: {
      pagto_cliente: Number(est.valor_compra) || 0,
      quitacao: soma("quitacao"),
      debitos: soma("debitos"),
      pagto_lojista: Number(est.valor_venda) || 0,
      reembolso: 0, outro: 0,
    },
    pago,
  });
}

/* ------------------ vales e folha ------------------ */

async function vale(req, res, tok) {
  if (req.method === "GET") {
    const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
    const lista = await supa(`${base("fin_vale")}?select=*,fin_funcionario(id,nome)&competencia=eq.${comp}&order=data.asc`, { headers: cab(tok) });
    return res.status(200).json({ competencia: comp, vales: lista || [] });
  }
  if (req.method === "POST" || req.method === "PATCH") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const l = {};
    if (c.funcionario_id !== undefined) l.funcionario_id = idOuNulo(c.funcionario_id);
    if (c.data !== undefined) l.data = dataISO(c.data);
    if (c.competencia !== undefined) l.competencia = competenciaDe(c.competencia);
    if (c.valor !== undefined) l.valor = Math.abs(decimal(c.valor) || 0);
    if (c.descricao !== undefined) l.descricao = texto(c.descricao);
    if (c.descontado !== undefined) l.descontado = !!c.descontado;
    if (req.method === "POST") {
      if (!l.funcionario_id || !l.valor) return res.status(400).json({ erro: "Informe o funcionário e o valor." });
      l.data = l.data || hojeAqui(); l.competencia = l.competencia || competenciaDe(l.data);
      const r = await supa(base("fin_vale"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(l) });
      if (!um(r)) return recusado(res);
      return res.status(201).json({ ok: true, vale: um(r) });
    }
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const r = await supa(`${base("fin_vale")}?id=eq.${id}`, { method: "PATCH", headers: cab(tok, REP), body: JSON.stringify(l) });
    if (!um(r)) return recusado(res);
    return res.status(200).json({ ok: true, vale: um(r) });
  }
  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const r = await supa(`${base("fin_vale")}?id=eq.${id}`, { method: "DELETE", headers: cab(tok, REP) });
    if (!um(r)) return recusado(res);
    return res.status(200).json({ ok: true });
  }
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
}

/**
 * A folha do mês: uma linha por funcionário ativo, mesmo sem nada
 * gravado ainda. Vales vêm somados dos lançados para a competência;
 * o líquido é calculado aqui e gravado, para que a folha de janeiro
 * não mude se a regra mudar em março.
 */
async function folha(req, res, tok) {
  const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
  if (req.method === "GET") {
    const [funcs, gravadas, vales, colabs, proj] = await Promise.all([
      supa(`${base("fin_funcionario")}?select=*&order=nome.asc`, { headers: cab(tok) }),
      supa(`${base("fin_folha")}?select=*&competencia=eq.${comp}`, { headers: cab(tok) }),
      supa(`${base("fin_vale")}?select=funcionario_id,valor&competencia=eq.${comp}`, { headers: cab(tok) }),
      supa(`${base("colaborador")}?select=id,nome_completo,fin_funcionario_id,desligado_em,inicio_em`, { headers: cab(tok) }).catch(() => []),
      projecaoRemuneracao(tok, comp).catch(() => null),
    ]);
    const gPor = {}; (gravadas || []).forEach((g) => { gPor[g.funcionario_id] = g; });
    const vPor = {}; (vales || []).forEach((v) => { vPor[v.funcionario_id] = (vPor[v.funcionario_id] || 0) + (Number(v.valor) || 0); });
    /* O COMBINADO DE CADA UM (0081) vira salário, comissão e bonificação:
     * o fixo é salário, os bônus são bonificação, o resto (variável,
     * vendas, faixas) é comissão. É sugestão até alguém salvar — a linha
     * gravada continua mandando, porque é ela que diz o que foi pago. */
    const colabPorFin = {}; (colabs || []).forEach((c) => { if (c.fin_funcionario_id) colabPorFin[c.fin_funcionario_id] = c; });
    const projPorColab = {}; ((proj && proj.pessoas) || []).forEach((p) => { projPorColab[p.colaborador_id] = p; });
    const partes = (calc) => {
      const ls = (calc && calc.linhas) || [];
      const soma = (f) => Math.round(ls.filter(f).reduce((t, l) => t + (Number(l.valor) || 0), 0) * 100) / 100;
      return { salario: soma((l) => l.fixo), comissao: soma((l) => !l.fixo && !l.bonus), bonificacao: soma((l) => l.bonus) };
    };
    const linhas = (funcs || []).filter((f) => f.ativo || gPor[f.id]).map((f) => {
      const g = gPor[f.id];
      const col = colabPorFin[f.id];
      const p = col && projPorColab[col.id];
      const combinado = p ? { ...partes(p.agora), total: p.agora.total, ritmo: p.ritmo.total, perfil: p.perfil, linhas: p.agora.linhas } : null;
      const salario = g ? Number(g.salario) : combinado ? combinado.salario : Number(f.salario_base) || 0;
      const comissao = g ? Number(g.comissao) : combinado ? combinado.comissao : 0;
      const bonificacao = g ? Number(g.bonificacao) : combinado ? combinado.bonificacao : 0;
      const valesSoma = vPor[f.id] || 0;
      return {
        funcionario_id: f.id, nome: f.nome, negociador_id: f.negociador_id, gravada: !!g,
        colaborador_id: col ? col.id : null, combinado,
        salario, comissao, bonificacao, vales: valesSoma,
        liquido: salario + comissao + bonificacao - valesSoma, pago_em: g ? g.pago_em : null,
      };
    });
    // Quem está na equipe e não está na folha: a ficha sem
    // `fin_funcionario_id`, ainda não desligada antes deste mês.
    const fora = (colabs || []).filter((c) => !c.fin_funcionario_id && c.nome_completo && (!c.desligado_em || c.desligado_em >= comp))
      .map((c) => ({ colaborador_id: c.id, nome: c.nome_completo }));
    return res.status(200).json({ competencia: comp, folha: linhas, fora, aberto: !!(proj && proj.aberto) });
  }
  // Põe na folha quem está na equipe e ainda não está: cria a pessoa da
  // folha e liga a ficha a ela, como o "pôr na folha" da ficha (0079).
  if (req.method === "POST" && String(req.query.acao || "") === "incluir") {
    const colabs = await supa(`${base("colaborador")}?select=id,nome_completo,fin_funcionario_id,desligado_em`, { headers: cab(tok) });
    const alvo = (colabs || []).filter((c) => !c.fin_funcionario_id && c.nome_completo && (!c.desligado_em || c.desligado_em >= comp));
    /* NOME REPETIDO NÃO PARA A FILA (28/10/2026). A folha tem índice
     * único no nome (0021), e a equipe tinha duas fichas "MARCOS" e
     * "Marcos": o primeiro "pôr na folha" parou no meio, com parte da
     * equipe dentro. A ficha é por pessoa (decisão 10), então são duas
     * pessoas — a segunda entra como "Marcos (2)", e o nome se corrige
     * depois. E um erro numa pessoa não derruba as outras: cada uma
     * entra ou volta em `falhas` com o motivo. */
    let feitos = 0;
    const falhas = [];
    for (const c of alvo) {
      try {
        let f = null;
        for (let n = 1; n <= 5 && !f; n++) {
          const nome = n === 1 ? c.nome_completo : `${c.nome_completo} (${n})`;
          try {
            f = um(await supa(base("fin_funcionario"), { method: "POST", headers: cab(tok, { Prefer: "return=representation" }),
              body: JSON.stringify({ nome, salario_base: 0, ativo: true }) }));
          } catch (e) {
            if (!/fin_funcionario_nome|duplicate|repetido/i.test(String(e.message || ""))) throw e;
          }
        }
        if (!f) { falhas.push({ nome: c.nome_completo, erro: "nome já usado na folha" }); continue; }
        await supa(`${base("colaborador")}?id=eq.${c.id}`, { method: "PATCH", headers: cab(tok, { Prefer: "return=minimal" }),
          body: JSON.stringify({ fin_funcionario_id: f.id }) });
        feitos++;
      } catch (e) { falhas.push({ nome: c.nome_completo, erro: String(e.message || e).slice(0, 120) }); }
    }
    return res.status(200).json({ ok: true, incluidos: feitos, falhas });
  }
  if (req.method === "PUT") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const fid = idOuNulo(c.funcionario_id);
    if (!fid) return res.status(400).json({ erro: "funcionario_id inválido." });
    const vales = await supa(`${base("fin_vale")}?select=valor&funcionario_id=eq.${fid}&competencia=eq.${comp}`, { headers: cab(tok) });
    const valesSoma = (vales || []).reduce((t, v) => t + (Number(v.valor) || 0), 0);
    const salario = decimal(c.salario) || 0, comissao = decimal(c.comissao) || 0, bonificacao = decimal(c.bonificacao) || 0;
    const linha = {
      funcionario_id: fid, competencia: comp, salario, comissao, bonificacao, vales: valesSoma,
      liquido: salario + comissao + bonificacao - valesSoma,
      pago_em: c.pago_em === undefined ? undefined : dataISO(c.pago_em),
      atualizado_em: new Date().toISOString(),
    };
    if (linha.pago_em === undefined) delete linha.pago_em;
    const r = await supa(`${base("fin_folha")}?on_conflict=funcionario_id,competencia`, {
      method: "POST", headers: cab(tok, { Prefer: "resolution=merge-duplicates,return=representation" }), body: JSON.stringify(linha),
    });
    if (!um(r)) return recusado(res);
    return res.status(200).json({ ok: true, folha: um(r) });
  }
  res.setHeader("Allow", "GET, PUT");
  return res.status(405).json({ erro: "Use GET ou PUT." });
}

/* ------------------ handler ------------------ */

// Os carros do estoque, só placa e modelo, para o vínculo manual de um
// lançamento — quando a descrição não trouxe a placa.
/* ------------------ fechamento do mês: previsto x realizado ------------------ */

// A planilha "Controle Financeiro Completo" é um DRE gerencial de
// franquia. A estrutura dela responde duas perguntas que o DRE por
// categoria não responde: quanto sobra por carro, e quanto a loja
// custa parada.
//
//   receita operacional bruta
//   − despesas VARIÁVEIS   (andam com a venda)
//   = MARGEM DE CONTRIBUIÇÃO
//   − despesas FIXAS       (existem mesmo sem vender)
//   = resultado
//
// **Faturamento aqui é a margem BRUTA dos carros, não o valor de
// venda.** Na planilha o ticket de janeiro deu R$ 4.676 com 69 carros:
// é o que a loja ganha por carro. Somar o preço do carro inflaria a
// receita em vinte vezes e faria toda despesa parecer irrelevante.
//
// E é a margem BRUTA, não a líquida, porque cautelar e comissão
// externa aparecem logo abaixo como despesa variável — a líquida já as
// desconta, e entrariam duas vezes.

// Só as duas premissas. "Outras receitas" não vira linha livre: ela
// já tem categoria própria, e ter os dois caminhos somaria duas vezes.
const LINHAS_LIVRES = ["veiculos", "ticket"];
const mesAnterior = (comp) => {
  const [a, m] = comp.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

async function orcamentoDoMes(tok, comp) {
  const lista = await supa(`${base("fin_orcamento")}?select=categoria_id,linha,valor&competencia=eq.${comp}&limit=2000`,
    { headers: cab(tok) });
  const porCat = {}; const livres = {};
  (lista || []).forEach((o) => {
    if (o.categoria_id) porCat[o.categoria_id] = Number(o.valor) || 0;
    else if (o.linha) livres[o.linha] = Number(o.valor) || 0;
  });
  return { porCat, livres };
}

const categoriasDoFechamento = (tok) =>
  supa(`${base("fin_categoria")}?select=id,nome,grupo,no_dre,ordem,tipo_custo&ativa=eq.true&order=ordem.asc,nome.asc`, { headers: cab(tok) })
    .then((c) => c || []);

/**
 * O realizado de UM mês, do jeito do fechamento: lançamentos
 * efetivados da competência, somados pelas partes do rateio, mais a
 * margem bruta dos carros vendidos. O Fechamento (um mês) e o Ano (doze)
 * passam os dois por aqui — duas contas da mesma linha discordariam na
 * primeira categoria nova.
 *
 * `retiradas` é o grupo `retirada`, que fica fora do resultado e a
 * planilha mostra embaixo dele, como distribuição de lucro.
 */
async function realizadoDoMes(tok, comp, cats) {
  const [lanc, vendidos] = await Promise.all([
    supa(`${base("fin_lancamento")}?select=debito,credito,situacao,categoria_id,estoque_id,tipo_negociacao,funcionario_id,` +
      `fin_rateio(valor,categoria_id,estoque_id,tipo_negociacao,funcionario_id)&situacao=eq.efetivado&competencia=eq.${comp}&limit=10000`,
      { headers: cab(tok) }),
    vendidosNoMes(tok, comp),
  ]);
  const catPorId = {};
  (cats || []).forEach((c) => { catPorId[c.id] = c; });
  const real = {}; const retiradas = {};
  let semCategoria = 0;
  (lanc || []).forEach((l) => {
    partesDe(l).forEach((p) => {
      const c = p.categoria_id ? catPorId[p.categoria_id] : null;
      if (!c) { semCategoria += p.valor; return; }
      if (c.grupo === "retirada") { retiradas[c.id] = (retiradas[c.id] || 0) + p.valor; return; }
      if (c.tipo_custo === "fora" || !c.no_dre) return;
      real[c.id] = (real[c.id] || 0) + p.valor;
    });
  });
  const rent = vendidos.reduce((t, e) => t + rentabilidadeDe(e).bruta, 0);
  return { real, retiradas, semCategoria, vendidos, rent };
}

async function orcamento(req, res, tok) {
  const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());

  if (req.method === "PUT") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const catId = idOuNulo(c.categoria_id);
    const linha = LINHAS_LIVRES.indexOf(String(c.linha || "")) >= 0 ? String(c.linha) : null;
    if (!catId && !linha) return res.status(400).json({ erro: "Diga a categoria ou a linha." });
    const valor = decimal(c.valor) || 0;
    // Sem on_conflict: os dois índices de unicidade são PARCIAIS (um
    // para categoria, outro para linha) e o Postgres não infere índice
    // parcial no ON CONFLICT. Procura e decide, como o api/veiculo.js.
    const filtro = catId ? `categoria_id=eq.${catId}` : `linha=eq.${linha}`;
    const ja = await supa(`${base("fin_orcamento")}?select=id&competencia=eq.${comp}&${filtro}`, { headers: cab(tok) });
    const achou = um(ja);
    const corpo = { competencia: comp, categoria_id: catId, linha, valor, atualizado_em: new Date().toISOString() };
    const r = achou
      ? await supa(`${base("fin_orcamento")}?id=eq.${achou.id}`, { method: "PATCH", headers: cab(tok, REP), body: JSON.stringify({ valor, atualizado_em: corpo.atualizado_em }) })
      : await supa(base("fin_orcamento"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(corpo) });
    if (!um(r)) return recusado(res);
    return res.status(200).json({ ok: true, item: um(r) });
  }

  if (req.method === "POST" && String(req.query.acao || "") === "copiar") {
    // Orçar do zero todo mês é o que faz o orçamento parar de existir
    // no terceiro mês. Copia o anterior e a pessoa ajusta o que mudou.
    const de = competenciaDe(req.query.de) || mesAnterior(comp);
    const origem = await supa(`${base("fin_orcamento")}?select=categoria_id,linha,valor&competencia=eq.${de}&limit=2000`,
      { headers: cab(tok) });
    if (!(origem || []).length) return res.status(400).json({ erro: `Não há orçamento em ${de} para copiar.` });
    await supa(`${base("fin_orcamento")}?competencia=eq.${comp}`, { method: "DELETE", headers: cab(tok) });
    const novas = origem.map((o) => ({ competencia: comp, categoria_id: o.categoria_id, linha: o.linha, valor: o.valor }));
    const r = await supa(base("fin_orcamento"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(novas) });
    if (!Array.isArray(r)) return recusado(res);
    return res.status(200).json({ ok: true, copiadas: r.length, de });
  }

  if (req.method !== "GET") { res.setHeader("Allow", "GET, PUT, POST"); return res.status(405).json({ erro: "Use GET, PUT ou POST." }); }

  const [cats, orc] = await Promise.all([categoriasDoFechamento(tok), orcamentoDoMes(tok, comp)]);
  const { real, semCategoria, vendidos, rent } = await realizadoDoMes(tok, comp, cats);
  const prev = orc.livres;
  const vPrev = prev.veiculos || 0;
  const tPrev = prev.ticket || 0;

  // Despesa vem negativa de partesDe(); aqui ela é custo, e custo se
  // lê positivo. O sinal volta na hora de somar o resultado.
  const monta = (tipo) => (cats || []).filter((c) => c.tipo_custo === tipo && c.no_dre)
    .map((c) => ({ id: c.id, nome: c.nome, grupo: c.grupo, ordem: c.ordem,
                   previsto: orc.porCat[c.id] || 0, realizado: -(real[c.id] || 0) }))
    .filter((x) => x.previsto || x.realizado);

  const variaveis = monta("variavel");
  const fixas = monta("fixa");
  const receitas = (cats || []).filter((c) => c.tipo_custo === "receita")
    .map((c) => ({ id: c.id, nome: c.nome, previsto: orc.porCat[c.id] || 0, realizado: real[c.id] || 0 }))
    .filter((x) => x.previsto || x.realizado);

  const soma = (a) => a.reduce((t, x) => ({ previsto: t.previsto + x.previsto, realizado: t.realizado + x.realizado }), { previsto: 0, realizado: 0 });
  const totVar = soma(variaveis), totFix = soma(fixas), totOut = soma(receitas);

  const faturamento = { previsto: vPrev * tPrev, realizado: rent };
  const receita = { previsto: faturamento.previsto + totOut.previsto, realizado: faturamento.realizado + totOut.realizado };
  const margem = { previsto: receita.previsto - totVar.previsto, realizado: receita.realizado - totVar.realizado };
  const resultado = { previsto: margem.previsto - totFix.previsto, realizado: margem.realizado - totFix.realizado };

  return res.status(200).json({
    competencia: comp,
    veiculos: { previsto: vPrev, realizado: vendidos.length },
    ticket: { previsto: tPrev, realizado: vendidos.length ? rent / vendidos.length : 0 },
    faturamento, outras_receitas: totOut, outras_linhas: receitas, receita,
    variaveis, total_variaveis: totVar, margem,
    fixas, total_fixas: totFix, resultado,
    sem_categoria: semCategoria,
    categorias: (cats || []).filter((c) => c.no_dre && c.tipo_custo !== "fora")
      .map((c) => ({ id: c.id, nome: c.nome, tipo_custo: c.tipo_custo, ordem: c.ordem })),
  });
}

/**
 * ===== o ano =====
 *
 * A aba FLUXO DE CAIXA da planilha do Derek (24/10/2026): os doze
 * meses lado a lado, na ordem do fechamento — receita, variáveis,
 * margem de contribuição, fixas, resultado — e embaixo as retiradas
 * dos sócios e o acumulado. O Fechamento responde "como foi este mês";
 * o Ano responde "como este mês se compara aos outros", que é a
 * pergunta que a planilha existe para responder.
 *
 * **É o mesmo realizado do Fechamento, mês a mês** (`realizadoDoMes`),
 * e não uma conta nova: a coluna de setembro aqui e o realizado de
 * setembro lá têm que ser o mesmo número.
 *
 * **Mês que ainda não chegou não é consultado.** Doze idas ao banco
 * para devolver zero seriam metade das subrequisições do Worker gastas
 * em nada — e o zero de novembro, na planilha, é célula vazia.
 */
async function ano(req, res, tok) {
  const hoje = hojeAqui();
  const a = /^\d{4}$/.test(String(req.query.ano || "")) ? Number(req.query.ano) : Number(hoje.slice(0, 4));
  const meses = Array.from({ length: 12 }, (_, i) => `${a}-${String(i + 1).padStart(2, "0")}-01`);
  const atual = competenciaDe(hoje);
  const cats = await categoriasDoFechamento(tok);
  const porMes = {};
  await Promise.all(meses.filter((m) => m <= atual).map(async (m) => { porMes[m] = await realizadoDoMes(tok, m, cats); }));

  // Despesa vem negativa de partesDe(); aqui ela é custo e se lê
  // positiva, como na planilha. O sinal volta no resultado.
  const linhasDe = (filtro, sinal, fonte) => cats.filter(filtro).map((c) => {
    const por_mes = {};
    meses.forEach((m) => { if (porMes[m]) por_mes[m] = sinal * ((porMes[m][fonte] || {})[c.id] || 0); });
    return { id: c.id, nome: c.nome, por_mes };
  }).filter((l) => Object.keys(l.por_mes).some((m) => Math.abs(l.por_mes[m]) > 0.004));
  const variaveis = linhasDe((c) => c.no_dre && c.tipo_custo === "variavel", -1, "real");
  const fixas = linhasDe((c) => c.no_dre && c.tipo_custo === "fixa", -1, "real");
  const outras = linhasDe((c) => c.no_dre && c.tipo_custo === "receita", 1, "real");
  const retiradas = linhasDe((c) => c.grupo === "retirada", -1, "retiradas");

  const somaLinhas = (ls) => { const t = {}; meses.forEach((m) => { if (porMes[m]) t[m] = ls.reduce((s, l) => s + (l.por_mes[m] || 0), 0); }); return t; };
  const mapa = (f) => { const t = {}; meses.forEach((m) => { if (porMes[m]) t[m] = f(m); }); return t; };
  const veiculos = mapa((m) => porMes[m].vendidos.length);
  const faturamento = mapa((m) => porMes[m].rent);
  const totOut = somaLinhas(outras), totVar = somaLinhas(variaveis), totFix = somaLinhas(fixas), totRet = somaLinhas(retiradas);
  const receita = mapa((m) => faturamento[m] + totOut[m]);
  const margem = mapa((m) => receita[m] - totVar[m]);
  const resultado = mapa((m) => margem[m] - totFix[m]);
  const aposRetiradas = mapa((m) => resultado[m] - totRet[m]);
  let corrido = 0;
  const acumulado = mapa((m) => (corrido += aposRetiradas[m]));
  const semCategoria = mapa((m) => porMes[m].semCategoria);

  return res.status(200).json({
    ano: a, meses, ate: meses.filter((m) => porMes[m]).pop() || null,
    veiculos, faturamento, outras, total_outras: totOut, receita,
    variaveis, total_variaveis: totVar, margem, fixas, total_fixas: totFix, resultado,
    retiradas, total_retiradas: totRet, apos_retiradas: aposRetiradas, acumulado, sem_categoria: semCategoria,
  });
}

/**
 * ===== o recibo =====
 *
 * O financeiro registrava o dinheiro e não emitia o papel — e é o
 * papel que a outra ponta pede: o cliente que recebeu o PIX da venda,
 * o despachante que foi pago, o lojista que pagou pelo carro.
 *
 * **A direção sai do lançamento, não de quem emite.** Crédito é a
 * Vaapty quem recebe; débito é a Vaapty quem paga. Deixar essa escolha
 * na tela é como se assina recibo invertido, e recibo invertido é
 * prova contra quem o emitiu.
 *
 * **Os dados são congelados na emissão.** O recibo prova o que foi
 * dito NAQUELE dia: corrigir depois o nome do favorecido não pode
 * mudar a via que está na mão da pessoa. Por isso a 0042 guarda valor,
 * nome, documento e referência em colunas próprias, em vez de ler o
 * lançamento na hora de olhar.
 *
 * **O número é sequencial por ano, e a rede é o índice único.** Duas
 * pessoas emitindo no mesmo segundo pegariam o mesmo `max + 1`; o
 * `unique_violation` faz a segunda tentar de novo.
 *
 * O HTML vem da TELA, como todo documento desta casa (decisão 7): o
 * servidor não desenha papel, só registra o que foi impresso.
 */
async function recibo(req, res, tok) {
  if (req.method === "GET") {
    const lid = String(req.query.lancamento_id || "");
    if (!RX_ID.test(lid)) return res.status(400).json({ erro: "lancamento_id inválido." });
    const lista = await supa(
      `${base("fin_recibo")}?select=id,numero,ano,valor,direcao,outra_parte,protocolo,emitido_em` +
      `&lancamento_id=eq.${lid}&order=emitido_em.desc`,
      { headers: cab(tok) },
    );
    return res.status(200).json({ recibos: lista || [] });
  }
  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ erro: "Use GET ou POST." }); }

  const c = await corpoDe(req);
  const lid = String((c && c.lancamento_id) || "");
  if (!RX_ID.test(lid)) return res.status(400).json({ erro: "lancamento_id inválido." });

  // O lançamento vem do banco pelo token de quem pediu: é a RLS da
  // 0021 que decide se esta pessoa enxerga o financeiro. Aceitar valor
  // e nome pelo corpo deixaria emitir recibo de qualquer quantia.
  const achado = await supa(
    `${base("fin_lancamento")}?select=id,data,debito,credito,descricao,` +
    `favorecido:fin_favorecido(nome,documento),funcionario:fin_funcionario(nome)&id=eq.${lid}&limit=1`,
    { headers: cab(tok) },
  );
  const l = (achado || [])[0];
  if (!l) return res.status(404).json({ erro: "Lançamento não encontrado." });

  const valor = Number(l.credito) > 0 ? Number(l.credito) : Number(l.debito);
  if (!(valor > 0)) return res.status(400).json({ erro: "Lançamento sem valor." });

  const parte = texto(c && c.outra_parte)
    || (l.favorecido && l.favorecido.nome)
    || (l.funcionario && l.funcionario.nome);
  if (!parte) {
    return res.status(400).json({
      erro: "O recibo precisa do nome da outra parte. Preencha o favorecido do lançamento ou digite o nome.",
    });
  }

  const linha = {
    lancamento_id: lid,
    ano: new Date().getFullYear(),
    valor,
    direcao: Number(l.credito) > 0 ? "recebemos" : "pagamos",
    outra_parte: parte,
    outra_parte_doc: texto(c && c.outra_parte_doc) || (l.favorecido && l.favorecido.documento) || null,
    referente: texto(c && c.referente) || texto(l.descricao),
    emitido_em_data: l.data,
    // `conteudo` fica nulo, e é decisão: a tela só sabe montar o HTML
    // DEPOIS de conhecer o número, que nasce aqui. Um segundo PATCH
    // para guardar o papel pediria política de update numa tabela que
    // é registro, não rascunho. O que prova o recibo é a linha —
    // número, valor, partes e data congelados —, e o HTML se remonta
    // igual a partir dela.
  };

  // Três tentativas: o número é `max + 1` e o índice único da 0042 é
  // quem arbitra quando dois emitem junto.
  for (let i = 0; i < 3; i++) {
    const n = await supa(`${base("rpc/proximo_recibo")}`, {
      method: "POST", headers: cab(tok), body: JSON.stringify({ p_ano: linha.ano }),
    });
    try {
      const numero = Number(n) || 1;
      const gravado = await supa(base("fin_recibo"), {
        method: "POST", headers: cab(tok, REP),
        // O protocolo é o próprio número: ele já é único por ano pelo
        // índice da 0042, e "RECIBO-2026-0007" é legível ao telefone,
        // o que um hash de timestamp não é.
        body: JSON.stringify({ ...linha, numero, protocolo: `RECIBO-${linha.ano}-${String(numero).padStart(4, "0")}` }),
      });
      const r0 = Array.isArray(gravado) ? gravado[0] : gravado;
      // Vazio é a RLS recusando: quem não é do financeiro não emite.
      if (!r0) return res.status(403).json({ erro: "Você não tem acesso ao financeiro." });
      return res.status(200).json({ recibo: r0 });
    } catch (e) {
      if (i === 2) throw e;
    }
  }
}

/* ------------------ recebimentos (0067) ------------------ */

/**
 * Toda venda tem que aparecer no extrato.
 *
 *   GET    ?competencia=            as vendas do mês, o que entrou de cada uma, e sugestões
 *   GET    ?estoque_id=             os créditos livres perto daquela venda, para casar à mão
 *   POST   ?acao=automatico         casa sozinho o que é inequívoco
 *   POST   ?acao=casar              { estoque_id, lancamento_ids }  — e aprende o pagador
 *   POST   ?acao=explicar           { estoque_id, explicacao, valor? }
 *   DELETE ?id=                     desfaz um casamento ou uma explicação
 *
 * **O automático só casa o que não tem como estar errado**: valor
 * exato E pagador reconhecido (pelo nome do comprador ou por um
 * casamento anterior), e nenhum outro candidato disputando — nem outro
 * crédito para a venda, nem outra venda para o crédito. O resto vira
 * sugestão, que a pessoa confirma. Casamento errado esconde venda não
 * recebida atrás de um "ok" verde, e esse é o erro que esta tela
 * existe para pegar; deixar passar só custa um clique.
 *
 * A data da venda importada é a da COMPRA (decisão 25), e o lojista
 * paga quando revende — por isso a janela vai de uma semana antes a
 * 75 dias depois.
 */
const JANELA_ANTES = 7, JANELA_DEPOIS = 75;
const somaDias = (d, n) => {
  const [a, m, x] = String(d).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, x) + n * 86400000).toISOString().slice(0, 10);
};
const igual = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.01;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/* O que não identifica ninguém: forma jurídica, ramo, a palavra do
 * banco e os sobrenomes mais comuns do Brasil. "ANDERSON - UNIAUTO" e
 * "SAVYON ESLEY OLIVEIRA MAIA" não podem casar com um PIX só porque
 * alguém nele se chama Oliveira. */
const NAO_IDENTIFICA = new Set((
  // "AUTOMOVEIS" entrou no primeiro dia de uso: "Pereira Automóveis"
  // aparecia como sugestão para "Mariol - Auto Dan Automóveis".
  "LTDA EIRELI EPP VEICULOS VEICULO AUTO AUTOS CAR CARS MOTORS MOTOS MULTIMARCAS COMERCIO COM " +
  "AUTOMOVEIS AUTOMOVEL AUTOMOTORES AUTOMOTIVA CARROS CARRO COMPRA VENDA LOJA GARAGEM SEMINOVOS QRS " +
  "DAS DOS PIX RECEBIDO RECEBIMENTOS RECEBIMENTO TED DOC TRANSF TRANSFERENCIA BOLETOS BOLETO " +
  "DEPOSITO ASSUMIU JUNIOR FILHO NETO SOBRINHO SILVA SOUZA SOUSA SANTOS OLIVEIRA PEREIRA LIMA " +
  "COSTA FERREIRA RODRIGUES ALVES GOMES MARTINS ROCHA RIBEIRO CARVALHO ALMEIDA LOPES SOARES " +
  "VIEIRA BARBOSA").split(" "));
const tokensDe = (t) => new Set(String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toUpperCase().replace(/[^A-Z]+/g, " ").split(" ")
  .filter((x) => x.length >= 3 && !NAO_IDENTIFICA.has(x)));
const cruza = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };
// Linha que o banco imprime e não é dinheiro de ninguém.
const NAO_E_PAGAMENTO = /^(saldo|rend(imentos)? pago|res aplic|aplic)/i;

async function dadosRecebimento(tok, de, ate) {
  const cDe = somaDias(de, -JANELA_ANTES), cAte = somaDias(ate, JANELA_DEPOIS);
  const [vendas, creditos] = await Promise.all([
    supa(`${base("estoque")}?select=id,natureza,entrou_em,vendido_em,valor_venda,negociador_nome,` +
      `comprador(id,nome),veiculo(placa,marca_modelo),` +
      `fin_recebimento(id,valor,modo,explicacao,lancamento_id,criado_em,fin_lancamento(data,descricao,credito))` +
      `&situacao=eq.vendido&or=(and(vendido_em.gte.${de},vendido_em.lte.${ate}),and(vendido_em.is.null,entrou_em.gte.${de},entrou_em.lte.${ate}))` +
      `&order=entrou_em.asc&limit=2000`, { headers: cab(tok) }),
    supa(`${base("fin_lancamento")}?select=id,data,credito,descricao,favorecido_id,categoria_id,fin_recebimento(valor,estoque_id)` +
      `&situacao=eq.efetivado&credito=gt.0&data=gte.${cDe}&data=lte.${cAte}&order=data.asc&limit=20000`, { headers: cab(tok) }),
  ]);
  const compIds = Array.from(new Set((vendas || []).map((e) => e.comprador && e.comprador.id).filter(Boolean)));
  const pags = compIds.length
    ? await supa(`${base("fin_pagador")}?select=comprador_id,favorecido_id&comprador_id=in.(${compIds.join(",")})`, { headers: cab(tok) })
    : [];
  const pagadores = {};
  (pags || []).forEach((p) => { (pagadores[p.comprador_id] = pagadores[p.comprador_id] || new Set()).add(p.favorecido_id); });

  const cred = (creditos || [])
    .filter((c) => !NAO_E_PAGAMENTO.test(String(c.descricao || "").trim()))
    .map((c) => {
      const usado = (c.fin_recebimento || []).reduce((t, x) => t + (Number(x.valor) || 0), 0);
      return { id: c.id, data: c.data, valor: Number(c.credito) || 0, livre: r2((Number(c.credito) || 0) - usado),
        descricao: c.descricao, favorecido_id: c.favorecido_id, categoria_id: c.categoria_id, tokens: tokensDe(c.descricao) };
    });
  const vend = (vendas || []).map((e) => {
    const recs = e.fin_recebimento || [];
    const recebido = recs.filter((x) => x.lancamento_id).reduce((t, x) => t + (Number(x.valor) || 0), 0);
    const explicado = recs.filter((x) => !x.lancamento_id).reduce((t, x) => t + (Number(x.valor) || 0), 0);
    const valor = Number(e.valor_venda) || 0;
    const comp = e.comprador || {};
    return {
      id: e.id, natureza: e.natureza || "compra", base: e.vendido_em || e.entrou_em, valor,
      recebido: r2(recebido), explicado: r2(explicado), falta: r2(Math.max(0, valor - recebido - explicado)),
      comprador_id: comp.id || null, comprador: comp.nome || null, tokens: tokensDe(comp.nome),
      placa: e.veiculo && e.veiculo.placa, carro: e.veiculo && e.veiculo.marca_modelo, negociador: e.negociador_nome,
      recebimentos: recs.map((x) => ({ id: x.id, valor: Number(x.valor) || 0, modo: x.modo, explicacao: x.explicacao,
        em: x.criado_em, lancamento: x.lancamento_id ? { id: x.lancamento_id, ...(x.fin_lancamento || {}) } : null })),
    };
  });
  return { vend, cred, pagadores };
}

function motorRecebimento({ vend, cred, pagadores }) {
  const naJanela = (v, c) => v.base && c.data >= somaDias(v.base, -JANELA_ANTES) && c.data <= somaDias(v.base, JANELA_DEPOIS);
  const reconhece = (v, c) => {
    if (c.favorecido_id && pagadores[v.comprador_id] && pagadores[v.comprador_id].has(c.favorecido_id)) return "pagador";
    return v.tokens.size && cruza(v.tokens, c.tokens) ? "nome" : null;
  };
  const candidatos = (v) => cred.filter((c) => c.livre > 0.009 && naJanela(v, c));
  // Subconjuntos de 2 a 4 créditos que somam exatamente o que falta —
  // o lojista que paga um carro em dois PIX. Até 10 candidatos: 2^10
  // combinações, e passar disso já não é caso de máquina.
  const combos = (lista, alvo) => {
    const achados = [];
    if (lista.length < 2 || lista.length > 10) return achados;
    for (let m = 1; m < (1 << lista.length); m++) {
      let n = 0, s = 0; const sel = [];
      for (let i = 0; i < lista.length; i++) if (m & (1 << i)) { n++; s += lista[i].livre; sel.push(lista[i]); }
      if (n >= 2 && n <= 4 && igual(s, alvo)) achados.push(sel);
    }
    return achados;
  };
  const perfeito = (v) => {
    if (v.falta <= 0) return null;
    const C = candidatos(v).filter((c) => reconhece(v, c));
    const um = C.filter((c) => igual(c.livre, v.falta));
    if (um.length === 1) return um;
    if (um.length > 1) return null;
    const cs = combos(C, v.falta);
    return cs.length === 1 ? cs[0] : null;
  };
  const sugestoes = (v) => {
    if (v.falta <= 0) return [];
    const C = candidatos(v);
    const lista = C.map((c) => {
      const r = reconhece(v, c), exato = igual(c.livre, v.falta);
      const dias = Math.abs((Date.parse(c.data) - Date.parse(v.base)) / 86400000);
      return { c, r, exato, nota: (r === "pagador" ? 4 : r ? 3 : 0) + (exato ? 3 : 0) - dias / 60 };
    }).filter((x) => x.r || x.exato).sort((a, b) => b.nota - a.nota).slice(0, 3)
      .map((x) => ({
        ids: [x.c.id], valor: x.c.livre,
        motivo: [x.exato ? "valor exato" : "valor diferente", x.r === "pagador" ? "pagador já conhecido" : x.r ? "nome parecido" : "pagador desconhecido"].join(" · "),
        itens: [{ id: x.c.id, data: x.c.data, descricao: x.c.descricao, livre: x.c.livre }],
      }));
    combos(C.filter((c) => reconhece(v, c)), v.falta).slice(0, 2).forEach((sel) => lista.push({
      ids: sel.map((c) => c.id), valor: r2(sel.reduce((t, c) => t + c.livre, 0)), motivo: `${sel.length} créditos somam o valor exato · nome parecido`,
      itens: sel.map((c) => ({ id: c.id, data: c.data, descricao: c.descricao, livre: c.livre })),
    }));
    return lista;
  };
  return { perfeito, sugestoes, reconhece, naJanela };
}

// Casa sozinho o inequívoco e devolve quantas vendas casou.
async function casarAutomatico(tok, de, ate) {
  const dados = await dadosRecebimento(tok, de, ate);
  const { perfeito } = motorRecebimento(dados);
  const propostas = dados.vend.map((v) => [v, perfeito(v)]).filter((p) => p[1]);
  // Crédito disputado por duas vendas não vai para nenhuma.
  const uso = {};
  propostas.forEach(([, cs]) => cs.forEach((c) => { uso[c.id] = (uso[c.id] || 0) + 1; }));
  const limpas = propostas.filter(([, cs]) => cs.every((c) => uso[c.id] === 1));
  const linhas = [];
  limpas.forEach(([v, cs]) => cs.forEach((c) => linhas.push({ estoque_id: v.id, lancamento_id: c.id, valor: c.livre, modo: "auto" })));
  if (!linhas.length) return 0;
  await supa(base("fin_recebimento"), { method: "POST", headers: cab(tok), body: JSON.stringify(linhas) });
  await supa(`${URL_BASE}/rest/v1/rpc/fin_recebimento_categorizar`, { method: "POST", headers: cab(tok), body: "{}" });
  return limpas.length;
}

async function recebimentos(req, res, tok) {
  const acao = String(req.query.acao || "");

  if (req.method === "GET" && RX_ID.test(String(req.query.estoque_id || ""))) {
    // Os créditos livres em volta desta venda, para casar à mão quando
    // nem o nome nem o valor bateram.
    const eid = String(req.query.estoque_id);
    const e = um(await supa(`${base("estoque")}?select=id,entrou_em,vendido_em&id=eq.${eid}`, { headers: cab(tok) }));
    if (!e) return res.status(404).json({ erro: "Venda não encontrada." });
    const dia = e.vendido_em || e.entrou_em;
    const dados = await dadosRecebimento(tok, dia, dia);
    const v = dados.vend.find((x) => x.id === eid);
    const { naJanela } = motorRecebimento(dados);
    const livres = dados.cred.filter((c) => c.livre > 0.009 && (!v || naJanela(v, c)))
      .map((c) => ({ id: c.id, data: c.data, descricao: c.descricao, valor: c.valor, livre: c.livre }));
    if (v) livres.sort((a, b) => Math.abs(a.livre - v.falta) - Math.abs(b.livre - v.falta));
    return res.status(200).json({ creditos: livres.slice(0, 200) });
  }

  if (req.method === "GET") {
    const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
    const fim = fimDoMes(comp);
    const dados = await dadosRecebimento(tok, comp, fim);
    const { sugestoes, reconhece, naJanela } = motorRecebimento(dados);

    /* O outro lado: dinheiro de lojista que entrou no mês e não pagou
     * venda nenhuma. Sem esta lista, o PIX que pagou um carro de outro
     * mês — ou um carro que ninguém lançou no estoque — fica invisível,
     * e a venda dele aparece como não recebida para sempre. */
    const [todos, cats] = await Promise.all([
      supa(`${base("comprador")}?select=id,nome&limit=5000`, { headers: cab(tok) }),
      supa(`${base("fin_categoria")}?select=id,grupo`, { headers: cab(tok) }),
    ]);
    const tokComp = (todos || []).map((c) => tokensDe(c.nome)).filter((t) => t.size);
    const grupoDe = {}; (cats || []).forEach((c) => { grupoDe[c.id] = c.grupo; });
    const soltos = dados.cred.filter((c) => c.livre >= 300 && c.data >= comp && c.data <= fim &&
        (!c.categoria_id || grupoDe[c.categoria_id] === "negociacao") && tokComp.some((t) => cruza(t, c.tokens)))
      .map((c) => ({
        id: c.id, data: c.data, descricao: c.descricao, valor: c.valor, livre: c.livre,
        vendas: dados.vend.filter((v) => v.falta > 0 && naJanela(v, c) && reconhece(v, c)).map((v) => v.id),
      }));

    const vendas = dados.vend.map((v) => {
      const situacao = v.falta <= 0 ? (v.explicado > 0 && v.recebido < v.valor - 0.01 ? "explicado" : "recebido")
        : v.recebido > 0 || v.explicado > 0 ? "parcial" : "pendente";
      const { tokens, ...resto } = v;
      return { ...resto, situacao, sugestoes: sugestoes(v) };
    });
    const soma = (k) => r2(vendas.reduce((t, v) => t + v[k], 0));
    return res.status(200).json({
      competencia: comp, vendas, creditos_soltos: soltos,
      resumo: { vendas: vendas.length, valor: soma("valor"), recebido: soma("recebido"), explicado: soma("explicado"), falta: soma("falta"),
        pendentes: vendas.filter((v) => v.situacao === "pendente" || v.situacao === "parcial").length },
    });
  }

  if (req.method === "POST" && acao === "automatico") {
    const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
    const n = await casarAutomatico(tok, comp, fimDoMes(comp));
    return res.status(200).json({ casadas: n });
  }

  if (req.method === "POST" && (acao === "casar" || acao === "explicar")) {
    const c = await corpoDe(req);
    const eid = String((c && c.estoque_id) || "");
    if (!RX_ID.test(eid)) return res.status(400).json({ erro: "estoque_id inválido." });
    const e = um(await supa(`${base("estoque")}?select=id,valor_venda,comprador_id,fin_recebimento(valor)&id=eq.${eid}`, { headers: cab(tok) }));
    if (!e) return res.status(404).json({ erro: "Venda não encontrada." });
    let falta = r2((Number(e.valor_venda) || 0) - (e.fin_recebimento || []).reduce((t, x) => t + (Number(x.valor) || 0), 0));
    if (falta <= 0) return res.status(409).json({ erro: "Esta venda já está toda recebida ou explicada." });

    if (acao === "explicar") {
      const explicacao = texto(c.explicacao);
      if (!explicacao) return res.status(400).json({ erro: "Diga por que esta venda não aparece no extrato." });
      const valor = c.valor == null || c.valor === "" ? falta : r2(decimal(c.valor));
      if (!(valor > 0) || valor > falta + 0.01) return res.status(400).json({ erro: `O valor explicado vai de R$ 0,01 até o que falta (R$ ${falta.toLocaleString("pt-BR")}).` });
      await supa(base("fin_recebimento"), { method: "POST", headers: cab(tok),
        body: JSON.stringify({ estoque_id: eid, valor, modo: "explicado", explicacao }) });
      return res.status(201).json({ ok: true });
    }

    const ids = (Array.isArray(c.lancamento_ids) ? c.lancamento_ids : []).filter((x) => RX_ID.test(String(x)));
    if (!ids.length) return res.status(400).json({ erro: "Escolha ao menos um crédito do extrato." });
    const lancs = await supa(`${base("fin_lancamento")}?select=id,credito,favorecido_id,fin_recebimento(valor,estoque_id)` +
      `&id=in.(${ids.join(",")})&situacao=eq.efetivado&credito=gt.0`, { headers: cab(tok) });
    const linhas = [];
    // Na ordem em que a pessoa escolheu; o crédito maior que o que falta
    // entra só com o que falta, e o resto dele fica livre para o outro
    // carro que ele também pagou.
    ids.forEach((id) => {
      const l = (lancs || []).find((x) => x.id === id);
      if (!l || falta <= 0) return;
      if ((l.fin_recebimento || []).some((x) => x.estoque_id === eid)) return;
      const livre = r2((Number(l.credito) || 0) - (l.fin_recebimento || []).reduce((t, x) => t + (Number(x.valor) || 0), 0));
      const valor = r2(Math.min(livre, falta));
      if (valor <= 0) return;
      linhas.push({ estoque_id: eid, lancamento_id: id, valor, modo: "manual" });
      falta = r2(falta - valor);
    });
    if (!linhas.length) return res.status(409).json({ erro: "Esses créditos já foram usados inteiros em outras vendas." });
    await supa(base("fin_recebimento"), { method: "POST", headers: cab(tok), body: JSON.stringify(linhas) });

    // O aprendizado: este CNPJ/CPF paga por este comprador. Na próxima
    // venda dele, o automático já reconhece.
    let aprendeu = 0;
    const favs = Array.from(new Set((lancs || []).filter((l) => linhas.some((x) => x.lancamento_id === l.id))
      .map((l) => l.favorecido_id).filter(Boolean)));
    if (e.comprador_id && favs.length) {
      const r = await supa(`${base("fin_pagador")}?on_conflict=comprador_id,favorecido_id`, {
        method: "POST", headers: cab(tok, { Prefer: "resolution=ignore-duplicates,return=representation" }),
        body: JSON.stringify(favs.map((f) => ({ comprador_id: e.comprador_id, favorecido_id: f }))),
      });
      aprendeu = (r || []).length;
    }
    await supa(`${URL_BASE}/rest/v1/rpc/fin_recebimento_categorizar`, { method: "POST", headers: cab(tok), body: "{}" });
    return res.status(201).json({ ok: true, casados: linhas.length, falta, aprendeu });
  }

  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const r = await supa(`${base("fin_recebimento")}?id=eq.${id}`, { method: "DELETE", headers: cab(tok, REP) });
    if (!um(r)) return res.status(403).json({ erro: "Não achei esse casamento, ou a regra do banco recusou." });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ erro: "Use GET, POST ou DELETE." });
}

/**
 * O saldo de hoje de cada conta (0070): abertura + o que se moveu desde
 * ela, pela mesma régua da lista de lançamentos (decisão 58). É o que a
 * tela "Contas e caixas" mostra ao lado de cada uma — quanto tem na
 * gaveta, quanto tem na casa do Derek, quanto tem no banco.
 */
async function saldos(req, res, tok) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ erro: "Use GET." }); }
  const hoje = hojeAqui();
  const [contas, movs] = await Promise.all([
    supa(`${base("fin_conta")}?select=id,saldo_inicial,saldo_inicial_em`, { headers: cab(tok) }),
    supa(`${base("fin_lancamento")}?select=conta_id,data,debito,credito&situacao=eq.efetivado&conta_id=not.is.null&data=lte.${hoje}&limit=100000`, { headers: cab(tok) }),
  ]);
  const por = {};
  (contas || []).forEach((c) => {
    por[c.id] = { saldo: Number(c.saldo_inicial) || 0, inicio: c.saldo_inicial_em ? String(c.saldo_inicial_em).slice(0, 10) : "", ultimo: null };
  });
  (movs || []).forEach((m) => {
    const c = por[m.conta_id];
    if (!c || (c.inicio && String(m.data) < c.inicio)) return;
    c.saldo += (Number(m.credito) || 0) - (Number(m.debito) || 0);
    if (!c.ultimo || m.data > c.ultimo) c.ultimo = m.data;
  });
  const out = {};
  Object.keys(por).forEach((k) => { out[k] = { saldo: r2(por[k].saldo), ultimo_movimento: por[k].ultimo }; });
  return res.status(200).json({ hoje, saldos: out });
}

async function estoqueLista(req, res, tok) {
  const lista = await supa(`${base("estoque")}?select=id,situacao,veiculo(placa,marca_modelo)&order=entrou_em.desc&limit=400`, { headers: cab(tok) });
  return res.status(200).json({ estoque: (lista || []).map((e) => ({ id: e.id, situacao: e.situacao, placa: e.veiculo && e.veiculo.placa, carro: e.veiculo && e.veiculo.marca_modelo })) });
}

/**
 * Pendências: o que pede ação, num lugar só (11/10/2026).
 *
 * As conferências moram numa função do banco (0066), não aqui: são oito
 * contagens sobre milhares de linhas, e trazê-las para o Node só para
 * contar seria mandar meio megabyte a cada abertura da tela. A função é
 * `security invoker` — roda com a RLS de quem chama — e recusa quem não
 * é do financeiro em vez de devolver zeros, porque um painel que diz
 * "nada pendente" a quem não enxerga nada é a leitura errada mais cara.
 */
async function pendencias(req, res, tok) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ erro: "Use GET." }); }
  const r = await supa(`${URL_BASE}/rest/v1/rpc/fin_pendencias`, { method: "POST", headers: cab(tok), body: "{}" });
  /* VENDA SEM RECEBIMENTO, nos últimos 90 dias (0067). Antes de contar,
   * casa o inequívoco: sem isso o cartão acusaria como pendente o que a
   * máquina resolveria sozinha, e o painel mentiria para mais. Dez dias
   * de carência porque o lojista paga quando revende — venda de ontem
   * sem PIX é o normal, não pendência.
   *
   * Falhar aqui não derruba as outras oito conferências. */
  let vsr = null;
  try {
    const hoje = hojeAqui(), de = somaDias(hoje, -90);
    await casarAutomatico(tok, de, hoje);
    const { vend } = await dadosRecebimento(tok, de, hoje);
    const limite = somaDias(hoje, -10);
    const pend = vend.filter((v) => v.falta > 0 && v.base <= limite).sort((a, b) => (a.base < b.base ? -1 : 1));
    vsr = {
      qtd: pend.length, valor: r2(pend.reduce((t, v) => t + v.falta, 0)),
      itens: pend.slice(0, 5).map((v) => ({ data: v.base, comprador: v.comprador, placa: v.placa, falta: v.falta })),
    };
  } catch (e) { vsr = null; }
  return res.status(200).json({ ...(r || {}), vendas_sem_receber: vsr });
}

/* ------------------ o combinado de cada um, contra o mês (0081) ------------------
 *
 * O Derek, em 27/10/2026: *"na projeção do DRE mostrar automaticamente
 * qual seria o salário dele projetado de acordo com o resultado dele até
 * ali"*. A regra mora em `regras/remuneracao.js`; aqui só se juntam as
 * métricas do mês e se aplica o combinado de cada ficha.
 *
 * **Quem é "próprio"** é o nome da META ligada à ficha (`negociador`),
 * mais os apelidos escritos no combinado ("THIAGO SOUZA" da planilha).
 * Nome parecido não casa sozinho — a mesma régua da decisão 44.
 *
 * **Duas colunas: até agora e no ritmo.** O mês aberto mostra o que já
 * foi conquistado e, ao lado, as somas esticadas até o fim do mês no
 * mesmo passo — aritmética, não previsão (decisão 22). Mês fechado
 * tem as duas iguais. */
async function remuneracao(req, res, tok) {
  const comp = competenciaDe(req.query.competencia) || competenciaDe(hojeAqui());
  return res.status(200).json(await projecaoRemuneracao(tok, comp));
}
/* A CONTA DO COMBINADO DO MÊS, para a folha projetada do DRE e para a
 * Folha (28/10/2026, o Derek: "essa folha aqui deveria puxar o que
 * cadastramos no perfil de cada colaborador"). Um lugar só: duas contas
 * do mesmo salário dariam dois salários. */
async function projecaoRemuneracao(tok, comp) {
  const R = require("../regras/remuneracao.js");
  const fim = fimDoMes(comp);
  const chave = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

  const [colabs, negs, vendidos, ats, dreMes, perfis] = await Promise.all([
    supa(`${base("colaborador")}?select=id,nome_completo,perfil_id,negociador_id,desligado_em,inicio_em,remuneracao`, { headers: cab(tok) }),
    supa(`${base("negociador")}?select=id,nome`, { headers: cab(tok) }),
    supa(`${base("estoque")}?select=valor_compra,valor_venda,negociador_nome,vendido_em,semana_venda,estoque_custo(tipo,previsto,realizado)` +
      `&situacao=eq.vendido&or=(and(vendido_em.gte.${comp},vendido_em.lte.${fim}),and(vendido_em.is.null,entrou_em.gte.${comp},entrou_em.lte.${fim}))&limit=2000`,
      { headers: cab(tok) }),
    supa(`${base("atendimento")}?select=negociador_nome,status,data&data=gte.${comp}&data=lte.${fim}&limit=5000`, { headers: cab(tok) }),
    dreDoMes(tok, comp),
    supa(`${base("perfil_remuneracao")}?select=id,nome,remuneracao`, { headers: cab(tok) }).catch(() => []),
  ]);
  const perfilPor = {}; (perfis || []).forEach((x) => { perfilPor[x.id] = x; });
  const nomeNeg = {}; (negs || []).forEach((n) => { nomeNeg[n.id] = n.nome; });

  // Por nome: carros e rentabilidade (estoque), atendimentos e fechados —
  // no mês, em cada semana e na 1ª quinzena (o bônus por período). A
  // semana é a da planilha: `semana_venda` quando a importação a trouxe,
  // senão dias 1–7, 8–14… (o `semanaDe` da tela). A quinzena é do dia 1
  // ao 15; carro importado só com a semana conta nela até a semana 2.
  const zero = () => ({ carros: 0, rent: 0, fluxo: 0, fechados: 0 });
  const novo = () => ({ mes: zero(), sem: [zero(), zero(), zero(), zero()], q1: zero() });
  const por = {};
  const de = (nome) => { const k = chave(nome) || "—"; return por[k] || (por[k] = novo()); };
  const L = novo();
  // As quatro semanas do mês: 1–8, 9–15, 16–22, 23–fim (a regra mora em
  // `regras/remuneracao.js`, ao lado do bônus que a usa).
  const semDoDia = R.semanaDoDia;
  (vendidos || []).forEach((e) => {
    const r = rentabilidadeDe(e).liquida;
    const dia = Number(String(e.vendido_em || "").slice(8, 10)) || null;
    const sem = R.semanaDaPlanilha(Number(e.semana_venda)) || semDoDia(dia);
    const naQ1 = dia ? dia <= 15 : (sem ? sem <= 2 : false);
    [de(e.negociador_nome), L].forEach((P) => {
      P.mes.carros += 1; P.mes.rent += r;
      if (sem) { P.sem[sem - 1].carros += 1; P.sem[sem - 1].rent += r; }
      if (naQ1) { P.q1.carros += 1; P.q1.rent += r; }
    });
  });
  (ats || []).forEach((a) => {
    const dia = Number(String(a.data || "").slice(8, 10)) || null;
    const sem = semDoDia(dia);
    const f = a.status === "fechado" ? 1 : 0;
    [de(a.negociador_nome), L].forEach((P) => {
      P.mes.fluxo += 1; P.mes.fechados += f;
      if (sem) { P.sem[sem - 1].fluxo += 1; P.sem[sem - 1].fechados += f; }
      if (dia && dia <= 15) { P.q1.fluxo += 1; P.q1.fechados += f; }
    });
  });
  const loja = L.mes;

  // O ritmo: dias do mês sobre dias passados, só no mês aberto.
  const hoje = hojeAqui();
  const diasMes = Number(fim.slice(8, 10));
  const aberto = hoje >= comp && hoje <= fim;
  const fator = aberto ? diasMes / Math.max(1, Number(hoje.slice(8, 10))) : 1;

  const pessoas = (colabs || []).filter((c) => c.remuneracao && ((c.remuneracao.pecas || []).length || perfilPor[c.remuneracao.perfil_id]))
    .filter((c) => !c.desligado_em || c.desligado_em >= comp)
    .map((c) => {
      const plano = c.remuneracao;
      const nomes = [nomeNeg[c.negociador_id]].concat(plano.apelidos || []).filter(Boolean).map(chave);
      const P = novo();
      const somar = (a, b) => Object.keys(a).forEach((x) => { a[x] += b[x]; });
      [...new Set(nomes)].forEach((k) => {
        const m = por[k]; if (!m) return;
        somar(P.mes, m.mes); somar(P.q1, m.q1); m.sem.forEach((w, i) => somar(P.sem[i], w));
      });
      const proprio = P.mes;
      const met = { proprio, loja, lucro: dreMes.lucro, sem: { proprio: P.sem, loja: L.sem }, q1: { proprio: P.q1, loja: L.q1 } };
      const perfil = perfilPor[plano.perfil_id] || null;
      const pp = perfil ? perfil.remuneracao : null;
      const agora = R.calcular(plano, met, pp);
      const ritmo = R.calcular(plano, R.noRitmo(met, fator, aberto ? Number(hoje.slice(8, 10)) : 0, diasMes), pp);
      return { colaborador_id: c.id, perfil_id: c.perfil_id, negociador_id: c.negociador_id,
               nome: c.nome_completo || nomeNeg[c.negociador_id] || "—", nomes_nas_vendas: nomes,
               perfil: perfil ? perfil.nome : null,
               proprio, agora, ritmo };
    })
    .sort((a, b) => b.agora.total - a.agora.total);

  return {
    competencia: comp, aberto, fator: Math.round(fator * 100) / 100,
    loja, lucro: dreMes.lucro, pessoas,
    total_agora: pessoas.reduce((t, p) => t + p.agora.total, 0),
    total_ritmo: pessoas.reduce((t, p) => t + p.ritmo.total, 0),
  };
}

// Perfis de remuneração (0082): o cadastro genérico, com o combinado
// passando pela mesma limpeza da ficha.
const perfilRemuneracao = cadastro("perfil_remuneracao", [["nome", texto], ["descricao", texto],
  ["remuneracao", (v) => require("../regras/remuneracao.js").limpar(v)], ["ativo", bool]], "nome.asc");

const RECURSOS = { conta, categoria, funcionario, favorecido, lancamento, importar, dre, carros, vale, folha, remuneracao,
                   "contas-fixas": contasFixas,
                   "perfil-remuneracao": perfilRemuneracao,
                   fechamento, orcamento, ano, rateio, negociacao, titulo, fluxo, log, recibo, pendencias, recebimentos, saldos,
                   estoque: estoqueLista };

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });
  const r = RECURSOS[String(req.query.recurso || "")];
  if (!r) return res.status(404).json({ erro: "Recurso desconhecido." });
  try { return await r(req, res, tok); }
  catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
};
