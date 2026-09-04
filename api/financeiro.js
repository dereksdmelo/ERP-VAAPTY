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
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a operação.";
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

const conta = cadastro("fin_conta",
  [["nome", texto], ["banco", texto], ["empresa", texto], ["saldo_inicial", (v) => decimal(v) || 0],
   ["saldo_inicial_em", dataISO], ["ativa", bool]], "nome.asc");
const categoria = cadastro("fin_categoria",
  [["nome", texto], ["grupo", grupo], ["no_dre", bool], ["ordem", inteiro], ["ativa", bool]], "ordem.asc,nome.asc");
const funcionario = cadastro("fin_funcionario",
  [["nome", texto], ["salario_base", (v) => decimal(v) || 0], ["negociador_id", idOuNulo], ["ativo", bool]], "nome.asc");

/* ------------------ lançamentos ------------------ */

const TIPOS_NEG = ["pagto_cliente", "quitacao", "debitos", "pagto_lojista", "reembolso", "outro"];
const CAMPOS_LANC = "*,fin_categoria(id,nome,grupo,no_dre),estoque(id,veiculo(placa,marca_modelo)),fin_funcionario(id,nome)";

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
    const lista = await supa(
      `${base("fin_lancamento")}?select=${CAMPOS_LANC}${conta ? `&conta_id=eq.${conta}` : ""}${f}&order=data.asc,criado_em.asc&limit=2000`,
      { headers: cab(tok) });
    // O saldo que entra no mês: saldo inicial da conta + tudo antes.
    let saldoAnterior = null;
    if (conta && porData) {
      const ct = um(await supa(`${base("fin_conta")}?select=saldo_inicial,saldo_inicial_em&id=eq.${conta}`, { headers: cab(tok) }));
      const antes = await supa(`${base("fin_lancamento")}?select=debito,credito&conta_id=eq.${conta}&data=lt.${comp}&limit=100000`, { headers: cab(tok) });
      saldoAnterior = (ct ? Number(ct.saldo_inicial) || 0 : 0) +
        (antes || []).reduce((t, x) => t + (Number(x.credito) || 0) - (Number(x.debito) || 0), 0);
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
    return res.status(200).json({ competencia: comp, lancamentos: lista || [], saldo_anterior: saldoAnterior, sugestoes, truncado: (lista || []).length >= 2000 });
  }
  if (req.method === "POST") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const l = linhaLancamento(c, tok);
    if (!l.conta_id) return res.status(400).json({ erro: "Escolha a conta." });
    if (!l.data) return res.status(400).json({ erro: "Informe a data." });
    if (!l.competencia) l.competencia = competenciaDe(l.data);
    if (!(l.debito > 0) && !(l.credito > 0)) return res.status(400).json({ erro: "Informe débito ou crédito." });
    if (l.debito > 0 && l.credito > 0) return res.status(400).json({ erro: "Um lançamento é débito ou crédito, não os dois." });
    l.origem = "manual";
    const r = await supa(base("fin_lancamento"), { method: "POST", headers: cab(tok, REP), body: JSON.stringify(l) });
    if (!um(r)) return recusado(res);
    return res.status(201).json({ ok: true, lancamento: um(r) });
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

  let saldoInicial = null, saldoEm = null, invalidas = 0;
  const corpo = [];
  linhas.forEach((l) => {
    const data = dataISO(l.data);
    const deb = Math.abs(decimal(l.debito) || 0), cred = Math.abs(decimal(l.credito) || 0);
    const catNome = texto(l.categoria);
    if (/^saldo/i.test(catNome || "") || /saldo anterior/i.test(String(l.descricao || ""))) {
      saldoInicial = cred - deb; saldoEm = data; return;
    }
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
    corpo.push({
      conta_id: contaId, data, competencia: competenciaDe(l.competencia) || competenciaDe(data),
      categoria_id: catId, descricao: texto(l.descricao), debito: deb, credito: cred,
      estoque_id: placa ? estoquePorPlaca[placa] || null : null,
      tipo_negociacao: cat && cat.grupo === "negociacao" ? (tipoNegNa(l.descricao) || "outro") : null,
      conciliado: true, origem: fitid ? "ofx" : "planilha",
      chave_extrato: fitid
        ? `ofx:${fitid}|${data}|${deb}|${cred}`
        : `${data}|${String(l.descricao || "").trim().toLowerCase()}|${deb}|${cred}`,
    });
  });

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
  if (saldoInicial != null) {
    await supa(`${base("fin_conta")}?id=eq.${contaId}`, {
      method: "PATCH", headers: cab(tok), body: JSON.stringify({ saldo_inicial: saldoInicial, saldo_inicial_em: saldoEm }),
    });
  }
  return res.status(201).json({
    ok: true, inseridos, repetidos: corpo.length - inseridos, invalidas,
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
      supa(`${base("fin_conta")}?select=saldo_inicial&id=eq.${contaId}`, { headers: cab(tok) }),
      supa(`${base("fin_lancamento")}?select=debito,credito,conciliado&conta_id=eq.${contaId}&data=lte.${fimDoMes(comp)}&limit=100000`, { headers: cab(tok) }),
      supa(`${base("fin_fechamento")}?select=*&conta_id=eq.${contaId}&competencia=eq.${comp}`, { headers: cab(tok) }),
    ]);
    const saldoCalc = (um(ct) ? Number(um(ct).saldo_inicial) || 0 : 0) +
      (movs || []).reduce((t, x) => t + (Number(x.credito) || 0) - (Number(x.debito) || 0), 0);
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
  const lanc = await supa(
    `${base("fin_lancamento")}?select=debito,credito,competencia,fin_categoria(id,nome,grupo,no_dre,ordem)&competencia=gte.${meses[0]}&competencia=lte.${comp}&limit=100000`,
    { headers: cab(tok) });
  const cats = {}; const totais = {}; meses.forEach((x) => { totais[x] = 0; });
  (lanc || []).forEach((l) => {
    const c = l.fin_categoria; if (!c || !c.no_dre) return;
    const k = String(l.competencia).slice(0, 7) + "-01"; if (totais[k] === undefined) return;
    const v = (Number(l.credito) || 0) - (Number(l.debito) || 0);
    cats[c.id] = cats[c.id] || { id: c.id, nome: c.nome, ordem: c.ordem, por_mes: {} };
    cats[c.id].por_mes[k] = (cats[c.id].por_mes[k] || 0) + v; totais[k] += v;
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
  const lanc = await supa(
    `${base("fin_lancamento")}?select=debito,credito,fin_categoria(id,nome,grupo,no_dre,ordem)&competencia=eq.${comp}&limit=10000`,
    { headers: cab(tok) });
  const por = {};
  let semCategoria = 0;
  (lanc || []).forEach((l) => {
    const c = l.fin_categoria;
    if (!c) { semCategoria += (Number(l.credito) || 0) - (Number(l.debito) || 0); return; }
    if (!c.no_dre) return;
    por[c.id] = por[c.id] || { id: c.id, nome: c.nome, grupo: c.grupo, ordem: c.ordem, valor: 0 };
    // Como na planilha: DRE = crédito − débito, então despesa é negativa.
    por[c.id].valor += (Number(l.credito) || 0) - (Number(l.debito) || 0);
  });
  const linhas = Object.keys(por).map((k) => por[k]).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));
  const totalDespesas = linhas.reduce((t, x) => t + x.valor, 0);

  const vendidos = await vendidosNoMes(tok, comp);
  const rent = vendidos.reduce((t, e) => { const r = rentabilidadeDe(e); return { bruta: t.bruta + r.bruta, liquida: t.liquida + r.liquida, venda: t.venda + r.venda }; },
    { bruta: 0, liquida: 0, venda: 0 });

  return res.status(200).json({
    competencia: comp, linhas, total_despesas: totalDespesas, sem_categoria: semCategoria,
    carros_vendidos: vendidos.length, rentabilidade: rent.liquida, rentabilidade_bruta: rent.bruta, faturamento: rent.venda,
    lucro: rent.liquida + totalDespesas + semCategoria,
  });
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
  const lanc = ids.length
    ? await supa(`${base("fin_lancamento")}?select=id,estoque_id,tipo_negociacao,data,debito,credito,descricao&estoque_id=in.(${ids.join(",")})&order=data.asc`, { headers: cab(tok) })
    : [];
  const porEstoque = {};
  (lanc || []).forEach((l) => { (porEstoque[l.estoque_id] = porEstoque[l.estoque_id] || []).push(l); });

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
    const [funcs, gravadas, vales] = await Promise.all([
      supa(`${base("fin_funcionario")}?select=*&order=nome.asc`, { headers: cab(tok) }),
      supa(`${base("fin_folha")}?select=*&competencia=eq.${comp}`, { headers: cab(tok) }),
      supa(`${base("fin_vale")}?select=funcionario_id,valor&competencia=eq.${comp}`, { headers: cab(tok) }),
    ]);
    const gPor = {}; (gravadas || []).forEach((g) => { gPor[g.funcionario_id] = g; });
    const vPor = {}; (vales || []).forEach((v) => { vPor[v.funcionario_id] = (vPor[v.funcionario_id] || 0) + (Number(v.valor) || 0); });
    const linhas = (funcs || []).filter((f) => f.ativo || gPor[f.id]).map((f) => {
      const g = gPor[f.id];
      const salario = g ? Number(g.salario) : Number(f.salario_base) || 0;
      const comissao = g ? Number(g.comissao) : 0;
      const bonificacao = g ? Number(g.bonificacao) : 0;
      const valesSoma = vPor[f.id] || 0;
      return {
        funcionario_id: f.id, nome: f.nome, negociador_id: f.negociador_id, gravada: !!g,
        salario, comissao, bonificacao, vales: valesSoma,
        liquido: salario + comissao + bonificacao - valesSoma, pago_em: g ? g.pago_em : null,
      };
    });
    return res.status(200).json({ competencia: comp, folha: linhas });
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
async function estoqueLista(req, res, tok) {
  const lista = await supa(`${base("estoque")}?select=id,situacao,veiculo(placa,marca_modelo)&order=entrou_em.desc&limit=400`, { headers: cab(tok) });
  return res.status(200).json({ estoque: (lista || []).map((e) => ({ id: e.id, situacao: e.situacao, placa: e.veiculo && e.veiculo.placa, carro: e.veiculo && e.veiculo.marca_modelo })) });
}

const RECURSOS = { conta, categoria, funcionario, lancamento, importar, dre, carros, vale, folha, fechamento, estoque: estoqueLista };

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });
  const r = RECURSOS[String(req.query.recurso || "")];
  if (!r) return res.status(404).json({ erro: "Recurso desconhecido." });
  try { return await r(req, res, tok); }
  catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
};
