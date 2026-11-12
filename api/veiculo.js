/**
 * /api/veiculo
 *
 * POST — grava a ficha na tabela veiculo. Se já existe linha com a
 *        mesma placa e status em_avaliacao, atualiza aquela linha em
 *        vez de criar outra.
 * GET  — as 20 fichas mais recentes, só os campos de lista.
 *
 * SUPABASE_URL e SUPABASE_SERVICE_KEY vivem no ambiente. A chave de
 * serviço passa por cima do RLS: ela não pode sair daqui — nem em
 * resposta, nem em log. Todo texto que volta ao cliente passa por
 * limpar().
 *
 * Sem biblioteca: só a API REST do Supabase (PostgREST) via fetch.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_KEY || "";

const REST = () => `${URL_BASE}/rest/v1/veiculo`;
const ANON = process.env.SUPABASE_ANON_KEY || "";

/**
 * O token do usuário logado, repassado como veio. Quem valida é o
 * PostgREST: token inválido volta 401 e a gente devolve isso ao
 * cliente. Verificar assinatura aqui seria refazer, sem biblioteca, o
 * que o banco já faz.
 *
 * O token NÃO pode virar variável de módulo: duas requisições
 * simultâneas na mesma instância trocariam de usuário.
 */
const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const SEM_LOGIN = { erro: "Sessão expirada. Entre de novo." };

const cabecalhos = (tok, extra) => ({
  apikey: ANON,
  Authorization: tok,
  "Content-Type": "application/json",
  ...extra,
});

// Rede de segurança: se a chave aparecer em qualquer texto, some.
const limpar = (s) => {
  const t = String(s == null ? "" : s);
  return CHAVE ? t.split(CHAVE).join("[oculto]") : t;
};

/* ------------------ conversões tela → coluna ------------------ */

// A tela guarda "Novo"/"Bom"/"Médio"/"Fraco"; a coluna é o enum estado_pneu.
const PNEU = { novo: "novo", bom: "bom", "médio": "medio", medio: "medio", fraco: "fraco" };
const pneu = (v) => PNEU[String(v || "").trim().toLowerCase()] || null;

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};
const inteiro = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  const n = Number(s.replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
// Aceita o que o negociador digita: 51371, 51.371 e 51.371,50.
const decimal = (v) => {
  let s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
// Aceita array pronto ou o texto de várias linhas dos campos de observação.
const arranjo = (v) => {
  const a = Array.isArray(v) ? v : String(v == null ? "" : v).split("\n");
  return a.map((x) => String(x).trim()).filter(Boolean);
};

const normalizarPlaca = (v) => String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * A tela tem um campo só, "2019/2020"; o banco tem ano_fabricacao e
 * ano_modelo. Um valor sozinho vale para os dois.
 */
function anos(ano) {
  // "2014/2015", "2014-2015", "2014 2015" ou "20142015" (12/11/2026: o Fusion
  // digitado sem a barra virou o ano 20142015, e o Shinkai recusou o carro).
  let t = String(ano || "").trim();
  const d = t.replace(/\D/g, "");
  if (d.length === 8 && /^(19|20)\d{2}(19|20)\d{2}$/.test(d)) t = `${d.slice(0, 4)}/${d.slice(4)}`;
  const p = t.split(/[\/\-\s.]+/).filter(Boolean).map((x) => inteiro(x));
  if (p.length < 2) return { ano_fabricacao: p[0] || null, ano_modelo: p[0] || null };
  return { ano_fabricacao: p[0] || null, ano_modelo: p[1] || p[0] || null };
}

// De qual campo da tela veio cada coluna. Serve para não apagar no
// update o que a tela nem mandou — renavam, por exemplo, tem coluna
// mas ainda não tem campo.
const FONTE = {
  atendimento_id: "atendimento_id",
  placa: "placa", chassi: "chassi", renavam: "renavam", marca_modelo: "modelo",
  // As três partes do nome (0041). Vêm da fonte já separadas — da
  // consulta de placa ou da tabela FIPE oficial —, nunca de um corte
  // de `marca_modelo`: marca de duas palavras (Land Rover, Alfa Romeo)
  // quebra o corte, e é o mesmo tropeço da decisão 8.
  marca: "marca", modelo: "modeloCurto", versao: "versao",
  // Os três códigos da FIPE (0043): são eles que movem os seletores da
  // ficha do Shinkai. Vêm da conferência na tabela oficial, onde o
  // negociador escolheu marca, ano e modelo à mão.
  fipe_marca_codigo: "fipeMarcaCodigo", fipe_modelo_codigo: "fipeModeloCodigo",
  fipe_ano_codigo: "fipeAnoCodigo",
  // Em qual das três tabelas da FIPE os códigos acima valem (0045).
  tipo_veiculo: "tipoVeiculo",
  ano_fabricacao: "ano", ano_modelo: "ano", cor: "cor", combustivel: "combustivel",
  cambio: "cambio", km_atual: "km", km_entrada: "kmEntrada",
  fipe_codigo: "fipeCodigo", fipe_valor: "fipe",
  pneu_de: "pneus", pneu_dd: "pneus", pneu_te: "pneus", pneu_td: "pneus",
  leilao_sinistro: "leilao", gnv: "gnv", opcionais: "opcionais",
  detalhes_lataria: "lataria", detalhes_mecanica: "mecanica",
  pontos_positivos: "positivos", ressalvas_lojista: "ressalvas",
  observacoes_internas: "internas",
  gastos_descricao: "gastos", valor_por: "por",
  // A PEDIDA (0053): o que se pede ao lojista. Não é o `valor_por`,
  // que é o alvo. Sem entrada aqui, a coluna nunca seria gravada.
  preco_pedido: "pedida",
};
const somenteEnviadas = (linha, f) => {
  const r = {};
  Object.keys(linha).forEach((coluna) => {
    if (f[FONTE[coluna]] !== undefined) r[coluna] = linha[coluna];
  });
  return r;
};

function paraColunas(f) {
  const pneus = Array.isArray(f.pneus) ? f.pneus : [];
  const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return {
    // Liga a ficha à linha do CRM. Fica nulo nas fichas antigas e nas
    // que vierem de importação sem atendimento.
    atendimento_id: RX_UUID.test(String(f.atendimento_id || "")) ? f.atendimento_id : null,
    placa: normalizarPlaca(f.placa),
    chassi: texto(f.chassi),
    renavam: texto(f.renavam),
    marca: texto(f.marca),
    modelo: texto(f.modeloCurto),
    versao: texto(f.versao),
    // Fora de 1..3 cai em carro, que é o padrão da coluna: tipo
    // inválido vindo de ficha antiga não pode recusar o salvamento.
    tipo_veiculo: [1, 2, 3].indexOf(Math.trunc(Number(f.tipoVeiculo))) >= 0
      ? Math.trunc(Number(f.tipoVeiculo)) : 1,
    fipe_marca_codigo: texto(f.fipeMarcaCodigo),
    fipe_modelo_codigo: texto(f.fipeModeloCodigo),
    fipe_ano_codigo: texto(f.fipeAnoCodigo),
    marca_modelo: texto(f.modelo),
    ...anos(f.ano),
    cor: texto(f.cor),
    combustivel: texto(f.combustivel),
    cambio: texto(f.cambio),
    km_atual: inteiro(f.km),
    km_entrada: inteiro(f.kmEntrada),

    fipe_codigo: texto(f.fipeCodigo),
    fipe_valor: decimal(f.fipe),

    pneu_de: pneu(pneus[0]),
    pneu_dd: pneu(pneus[1]),
    pneu_te: pneu(pneus[2]),
    pneu_td: pneu(pneus[3]),
    leilao_sinistro: !!f.leilao,
    gnv: !!f.gnv,
    opcionais: arranjo(f.opcionais),

    detalhes_lataria: texto(f.lataria),
    detalhes_mecanica: texto(f.mecanica),

    // as três camadas de observação, cada uma no seu destino
    pontos_positivos: arranjo(f.positivos),
    ressalvas_lojista: arranjo(f.ressalvas),
    observacoes_internas: texto(f.internas),

    gastos_descricao: texto(f.gastos),
    valor_por: decimal(f.por),
    preco_pedido: decimal(f.pedida),
  };
}

/* ------------------ conversa com o Supabase ------------------ */

async function supa(url, opcoes) {
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
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a gravação.";
    const erro = new Error(limpar(msg));
    erro.status = r.status === 401 || r.status === 403 ? 500 : 502;
    throw erro;
  }
  return dado;
}

/* ==================================================================
 * ESTOQUE (0019)
 *
 * Três recursos moram aqui — `estoque`, `custo` e `comprador` — e não
 * em arquivos próprios porque o plano Hobby da Vercel para em 12
 * funções e nós estamos nas 12. A costura não é arbitrária: os três
 * são o carro depois que ele passa a ser nosso, que é o assunto deste
 * arquivo.
 *
 * Tudo aqui vai pelo token do usuário. A chave de serviço continua
 * confinada ao Storage, no api/foto.js.
 * ================================================================== */

const RX_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIPOS_CUSTO = ["quitacao", "debitos", "cautelar", "transporte",
                     "reparo", "juros", "documentacao", "deducao", "comissao_externa", "outro"];
// "baixado" (0110): saiu do pátio antes de o sistema registrar a venda —
// não conta em rentabilidade nem em recebimento, que só olham "vendido".
const SITUACOES = ["em_estoque", "vendido", "devolvido", "baixado"];
const TIPOS_COMPRADOR = ["lojista", "pessoa_fisica"];

const dataISO = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

async function corpoDe(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : null;
}

const base = (tabela) => `${URL_BASE}/rest/v1/${tabela}`;

/**
 * O carro no pátio.
 *
 * O `select` traz veículo e custos na mesma consulta: sem isso, a
 * lista faria uma ida ao banco por carro só para somar despesa.
 */
// A ficha do veículo vem inteira porque a tela de venda para lojista
// monta o descritivo e o JSON do Shinkai a partir dela — sem isso
// seria uma consulta por carro na hora de anunciar. São colunas
// pequenas; o teto da lista continua sendo 300 linhas.
const CAMPOS_ESTOQUE =
  "*,veiculo(id,placa,chassi,renavam,tipo_veiculo,marca_modelo,ano_fabricacao,ano_modelo,cor,combustivel,cambio," +
  "km_atual,km_entrada,fipe_codigo,fipe_valor,valor_por,preco_pedido,gastos_descricao,opcionais," +
  "pneu_de,pneu_dd,pneu_te,pneu_td,leilao_sinistro,gnv,detalhes_lataria,detalhes_mecanica," +
  // A foto pende do VEÍCULO, não do estoque: embutida solta aqui o
  // PostgREST responde "could not find a relationship".
  "pontos_positivos,ressalvas_lojista,foto(id))," +
  "comprador(id,nome,tipo,telefone),estoque_custo(id,tipo,descricao,previsto,realizado,pago_em,anexo_id,do_fechamento)," +
  // A negociação que pôs o carro aqui (11/11/2026, o Derek: "aparecesse os
  // dados da negociação, principalmente qual negociador negociou o carro").
  "atendimento(id,data,cliente_nome,cliente_telefone,negociador_nome,prospec,origem,status,chegada_em,pretensao,contrato_assinado_em)";

/**
 * Importa a planilha CONTROLE DE VEÍCULOS / CLIENTES colada.
 *
 * Cinco idas ao banco, não cinco por linha: procura os veículos pela
 * placa, cria os que faltam, idem compradores, e insere estoque e
 * custos em lote. Sessenta linhas em requisições individuais
 * passariam do tempo que a Vercel dá a uma função.
 *
 * Não é transação — se o lote de custos falhar, os carros ficam sem
 * custo e a tela diz quantos. Mesmo compromisso do importador do CRM.
 *
 * Um carro entra uma vez (índice único em veiculo_id): linha cuja
 * placa já está no estoque é pulada e devolvida em `pulados`, em vez
 * de dobrar o custo do carro.
 */
async function importarEstoque(req, res, tok, c) {
  const linhas = Array.isArray(c.linhas) ? c.linhas : [];
  if (!linhas.length) return res.status(400).json({ erro: "Nenhuma linha para importar." });
  if (linhas.length > 300) return res.status(400).json({ erro: "Cole no máximo 300 linhas por vez." });
  const cab = cabecalhos(tok);
  const rep = cabecalhos(tok, { Prefer: "return=representation" });

  const placaDe = (l) => normalizarPlaca(l.placa);
  const validas = linhas.filter((l) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(placaDe(l)));
  const semPlaca = linhas.length - validas.length;

  // 1. veículos que já existem, pela placa (o mais recente de cada)
  const placas = Array.from(new Set(validas.map(placaDe)));
  const lista = placas.length
    ? await supa(`${base("veiculo")}?select=id,placa,atendimento_id,criado_em&placa=in.(${placas.join(",")})&order=criado_em.desc`, { headers: cab })
    : [];
  const veiculoPor = {};
  (lista || []).forEach((v) => { if (!veiculoPor[v.placa]) veiculoPor[v.placa] = v; });

  // 2. cria os que faltam
  const faltam = placas.filter((p) => !veiculoPor[p]).map((p) => {
    const l = validas.filter((x) => placaDe(x) === p)[0];
    return {
      placa: p, marca_modelo: texto(l.carro), renavam: texto(l.renavam), chassi: texto(l.chassi),
      status: "comprado",
    };
  });
  if (faltam.length) {
    const criados = await supa(base("veiculo"), { method: "POST", headers: rep, body: JSON.stringify(faltam) });
    (criados || []).forEach((v) => { veiculoPor[v.placa] = v; });
  }

  // 3. quem já está no estoque não entra de novo
  const ids = Object.keys(veiculoPor).map((p) => veiculoPor[p].id);
  const jaTem = ids.length
    ? await supa(`${base("estoque")}?select=veiculo_id&veiculo_id=in.(${ids.join(",")})`, { headers: cab })
    : [];
  const noEstoque = {};
  (jaTem || []).forEach((e) => { noEstoque[e.veiculo_id] = true; });

  // 4. compradores, pelo nome (a chave prática, como no cadastro)
  /* "ASSUMIU" é a comissão de indicação (0067): o lojista assumiu o
   * financiamento e pagou à Vaapty por ter recebido o cliente. Até
   * 12/10/2026 "ADAM ASSUMIU" sozinho era tratado como não-comprador e
   * o carro entrava no PÁTIO — um carro que a Vaapty nunca comprou.
   * Agora é comprador, a linha é vendida e a natureza diz o que ela é. */
  const NAO_E_COMPRADOR = /^n[aã]o vendido/i;
  const INDICACAO = /\bassumiu\b/i;
  const nomes = Array.from(new Set(validas
    .map((l) => String(l.comprador || "").trim())
    .filter((n) => n && !NAO_E_COMPRADOR.test(n))));
  /* O NOME VAI CODIFICADO, e o `&` é a razão. "GEFERSON VIEIRA DA
   * SILVA & CIA LTDA" cru na URL encerra o parâmetro `nome=` ali
   * mesmo: o PostgREST recebe a lista cortada no meio e devolve
   * `PGRST100 failed to parse filter`, com a importação inteira
   * parada. O Derek bateu nisso em 07/10/2026 com a planilha de abril,
   * 47 compradores, e o erro apontava a coluna 322 — exatamente o `&`.
   *
   * As aspas do PostgREST protegem vírgula e parêntese DENTRO do
   * filtro; elas não protegem nada de um caractere que a query string
   * já tinha consumido antes. São duas camadas, e esta faltava — a
   * mesma lição da decisão 10, onde a busca escapa vírgula e
   * parêntese no `or=`. **Texto que veio de planilha nunca entra numa
   * URL sem `encodeURIComponent`.** */
  const paraFiltro = (n) => `"${encodeURIComponent(n.replace(/"/g, ""))}"`;
  const existentes = nomes.length
    ? await supa(`${base("comprador")}?select=id,nome&nome=in.(${nomes.map(paraFiltro).join(",")})`, { headers: cab })
    : [];
  const compradorPor = {};
  (existentes || []).forEach((x) => { compradorPor[x.nome.toLowerCase()] = x; });
  const novosComp = nomes.filter((n) => !compradorPor[n.toLowerCase()]).map((n) => {
    const l = validas.filter((x) => String(x.comprador || "").trim() === n)[0];
    return { nome: n, tipo: "lojista", telefone: texto(l.telefone) };
  });
  if (novosComp.length) {
    const criados = await supa(base("comprador"), { method: "POST", headers: rep, body: JSON.stringify(novosComp) });
    (criados || []).forEach((x) => { compradorPor[x.nome.toLowerCase()] = x; });
  }

  /* O NOME DO NEGOCIADOR É O DO CADASTRO (08/11/2026, o Derek: "por que
   * ele apareceu com e sem acento? não era pra ser seleção automática do
   * sistema?"). O carro que entra ao fechar pega o nome do atendimento,
   * escolhido numa lista; a planilha colada trazia "ANDRE BRUNO" sem
   * acento, e entrava como veio — duas grafias da mesma pessoa. Agora o
   * nome da planilha que casa com o cadastro (sem acento, sem caixa) vira
   * o do cadastro; o que não casa entra como veio. */
  const semAc = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  const cadNeg = {};
  ((await supa(`${base("negociador")}?select=nome`, { headers: cab }).catch(() => [])) || [])
    .forEach((n) => { if (n.nome) cadNeg[semAc(n.nome)] = n.nome; });
  const nomeDoNegociador = (n) => { const t = texto(n); return t ? cadNeg[semAc(t)] || t : t; };

  // 5. as linhas do estoque
  const pulados = [];
  const paraInserir = [];
  const vistos = {};
  validas.forEach((l) => {
    const p = placaDe(l);
    const v = veiculoPor[p];
    if (!v || noEstoque[v.id] || vistos[v.id]) { pulados.push(p); return; }
    vistos[v.id] = true;
    const nomeComp = String(l.comprador || "").trim();
    const comp = nomeComp && !NAO_E_COMPRADOR.test(nomeComp) ? compradorPor[nomeComp.toLowerCase()] : null;
    const venda = decimal(l.valor_venda);
    const semana = Number(String(l.semana || "").replace(/\D/g, ""));
    paraInserir.push({
      veiculo_id: v.id,
      atendimento_id: v.atendimento_id || null,
      situacao: comp && venda ? "vendido" : "em_estoque",
      natureza: INDICACAO.test(nomeComp) ? "indicacao" : "compra",
      entrou_em: dataISO(l.data) || undefined,
      valor_compra: decimal(l.valor_cliente),
      comprador_id: comp ? comp.id : null,
      valor_venda: venda,
      semana_venda: semana >= 1 && semana <= 5 ? semana : null,
      negociador_nome: nomeDoNegociador(l.negociador),
      meio_alcance: texto(l.meio_alcance),
      prospector: texto(l.prospector),
      observacoes: texto(l.comentarios),
      importado_em: new Date().toISOString(),
    });
  });
  paraInserir.forEach((x) => { if (x.entrou_em === undefined) delete x.entrou_em; });

  if (!paraInserir.length) {
    return res.status(200).json({ ok: true, inseridos: 0, pulados, sem_placa: semPlaca, custos: 0 });
  }
  const inseridos = await supa(base("estoque"), { method: "POST", headers: rep, body: JSON.stringify(paraInserir) });
  const estoquePorVeiculo = {};
  (inseridos || []).forEach((e) => { estoquePorVeiculo[e.veiculo_id] = e.id; });

  // 6. os custos — realizado = o que a planilha diz que custou
  const custos = [];
  validas.forEach((l) => {
    const v = veiculoPor[placaDe(l)];
    const eid = v && estoquePorVeiculo[v.id];
    if (!eid) return;
    [
      ["debitos", "Débitos do veículo", l.debitos, true],
      ["quitacao", "Quitação do financiamento", l.quitacao, true],
      ["cautelar", "Perícia cautelar", l.cautelar, true],
      ["deducao", "Deduções", l.deducoes, false],
      ["comissao_externa", "Comissão externa", l.comissao_externa, false],
    ].forEach(([tipo, desc, valor, doFechamento]) => {
      const n = decimal(valor);
      if (!n) return;
      custos.push({ estoque_id: eid, tipo, descricao: desc, previsto: n, realizado: n, do_fechamento: doFechamento });
    });
  });
  let custosOk = 0;
  if (custos.length) {
    const r = await supa(base("estoque_custo"), { method: "POST", headers: rep, body: JSON.stringify(custos) });
    custosOk = (r || []).length;
  }

  return res.status(201).json({
    ok: true, inseridos: (inseridos || []).length, veiculos_criados: faltam.length,
    compradores_criados: novosComp.length, custos: custosOk, pulados, sem_placa: semPlaca,
  });
}

async function estoque(req, res, tok) {
  const cab = cabecalhos(tok);

  if (req.method === "POST" && String(req.query.acao || "") === "importar") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    return importarEstoque(req, res, tok, c);
  }

  if (req.method === "GET") {
    const id = String(req.query.id || "");
    if (id && RX_ID.test(id)) {
      const linha = await supa(`${base("estoque")}?select=${CAMPOS_ESTOQUE}&id=eq.${id}`, { headers: cab });
      return res.status(200).json({ estoque: (linha || [])[0] || null });
    }
    // Pelo atendimento: é assim que a tela do administrativo acha o
    // carro deste negócio. O `estoque` aponta para o veículo, não para
    // o atendimento, então são duas voltas — e nenhuma delas é a lista
    // inteira, que traz 300 linhas.
    const aid = String(req.query.atendimento_id || "");
    if (aid && RX_ID.test(aid)) {
      const veics = await supa(`${base("veiculo")}?select=id&atendimento_id=eq.${aid}`, { headers: cab });
      const ids = (veics || []).map((v) => v.id);
      // A indicação e a multa sem ficha do carro (0145) pendem só do atendimento.
      const onde = ids.length ? `or=(veiculo_id.in.(${ids.join(",")}),atendimento_id.eq.${aid})` : `atendimento_id=eq.${aid}`;
      const linha = await supa(
        `${base("estoque")}?select=${CAMPOS_ESTOQUE}&${onde}&order=entrou_em.desc&limit=1`,
        { headers: cab });
      return res.status(200).json({ estoque: (linha || [])[0] || null, veiculo_id: ids[0] || null });
    }
    // Os carros com compra provisória (0141): o alerta da gestão e do negociador.
    if (req.query.provisorias) {
      const l = await supa(`${base("estoque")}?select=id,atendimento_id,entrou_em,valor_compra,negociador_nome,veiculo(placa,marca_modelo)` +
        `&compra_provisoria=eq.true&order=entrou_em.asc&limit=200`, { headers: cab }).catch(() => []);
      return res.status(200).json({ estoque: l || [] });
    }
    const sit = SITUACOES.indexOf(String(req.query.situacao || "")) >= 0
      ? `&situacao=eq.${req.query.situacao}` : "";
    const lista = await supa(
      // Vendidos pela data da VENDA: pela entrada, o carro antigo vendido
      // este mês ficava além dos 300 e sumia da rentabilidade do mês.
      `${base("estoque")}?select=${CAMPOS_ESTOQUE}${sit}&order=${req.query.situacao === "vendido" ? "vendido_em.desc.nullslast,entrou_em.desc" : "entrou_em.desc"}&limit=300`,
      { headers: cab });
    return res.status(200).json({ estoque: lista || [] });
  }

  /* CANCELAMENTO COM MULTA CONTRATUAL (0145, 10/11/2026, o Derek). O
   * cliente aceitou a proposta e desistiu: a multa do termo de aceite (10%
   * da proposta aceita, editável) vai para a RENTABILIDADE e para a meta de
   * quem atendeu — como a comissão de indicação (0067), é uma linha do
   * estoque já vendida, compra zero e venda igual à multa, com a natureza
   * 'multa'. Se o carro já tinha entrado no pátio, a MESMA linha vira a
   * multa: sai do pátio, os custos só previstos saem, os pagos ficam (são
   * prejuízo de verdade e descontam a multa), e os títulos em aberto da
   * compra são cancelados. O atendimento vai para "Rescisão". Só o gerente
   * ou o financeiro. */
  if (req.method === "POST" && String(req.query.acao || "") === "multa") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const pode = await supa(`${URL_BASE}/rest/v1/rpc/e_financeiro`, { method: "POST", headers: cabecalhos(tok, { "Content-Type": "application/json" }), body: "{}" }).catch(() => false);
    if (pode !== true) return res.status(403).json({ erro: "Só o gerente ou o financeiro cancela contrato com multa." });
    const aid = String(c.atendimento_id || "");
    if (!RX_ID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    const multa = decimal(c.valor);
    if (!(multa > 0)) return res.status(400).json({ erro: "Informe o valor da multa." });
    const at = ((await supa(`${base("atendimento")}?select=id,cliente_nome,carro_descricao,negociador_nome,origem,prospec&id=eq.${aid}`, { headers: cab })) || [])[0];
    if (!at) return res.status(404).json({ erro: "Atendimento não encontrado." });
    const veics = await supa(`${base("veiculo")}?select=id&atendimento_id=eq.${aid}`, { headers: cab });
    const vids = (veics || []).map((v) => v.id);

    const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const obs = `Multa contratual — ${at.cliente_nome || "cliente"} desistiu${texto(c.observacoes) ? `. ${texto(c.observacoes)}` : ""}`;
    const ondeE = vids.length ? `or=(veiculo_id.in.(${vids.join(",")}),atendimento_id.eq.${aid})` : `atendimento_id=eq.${aid}`;
    const ja = ((await supa(`${base("estoque")}?select=id,situacao,natureza&${ondeE}&limit=1`, { headers: cab })) || [])[0];
    let estoqueId;
    if (ja) {
      if (ja.natureza === "multa") return res.status(409).json({ erro: "A multa deste atendimento já foi registrada." });
      if (ja.natureza === "indicacao") return res.status(409).json({ erro: "Este atendimento já tem uma comissão de indicação registrada." });
      if (ja.situacao === "vendido") return res.status(409).json({ erro: "O carro já foi vendido a um lojista — desfaça a venda antes de cancelar com multa." });
      // Os custos só previstos saem (o negócio não aconteceu); os pagos ficam.
      await supa(`${base("estoque_custo")}?estoque_id=eq.${ja.id}&realizado=is.null`, { method: "DELETE", headers: cab });
      const r = await supa(`${base("estoque")}?id=eq.${ja.id}`, {
        method: "PATCH", headers: cabecalhos(tok, { Prefer: "return=representation", "Content-Type": "application/json" }),
        body: JSON.stringify({ natureza: "multa", situacao: "vendido", valor_compra: 0, compra_provisoria: false, valor_venda: multa,
          vendido_em: hoje, comprador_id: null, observacoes: obs, transferido_em: hoje }),
      });
      if (!(Array.isArray(r) && r.length)) return res.status(403).json({ erro: "O banco recusou a mudança no estoque." });
      estoqueId = ja.id;
    } else {
      const r = await supa(base("estoque"), {
        method: "POST", headers: cabecalhos(tok, { Prefer: "return=representation", "Content-Type": "application/json" }),
        body: JSON.stringify({ veiculo_id: vids[0] || null, descricao_carro: vids.length ? null : at.carro_descricao || null, atendimento_id: aid, natureza: "multa", situacao: "vendido", valor_compra: 0, valor_venda: multa,
          entrou_em: hoje, vendido_em: hoje, observacoes: obs, transferido_em: hoje,
          negociador_nome: at.negociador_nome || null, meio_alcance: at.origem || null, prospector: at.prospec || null }),
      });
      const novo = (Array.isArray(r) ? r[0] : r) || null;
      if (!novo) return res.status(403).json({ erro: "O banco recusou a multa no estoque." });
      estoqueId = novo.id;
    }
    await titulosDoCarro(tok, estoqueId);
    await supa(`${base("atendimento")}?id=eq.${aid}`, { method: "PATCH", headers: cabecalhos(tok, { "Content-Type": "application/json" }), body: JSON.stringify({ status: "rescisao" }) }).catch(() => {});
    return res.status(200).json({ ok: true, estoque_id: estoqueId });
  }

  if (req.method === "POST") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    let veiculoId = String(c.veiculo_id || "");
    /* A INDICAÇÃO NÃO PRECISA DA FICHA DO CARRO (0145, o Derek: "ele tá pedindo
     * todo o cadastro do carro… basta o cadastro do lojista, pois é uma simples
     * indicação"). Sem veículo, ela pende do atendimento, e o carro vai em texto. */
    if (!RX_ID.test(veiculoId) && c.natureza === "indicacao" && RX_ID.test(String(c.atendimento_id || ""))) {
      const ja = await supa(`${base("estoque")}?select=id&atendimento_id=eq.${c.atendimento_id}&natureza=eq.indicacao&limit=1`, { headers: cab });
      if ((ja || []).length) return res.status(409).json({ erro: "A indicação deste atendimento já foi registrada.", id: ja[0].id });
      veiculoId = null;
    } else if (!RX_ID.test(veiculoId)) return res.status(400).json({ erro: "veiculo_id inválido." });

    // Um carro entra uma vez. O índice único da 0019 garante isso no
    // banco; aqui a checagem existe para a mensagem sair legível em vez
    // de "duplicate key value violates unique constraint".
    const jaTem = veiculoId ? await supa(`${base("estoque")}?select=id,situacao,natureza&veiculo_id=eq.${veiculoId}`, { headers: cab }) : [];
    /* O CARRO QUE ENTROU AO FECHAR E VIROU INDICAÇÃO (0151, 11/11/2026, o
     * Derek: MGQ2G66 "passamos pra um lojista assumir o financiamento, pra
     * receber comissão, mas não tá aparecendo opção"). Fechar põe no pátio
     * sozinho (decisão 23), e a indicação só existia para carro fora dele.
     * Se a linha é de compra, ainda no pátio e o cliente não foi pago, ela
     * VIRA a indicação: os custos só previstos saem, os títulos da compra em
     * aberto são cancelados pela sincronização. */
    let converter = null;
    if ((jaTem || []).length) {
      const j = jaTem[0];
      const pagoC = ((await supa(`${base("fin_lancamento")}?select=id&estoque_id=eq.${j.id}&item_contrato=like.compra:*&situacao=eq.efetivado&limit=1`, { headers: cab }).catch(() => [])) || []).length > 0;
      if (c.natureza === "indicacao" && j.natureza === "compra" && j.situacao === "em_estoque" && !pagoC) converter = j.id;
      else if (c.natureza === "indicacao" && pagoC) return res.status(409).json({ erro: "Este carro já foi pago ao cliente — não dá para virar indicação.", id: j.id });
      else return res.status(409).json({ erro: "Este carro já está no estoque.", id: j.id });
    }
    // A MESMA PLACA JÁ NO PÁTIO, por outro atendimento (04/11/2026: o
    // MHW1824 tinha quatro atendimentos e entrou quatro vezes).
    if (c.natureza !== "indicacao") {
      const v = ((await supa(`${base("veiculo")}?select=placa&id=eq.${veiculoId}`, { headers: cab })) || [])[0];
      if (v && v.placa) {
        const mesma = await supa(`${base("estoque")}?select=id,veiculo!inner(placa)&situacao=eq.em_estoque` +
          `&veiculo.placa=eq.${encodeURIComponent(v.placa)}&limit=1`, { headers: cab }).catch(() => []);
        if ((mesma || []).length) return res.status(409).json({ erro: `O ${v.placa} já está no pátio.`, id: mesma[0].id });
      }
    }

    const linha = {
      veiculo_id: veiculoId,
      ...(veiculoId ? {} : { descricao_carro: texto(c.descricao_carro) }),
      atendimento_id: RX_ID.test(String(c.atendimento_id || "")) ? c.atendimento_id : null,
      valor_compra: decimal(c.valor_compra),
      // 0141: sem o líquido do check list, a tela manda o valor fechado e diz que é provisório.
      ...(c.compra_provisoria ? { compra_provisoria: true } : {}),
      observacoes: texto(c.observacoes),
      negociador_nome: texto(c.negociador_nome),
      meio_alcance: texto(c.meio_alcance),
      prospector: texto(c.prospector),
    };
    if (dataISO(c.entrou_em)) linha.entrou_em = c.entrou_em;

    /* COMISSÃO DE INDICAÇÃO (0067). A Vaapty não compra o carro — a
     * quitação passa do que ele vale —, um lojista resolve e paga uma
     * comissão por ter recebido o cliente. Entra como linha do estoque
     * já VENDIDA, compra zero e venda igual à comissão: é assim que a
     * casa já lançava na planilha, e é o que faz o número cair na
     * rentabilidade, na meta do negociador e nos recebimentos sem uma
     * conta nova em lugar nenhum. A `natureza` é o que impede de ser
     * confundida com carro que passou pelo pátio. */
    if (c.natureza === "indicacao") {
      const comissao = decimal(c.valor_venda);
      if (!(comissao > 0)) return res.status(400).json({ erro: "Informe o valor da comissão." });
      let compradorId = RX_ID.test(String(c.comprador_id || "")) ? c.comprador_id : null;
      const nomeNovo = texto(c.comprador_nome);
      if (!compradorId && nomeNovo) {
        const ja = await supa(`${base("comprador")}?select=id&nome=ilike.${encodeURIComponent(nomeNovo.replace(/[,()*]/g, " "))}&limit=1`, { headers: cab });
        if ((ja || []).length) compradorId = ja[0].id;
        else {
          const novoC = await supa(base("comprador"), {
            method: "POST", headers: cabecalhos(tok, { Prefer: "return=representation" }),
            body: JSON.stringify({ nome: nomeNovo, tipo: "lojista" }),
          });
          compradorId = ((Array.isArray(novoC) ? novoC[0] : novoC) || {}).id || null;
        }
      }
      if (!compradorId) return res.status(400).json({ erro: "Diga qual lojista paga a comissão." });
      const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
      Object.assign(linha, {
        natureza: "indicacao", situacao: "vendido", comprador_id: compradorId,
        valor_compra: 0, valor_venda: comissao, entrou_em: hoje, vendido_em: hoje,
      });
    }

    if (converter) {
      await supa(`${base("estoque_custo")}?estoque_id=eq.${converter}&realizado=is.null`, { method: "DELETE", headers: cab }).catch(() => {});
      const { veiculo_id: _v, ...semVeic } = linha;
      const r = await supa(`${base("estoque")}?id=eq.${converter}`, {
        method: "PATCH", headers: cabecalhos(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({ ...semVeic, compra_provisoria: false, compra_manual: false, transferido_em: null }),
      });
      const conv = (Array.isArray(r) ? r[0] : r) || null;
      if (!conv) return res.status(403).json({ erro: "O banco recusou a mudança no estoque." });
      await titulosDoCarro(tok, conv.id);
      return res.status(200).json({ ok: true, estoque: conv, convertido: true });
    }
    const criado = await supa(base("estoque"), {
      method: "POST", headers: cabecalhos(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(linha),
    });
    const novo = (Array.isArray(criado) ? criado[0] : criado) || null;
    if (!novo) return res.status(403).json({ erro: "O banco recusou a entrada no estoque." });

    // As linhas de custo do fechamento entram junto, marcadas como
    // vindas dali. É o que faz o previsto nascer sem ninguém redigitar
    // o que já está no check list.
    const doFechamento = Array.isArray(c.custos) ? c.custos : [];
    const custos = doFechamento
      .map((x) => ({
        estoque_id: novo.id,
        tipo: TIPOS_CUSTO.indexOf(String(x.tipo || "")) >= 0 ? x.tipo : "outro",
        descricao: texto(x.descricao) || "Custo do fechamento",
        previsto: decimal(x.previsto) || 0,
        do_fechamento: true,
      }))
      .filter((x) => x.previsto > 0);

    if (custos.length) {
      await supa(base("estoque_custo"), {
        method: "POST", headers: cabecalhos(tok), body: JSON.stringify(custos),
      });
    }

    await titulosDoCarro(tok, novo.id);
    const completo = await supa(`${base("estoque")}?select=${CAMPOS_ESTOQUE}&id=eq.${novo.id}`, { headers: cab });
    return res.status(201).json({ ok: true, estoque: (completo || [])[0] || novo });
  }

  /* TIRAR DO ESTOQUE o que entrou por engano (04/11/2026: o MHW1824
   * entrou quatro vezes). Só o gerente (a RLS da 0019 já é assim), só
   * carro no pátio — vendido tem venda, margem e recebimento pendurados —
   * e as linhas de custo saem junto (on delete cascade). */
  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const atual = ((await supa(`${base("estoque")}?select=situacao&id=eq.${id}`, { headers: cab })) || [])[0];
    if (!atual) return res.status(404).json({ erro: "Carro não encontrado no estoque." });
    if (atual.situacao !== "em_estoque") return res.status(409).json({ erro: "Só sai do estoque carro que está no pátio — vendido tem a venda pendurada." });
    // Os títulos em aberto do contrato deste carro saem antes (0119): o
    // `on delete set null` deixaria título solto, sem carro, para pagar.
    await supa(`${base("fin_lancamento")}?estoque_id=eq.${id}&situacao=eq.aberto&item_contrato=not.is.null`, {
      method: "PATCH", headers: cabecalhos(tok), body: JSON.stringify({ situacao: "cancelado" }) }).catch(() => null);
    const apagado = await supa(`${base("estoque")}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos(tok, { Prefer: "return=representation" }) });
    if (!(Array.isArray(apagado) && apagado.length)) return res.status(403).json({ erro: "Só o gerente tira carro do estoque." });
    return res.status(200).json({ ok: true });
  }

  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    const mud = {};
    if (c.situacao !== undefined && SITUACOES.indexOf(String(c.situacao)) >= 0) {
      mud.situacao = c.situacao;
      mud.baixado_em = c.situacao === "baixado" ? new Date().toISOString() : null;
    }
    // Digitada no estoque, a compra passa a valer por cima do check list (0151).
    if (c.valor_compra !== undefined) { mud.valor_compra = decimal(c.valor_compra); mud.compra_manual = true; }
    // Quem digita a compra à mão a está confirmando: sai o "provisório" (0141), a não ser que diga o contrário.
    if (c.compra_provisoria !== undefined) mud.compra_provisoria = !!c.compra_provisoria;
    else if (c.valor_compra !== undefined) mud.compra_provisoria = false;
    if (c.valor_venda !== undefined) mud.valor_venda = decimal(c.valor_venda);
    if (c.vendido_em !== undefined) {
      mud.vendido_em = dataISO(c.vendido_em);
      /* A SEMANA DA VENDA É A DO DIA DA VENDA (05/11/2026, o Derek: "no
       * dia da venda a semana pra cálculo de comissões"), pelas quatro
       * semanas da casa (`regras/remuneracao.js`: 1–8, 9–15, 16–22,
       * 23–fim). Gravada junto para quem só lê a coluna. */
      const d = mud.vendido_em ? Number(mud.vendido_em.slice(8, 10)) : 0;
      mud.semana_venda = d ? (d <= 8 ? 1 : d <= 15 ? 2 : d <= 22 ? 3 : 4) : null;
    }
    if (c.nota_venda !== undefined) mud.nota_venda = texto(c.nota_venda);
    // O prazo de transferência desta venda (0115): vazio é o padrão de
    // 3 meses, 0 é imediata.
    if (c.prazo_transferencia_dias !== undefined) {
      const n = c.prazo_transferencia_dias === null || c.prazo_transferencia_dias === "" ? null : Math.trunc(Number(c.prazo_transferencia_dias));
      mud.prazo_transferencia_dias = n == null || !Number.isFinite(n) ? null : Math.max(0, Math.min(365, n));
    }
    if (c.observacoes !== undefined) mud.observacoes = texto(c.observacoes);
    // A previsão de rentabilidade (0118): valor provável e a nota.
    if (c.venda_prevista !== undefined) mud.venda_prevista = c.venda_prevista === null || c.venda_prevista === "" ? null : decimal(c.venda_prevista);
    if (c.venda_prevista_nota !== undefined) mud.venda_prevista_nota = texto(c.venda_prevista_nota);
    if (c.comprador_id !== undefined) {
      mud.comprador_id = RX_ID.test(String(c.comprador_id || "")) ? c.comprador_id : null;
    }
    ["negociador_nome", "meio_alcance", "prospector"].forEach((k) => {
      if (c[k] !== undefined) mud[k] = texto(c[k]);
    });
    if (c.anunciado_em !== undefined) mud.anunciado_em = c.anunciado_em ? new Date().toISOString() : null;
    // Mudar o preço guarda o anterior: abaixar preço é decisão, e o
    // histórico dela é o que explica a margem no fim.
    if (c.preco_pedido !== undefined) {
      const novoPreco = decimal(c.preco_pedido);
      const linha = (await supa(`${base("estoque")}?select=preco_pedido,precos&id=eq.${id}`, { headers: cab }) || [])[0];
      const antes = linha && linha.preco_pedido != null ? Number(linha.preco_pedido) : null;
      if (antes != null && novoPreco != null && antes !== novoPreco) {
        const hist = linha && Array.isArray(linha.precos) ? linha.precos : [];
        mud.precos = hist.concat([{ de: antes, para: novoPreco, em: new Date().toISOString() }]);
      }
      mud.preco_pedido = novoPreco;
    }
    if (c.semana_venda !== undefined && c.vendido_em === undefined) {
      const n = Number(c.semana_venda);
      mud.semana_venda = n >= 1 && n <= 5 ? Math.trunc(n) : null;
    }
    if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para atualizar." });

    const salvo = await supa(`${base("estoque")}?id=eq.${id}`, {
      method: "PATCH", headers: cabecalhos(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(mud),
    });
    if (!(Array.isArray(salvo) ? salvo[0] : salvo)) {
      return res.status(403).json({ erro: "A regra do banco recusou a alteração." });
    }
    if (["valor_compra", "valor_venda", "situacao", "vendido_em", "comprador_id"].some((k) => mud[k] !== undefined)) await titulosDoCarro(tok, id);
    const completo = await supa(`${base("estoque")}?select=${CAMPOS_ESTOQUE}&id=eq.${id}`, { headers: cab });
    return res.status(200).json({ ok: true, estoque: (completo || [])[0] || null });
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
}

/**
 * As linhas de custo.
 *
 * `realizado` aceita null de propósito: null é "ainda não pagou", e
 * zero é "pagou zero". Trocar um pelo outro faria conta paga de graça
 * parecer conta em aberto para sempre.
 */
async function custo(req, res, tok) {
  const cab = cabecalhos(tok);

  if (req.method === "GET") {
    const eid = String(req.query.estoque_id || "");
    if (!RX_ID.test(eid)) return res.status(400).json({ erro: "estoque_id inválido." });
    const lista = await supa(
      `${base("estoque_custo")}?select=*&estoque_id=eq.${eid}&order=criado_em.asc`, { headers: cab });
    return res.status(200).json({ custos: lista || [] });
  }

  if (req.method === "POST") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    if (!RX_ID.test(String(c.estoque_id || ""))) return res.status(400).json({ erro: "estoque_id inválido." });
    const descricao = texto(c.descricao);
    if (!descricao) return res.status(400).json({ erro: "Descreva o custo." });

    const linha = {
      estoque_id: c.estoque_id,
      tipo: TIPOS_CUSTO.indexOf(String(c.tipo || "")) >= 0 ? c.tipo : "outro",
      descricao,
      previsto: decimal(c.previsto) || 0,
      realizado: c.realizado === undefined || c.realizado === null || c.realizado === "" ? null : decimal(c.realizado),
      pago_em: dataISO(c.pago_em),
      anexo_id: RX_ID.test(String(c.anexo_id || "")) ? c.anexo_id : null,
      do_fechamento: false,
    };
    const criado = await supa(base("estoque_custo"), {
      method: "POST", headers: cabecalhos(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(linha),
    });
    const novo = Array.isArray(criado) ? criado[0] : criado;
    if (!novo) return res.status(403).json({ erro: "O banco recusou o lançamento." });
    await titulosDoCarro(tok, novo.estoque_id);
    return res.status(201).json({ ok: true, custo: novo });
  }

  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    const mud = {};
    if (c.tipo !== undefined && TIPOS_CUSTO.indexOf(String(c.tipo)) >= 0) mud.tipo = c.tipo;
    if (c.descricao !== undefined) mud.descricao = texto(c.descricao);
    if (c.previsto !== undefined) mud.previsto = decimal(c.previsto) || 0;
    if (c.realizado !== undefined) {
      mud.realizado = c.realizado === null || c.realizado === "" ? null : decimal(c.realizado);
    }
    if (c.pago_em !== undefined) mud.pago_em = dataISO(c.pago_em);
    if (c.anexo_id !== undefined) {
      mud.anexo_id = RX_ID.test(String(c.anexo_id || "")) ? c.anexo_id : null;
    }
    if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para atualizar." });

    const salvo = await supa(`${base("estoque_custo")}?id=eq.${id}`, {
      method: "PATCH", headers: cabecalhos(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(mud),
    });
    const linha = Array.isArray(salvo) ? salvo[0] : salvo;
    if (!linha) return res.status(403).json({ erro: "A regra do banco recusou a alteração." });
    if (mud.previsto !== undefined || mud.realizado !== undefined || mud.descricao !== undefined) await titulosDoCarro(tok, linha.estoque_id);
    return res.status(200).json({ ok: true, custo: linha });
  }

  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const apagado = await supa(`${base("estoque_custo")}?id=eq.${id}`, {
      method: "DELETE", headers: cabecalhos(tok, { Prefer: "return=representation" }),
    });
    // DELETE vazio é a RLS recusando: só gerente apaga linha de custo,
    // porque linha apagada some com a explicação da margem.
    if (!(Array.isArray(apagado) ? apagado[0] : apagado)) {
      return res.status(403).json({ erro: "Só o gerente apaga linha de custo." });
    }
    await titulosDoCarro(tok, (Array.isArray(apagado) ? apagado[0] : apagado).estoque_id);
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
}

// Os do contrato do lojista (0108): endereço completo e o representante
// legal; e o contato do ADM do lojista (0115), para onde vão os avisos de
// documentação quando o lojista indica outro número.
const CAMPOS_CADASTRO_COMPRADOR = ["rg_ie", "endereco", "bairro", "cep",
  "rep_nome", "rep_cpf", "rep_rg", "rep_endereco", "rep_bairro", "rep_cidade", "rep_uf", "rep_cep",
  "rep_contato", "rep_email", "rep_especie", "adm_nome", "adm_telefone"];

/** O cadastro de compradores. */
async function comprador(req, res, tok) {
  const cab = cabecalhos(tok);

  if (req.method === "GET") {
    // Um só, inteiro: o contrato do lojista lê o cadastro todo.
    if (RX_ID.test(String(req.query.id || ""))) {
      const um = await supa(`${base("comprador")}?select=*&id=eq.${req.query.id}`, { headers: cab });
      return res.status(200).json({ comprador: (um || [])[0] || null });
    }
    const busca = String(req.query.busca || "").trim();
    // O `ilike` do PostgREST usa vírgula e parêntese como sintaxe —
    // mesmo cuidado do api/atendimento.js.
    const seguro = busca.replace(/[,()*]/g, " ").trim();
    const dig = seguro.replace(/\D/g, "");
    const filtro = !seguro ? "" : dig.length >= 4
      ? `&or=(nome.ilike.*${encodeURIComponent(seguro)}*,documento.ilike.*${dig.split("").join("*")}*,telefone.ilike.*${dig.split("").join("*")}*)`
      : `&nome=ilike.*${encodeURIComponent(seguro)}*`;
    // O cadastro de lojistas (0145) lê todos; o seletor, os 200 primeiros.
    const lim = req.query.todos ? 2000 : 200;
    const lista = await supa(
      `${base("comprador")}?select=*${filtro}&order=nome.asc&limit=${lim}`, { headers: cab });
    return res.status(200).json({ compradores: lista || [] });
  }

  if (req.method === "POST") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const nome = texto(c.nome);
    if (!nome) return res.status(400).json({ erro: "Informe o nome do comprador." });

    const linha = {
      nome,
      tipo: TIPOS_COMPRADOR.indexOf(String(c.tipo || "")) >= 0 ? c.tipo : "lojista",
      documento: texto(c.documento), telefone: texto(c.telefone), email: texto(c.email),
      cidade: texto(c.cidade), uf: texto(c.uf) ? String(c.uf).toUpperCase().slice(0, 2) : null,
      shinkai_id: texto(c.shinkai_id),
    };
    // O cadastro completo (0145): endereço, representante e o ADM entram já na criação.
    CAMPOS_CADASTRO_COMPRADOR.forEach((k) => { if (c[k] !== undefined && linha[k] === undefined) linha[k] = texto(c[k]); });
    let criado;
    try {
      criado = await supa(base("comprador"), {
        method: "POST", headers: cabecalhos(tok, { Prefer: "return=representation" }),
        body: JSON.stringify(linha),
      });
    } catch (e) {
      // Nome repetido: mensagem própria, porque a do Postgres não diz
      // nada a quem está cadastrando.
      if (/duplicate key|already exists|unique/i.test(e.message || "")) {
        return res.status(409).json({ erro: "Já existe um comprador com esse nome." });
      }
      throw e;
    }
    const novo = Array.isArray(criado) ? criado[0] : criado;
    if (!novo) return res.status(403).json({ erro: "O banco recusou o cadastro." });
    return res.status(201).json({ ok: true, comprador: novo });
  }

  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    const mud = {};
    // Os do contrato do lojista (0108): endereço completo e o
    // representante legal.
    ["nome", "documento", "telefone", "email", "cidade"].concat(CAMPOS_CADASTRO_COMPRADOR).forEach((k) => {
      if (c[k] !== undefined) mud[k] = texto(c[k]);
    });
    if (c.uf !== undefined) mud.uf = texto(c.uf) ? String(c.uf).toUpperCase().slice(0, 2) : null;
    if (c.tipo !== undefined && TIPOS_COMPRADOR.indexOf(String(c.tipo)) >= 0) mud.tipo = c.tipo;
    if (c.ativo !== undefined) mud.ativo = !!c.ativo;
    if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para atualizar." });

    const salvo = await supa(`${base("comprador")}?id=eq.${id}`, {
      method: "PATCH", headers: cabecalhos(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(mud),
    });
    const linha = Array.isArray(salvo) ? salvo[0] : salvo;
    if (!linha) return res.status(403).json({ erro: "A regra do banco recusou a alteração." });
    return res.status(200).json({ ok: true, comprador: linha });
  }

  res.setHeader("Allow", "GET, POST, PATCH");
  return res.status(405).json({ erro: "Use GET, POST ou PATCH." });
}

/* ------------------ handler ------------------ */

const RECURSOS = { estoque, custo, comprador };

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json(SEM_LOGIN);

  const recurso = RECURSOS[String(req.query.recurso || "")];
  if (recurso) {
    try { return await recurso(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: limpar(e.message) }); }
  }

  try {
    if (req.method === "GET") {
      // A ficha inteira de um atendimento. É o que a tela do
      // administrativo precisa para reemitir o contrato: os dados do
      // carro moram aqui, e o contrato sai em branco sem eles.
      const aid = String(req.query.atendimento_id || "");
      if (aid && RX_ID.test(aid)) {
        const linha = await supa(
          `${REST()}?select=*&atendimento_id=eq.${aid}&order=criado_em.desc&limit=1`,
          { headers: cabecalhos(tok) }
        );
        return res.status(200).json({ veiculo: (linha || [])[0] || null });
      }
      const campos = "placa,marca_modelo,valor_por,status,criado_em";
      const lista = await supa(
        `${REST()}?select=${campos}&order=criado_em.desc&limit=20`,
        { headers: cabecalhos(tok) }
      );
      return res.status(200).json({ fichas: lista || [] });
    }

    if (req.method === "POST") {
      let ficha = req.body;
      if (ficha && typeof Buffer !== "undefined" && Buffer.isBuffer(ficha)) ficha = ficha.toString("utf8");
      if (typeof ficha === "string") { try { ficha = JSON.parse(ficha); } catch (e) { ficha = null; } }
      if (!ficha || typeof ficha !== "object") {
        return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
      }

      const linha = somenteEnviadas(paraColunas(ficha), ficha);
      if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(linha.placa)) {
        return res.status(400).json({ erro: "Placa fora do formato ABC1234 ou ABC1D23." });
      }

      // Uma ficha por placa enquanto o carro está em avaliação. Com
      // atendimento, a chave é ele: o mesmo carro pode voltar no mesmo
      // dia por outro atendimento, e são duas linhas.
      const chave = linha.atendimento_id
        ? `atendimento_id=eq.${encodeURIComponent(linha.atendimento_id)}`
        : `placa=eq.${encodeURIComponent(linha.placa)}&status=eq.em_avaliacao`;
      const abertas = await supa(
        `${REST()}?select=id&${chave}&limit=1`,
        { headers: cabecalhos(tok) }
      );
      const existente = Array.isArray(abertas) && abertas[0] ? abertas[0].id : null;

      let salvo;
      if (existente) {
        // status e fipe_consultada_em ficam como estão: quem atualiza a
        // ficha não reconsultou a FIPE nem mudou o carro de etapa.
        const r = await supa(`${REST()}?id=eq.${encodeURIComponent(existente)}`, {
          method: "PATCH",
          headers: cabecalhos(tok, { Prefer: "return=representation" }),
          body: JSON.stringify(linha),
        });
        salvo = Array.isArray(r) ? r[0] : r;
      } else {
        const r = await supa(REST(), {
          method: "POST",
          headers: cabecalhos(tok, { Prefer: "return=representation" }),
          body: JSON.stringify({
            ...linha,
            // A consulta de placa acontece no mesmo atendimento.
            fipe_consultada_em: linha.fipe_valor == null ? null : new Date().toISOString(),
          }),
        });
        salvo = Array.isArray(r) ? r[0] : r;
      }

      return res.status(existente ? 200 : 201).json({
        ok: true,
        criado: !existente,
        id: salvo ? salvo.id : null,
        placa: linha.placa,
        status: salvo ? salvo.status : null,
        salvo_em: (salvo && (salvo.atualizado_em || salvo.criado_em)) || new Date().toISOString(),
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Use GET ou POST." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha ao gravar." });
  }
};

/**
 * FECHOU, ENTRA NO ESTOQUE (04/11/2026, o Derek: "se foi fechado, entra no
 * estoque — não faz sentido fechar o carro e o carro ficar fora do
 * estoque"). Até aqui a entrada era um ato à parte (decisão 23), e o
 * carro fechado ficava numa fila amarela esperando alguém lembrar —
 * e quem lembrou apertou o botão quatro vezes no mesmo MHW1824, que
 * tinha quatro atendimentos. Agora o status "Fechado" põe o carro no
 * pátio na hora, com o previsto do check list (o mesmo que o botão
 * fazia), e não entra de novo:
 *   - o veículo já tem linha no estoque (o índice único da 0019);
 *   - a mesma PLACA já está no pátio, por outro atendimento.
 * Falha não derruba o status: o carro continua na fila para o botão.
 */
/* O previsto do fechamento: quitação, cautelar, débitos linha a linha e
 * os "entre outros" — a comissão nunca é custo (decisão 23). Um lugar só,
 * para a entrada ao fechar e para o "puxar do check list". */
function previstoDoChecklist(cl, estoqueId) {
  const num = (x) => decimal(x) || 0;
  const itensDeb = (Array.isArray(cl.debitos_itens) ? cl.debitos_itens : []).filter((x) => x && (x.descricao || num(x.valor)));
  const extras = (Array.isArray(cl.descontos_extras) ? cl.descontos_extras : []).filter((x) => x && x.custo !== false && num(x.valor));
  return [
    { tipo: "quitacao", descricao: "Quitação do financiamento", previsto: cl.valor_quitacao },
    { tipo: "cautelar", descricao: "Perícia cautelar", previsto: cl.valor_cautelar },
  ].concat(itensDeb.length
    ? itensDeb.map((x) => ({ tipo: "debitos", descricao: x.descricao || "Débito do veículo", previsto: x.valor }))
    : [{ tipo: "debitos", descricao: "Débitos do veículo", previsto: cl.valor_debitos }])
    .concat(extras.map((x) => ({ tipo: "outro", descricao: x.descricao || "Outro desconto", previsto: x.valor })))
    .map((x) => ({ estoque_id: estoqueId, tipo: TIPOS_CUSTO.indexOf(x.tipo) >= 0 ? x.tipo : "outro",
      descricao: texto(x.descricao) || "Custo do fechamento", previsto: num(x.previsto), do_fechamento: true }))
    .filter((x) => x.previsto > 0);
}

/* O CHECK LIST PREENCHIDO DEPOIS chega ao estoque (05/11/2026, o Derek:
 * "por que esses últimos carros estão entrando no estoque com valor
 * zerado?"). O carro entra ao fechar (decisão 23), muitas vezes antes de
 * alguém preencher o check list — e entrava com compra vazia e sem custo
 * nenhum, que a lista mostrava como R$ 0,00. Agora, a cada gravação do
 * check list, o carro daquele atendimento ainda no pátio recebe o valor
 * ao cliente (se estiver vazio) e o previsto (se não tiver nenhuma linha
 * do fechamento). Nada que alguém digitou no estoque é trocado. */
// Os títulos do contrato acompanham o carro (0119): toda mudança de
// compra, custo ou venda passa por aqui. Nunca derruba quem chamou.
async function titulosDoCarro(tok, estoqueId) {
  try { await require("./financeiro.js").sincronizarTitulosDoCarro(tok, estoqueId); } catch (e) {}
}
module.exports.titulosDoCarro = titulosDoCarro;

// O check list tem a conta do negócio (quitação, débitos ou cautelar): o líquido ao cliente que está
// nele vale, mesmo zero.
function checklistTemConta(cl) {
  if (!cl) return false;
  const n = (x) => decimal(x) || 0;
  return n(cl.valor_quitacao) > 0 || n(cl.valor_debitos) > 0 || n(cl.valor_cautelar) > 0 ||
    (Array.isArray(cl.debitos_itens) && cl.debitos_itens.some((x) => x && n(x.valor) > 0));
}
async function puxarDoChecklist(tok, atendimentoId) {
  const cab = { headers: cabecalhos(tok) };
  const e = ((await supa(`${base("estoque")}?select=id,valor_compra,compra_provisoria,compra_manual,situacao,natureza,` +
    `estoque_custo(id,tipo,descricao,previsto,realizado,do_fechamento)` +
    `&atendimento_id=eq.${atendimentoId}&order=entrou_em.desc&limit=1`, cab)) || [])[0];
  if (!e) return { ok: true, nada: true };
  if (e.natureza && e.natureza !== "compra") return { ok: true, nao_e_carro: true };
  const cl = ((await supa(`${base("checklist")}?select=*&atendimento_id=eq.${atendimentoId}&limit=1`, cab)) || [])[0];
  if (!cl) return { ok: true, sem_checklist: true };
  const feito = {};
  /* O CHECK LIST CORRIGIDO DEPOIS também chega (0151, 11/11/2026, o Derek:
   * o IWG8C85 entrou com R$ 30.000 ao cliente, o desconto foi dado no check
   * list — 29.869,84 —, e o financeiro e o estoque continuavam com 30.000).
   * Enquanto o cliente não foi pago (o título da compra não passou no banco)
   * e ninguém digitou a compra no estoque, ela acompanha o check list. */
  const pago = ((await supa(`${base("fin_lancamento")}?select=id&estoque_id=eq.${e.id}&item_contrato=like.compra:*&situacao=eq.efetivado&limit=1`, cab).catch(() => [])) || []).length > 0;
  const vCl = decimal(cl.valor_cliente);
  if (!e.compra_manual && !e.compra_provisoria && !pago && Number(e.valor_compra) > 0 && (vCl || checklistTemConta(cl)) &&
      Math.abs((vCl || 0) - Number(e.valor_compra)) >= 0.005) {
    await supa(`${base("estoque")}?id=eq.${e.id}`, { method: "PATCH", headers: cabecalhos(tok), body: JSON.stringify({ valor_compra: vCl || 0 }) });
    feito.valor_compra = vCl || 0;
  } else if (!(Number(e.valor_compra) > 0) && vCl) {
    await supa(`${base("estoque")}?id=eq.${e.id}`, { method: "PATCH", headers: cabecalhos(tok), body: JSON.stringify({ valor_compra: decimal(cl.valor_cliente), compra_provisoria: false }) });
    feito.valor_compra = decimal(cl.valor_cliente);
  } else if (e.compra_provisoria && (decimal(cl.valor_cliente) || checklistTemConta(cl))) {
    // O check list foi preenchido: o líquido ao cliente entra no lugar do valor fechado provisório
    // (0141). Zero vale — é o carro em que a quitação levou tudo e o cliente não recebeu nada.
    const v = decimal(cl.valor_cliente) || 0;
    await supa(`${base("estoque")}?id=eq.${e.id}`, { method: "PATCH", headers: cabecalhos(tok), body: JSON.stringify({ valor_compra: v, compra_provisoria: false }) });
    feito.valor_compra = v;
  }
  const linhas = previstoDoChecklist(cl, e.id);
  const doFech = (e.estoque_custo || []).filter((x) => x.do_fechamento);
  if (!doFech.length) {
    if (linhas.length) { await supa(base("estoque_custo"), { method: "POST", headers: cabecalhos(tok), body: JSON.stringify(linhas) }); feito.custos = linhas.length; }
  } else {
    /* As linhas que vieram do check list o acompanham (0151): o previsto
     * muda, a que surgiu entra, a que saiu sai — só as que ainda não foram
     * pagas (`realizado` nulo). A paga e a digitada à mão não se tocam. */
    const chave = (x) => `${x.tipo}|${String(x.descricao || "").trim().toLowerCase()}`;
    const usadas = new Set();
    for (const l of linhas) {
      const ja = doFech.find((x) => !usadas.has(x.id) && chave(x) === chave(l)) || doFech.find((x) => !usadas.has(x.id) && x.tipo === l.tipo && x.realizado == null);
      if (ja) {
        usadas.add(ja.id);
        if (ja.realizado == null && Math.abs((Number(ja.previsto) || 0) - l.previsto) >= 0.005) {
          await supa(`${base("estoque_custo")}?id=eq.${ja.id}`, { method: "PATCH", headers: cabecalhos(tok), body: JSON.stringify({ previsto: l.previsto, descricao: l.descricao }) });
          feito.custos_mudados = (feito.custos_mudados || 0) + 1;
        }
      } else {
        await supa(base("estoque_custo"), { method: "POST", headers: cabecalhos(tok), body: JSON.stringify(l) });
        feito.custos_novos = (feito.custos_novos || 0) + 1;
      }
    }
    for (const x of doFech) {
      if (!usadas.has(x.id) && x.realizado == null) {
        await supa(`${base("estoque_custo")}?id=eq.${x.id}`, { method: "DELETE", headers: cabecalhos(tok) }).catch(() => {});
        feito.custos_tirados = (feito.custos_tirados || 0) + 1;
      }
    }
  }
  await titulosDoCarro(tok, e.id);
  return { ok: true, ...feito };
}
module.exports.puxarDoChecklist = puxarDoChecklist;

async function entrarAoFechar(tok, atendimentoId) {
  const cab = { headers: cabecalhos(tok) };
  const at = ((await supa(`${base("atendimento")}?select=id,status,valor_fechado,negociador_nome,origem,prospec,contrato_assinado_em,` +
    `veiculo(id,placa),checklist(*)&id=eq.${atendimentoId}`, cab)) || [])[0];
  if (!at) return { ok: false, motivo: "atendimento não encontrado" };
  if (at.status !== "fechado") return { ok: false, motivo: "não está fechado" };
  /* SÓ COM O CONTRATO FINAL ASSINADO (11/11/2026, o Derek: "só manda pro
   * estoque quando tiver o contrato final assinado, não somente com o
   * termo"). Assinado no ZapSign, ou a via assinada anexada à mão. Quem
   * chama de novo quando a assinatura chega: o guardar da via assinada
   * (`api/foto.js`) e o anexo "Contrato assinado". */
  if (!at.contrato_assinado_em) {
    const via = await supa(`${base("anexo")}?select=id&atendimento_id=eq.${atendimentoId}&rotulo=in.(${encodeURIComponent('"Contrato assinado","doc:contrato"')})&limit=1`, cab).catch(() => []);
    if (!(via || []).length) return { ok: false, espera_contrato: true, motivo: "o contrato final ainda não foi assinado" };
  }
  // Indicação ou multa do atendimento (0145) já é o "fechado" dele: não entra compra (11/11/2026, o Derek:
  // "quando fazemos indicação também consideramos fechado").
  const doAt = await supa(`${base("estoque")}?select=id&atendimento_id=eq.${atendimentoId}&limit=1`, cab).catch(() => []);
  if ((doAt || []).length) return { ok: true, ja: true, id: doAt[0].id };
  const v = Array.isArray(at.veiculo) ? at.veiculo[0] : at.veiculo;
  if (!v || !v.id) return { ok: false, motivo: "sem ficha do carro" };
  const ja = await supa(`${base("estoque")}?select=id&veiculo_id=eq.${v.id}`, cab);
  if ((ja || []).length) return { ok: true, ja: true, id: ja[0].id };
  if (v.placa) {
    const mesmaPlaca = await supa(`${base("estoque")}?select=id,veiculo!inner(placa)&situacao=eq.em_estoque` +
      `&veiculo.placa=eq.${encodeURIComponent(v.placa)}&limit=1`, cab).catch(() => []);
    if ((mesmaPlaca || []).length) return { ok: true, ja: true, id: mesmaPlaca[0].id, mesma_placa: true };
  }
  const cl = (Array.isArray(at.checklist) ? at.checklist[0] : at.checklist) || {};
  const criado = await supa(base("estoque"), {
    method: "POST", headers: cabecalhos(tok, { Prefer: "return=representation" }),
    body: JSON.stringify({
      veiculo_id: v.id, atendimento_id: at.id,
      // Check list com a conta feita vale como está, mesmo com o cliente recebendo zero (a quitação
      // levou tudo); só sem conta nenhuma o valor fechado entra, e provisório.
      valor_compra: decimal(cl.valor_cliente) || (checklistTemConta(cl) ? 0 : decimal(at.valor_fechado)),
      // O valor fechado no lugar do líquido ao cliente é provisório até o check list ser preenchido (0141).
      compra_provisoria: !decimal(cl.valor_cliente) && !checklistTemConta(cl) && !!decimal(at.valor_fechado),
      negociador_nome: texto(at.negociador_nome), meio_alcance: texto(at.origem), prospector: texto(at.prospec),
      observacoes: "Entrou sozinho ao fechar o atendimento.",
    }),
  });
  const novo = (Array.isArray(criado) ? criado[0] : criado) || null;
  if (!novo) return { ok: false, motivo: "o banco recusou" };
  const linhas = previstoDoChecklist(cl, novo.id);
  if (linhas.length) await supa(base("estoque_custo"), { method: "POST", headers: cabecalhos(tok), body: JSON.stringify(linhas) }).catch(() => {});
  await titulosDoCarro(tok, novo.id);
  return { ok: true, id: novo.id };
}
module.exports.entrarAoFechar = entrarAoFechar;
