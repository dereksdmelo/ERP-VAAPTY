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
  const p = String(ano || "").split("/").map((x) => inteiro(x));
  if (p.length < 2) return { ano_fabricacao: p[0] || null, ano_modelo: p[0] || null };
  return { ano_fabricacao: p[0] || null, ano_modelo: p[1] || p[0] || null };
}

// De qual campo da tela veio cada coluna. Serve para não apagar no
// update o que a tela nem mandou — renavam, por exemplo, tem coluna
// mas ainda não tem campo.
const FONTE = {
  atendimento_id: "atendimento_id",
  placa: "placa", chassi: "chassi", renavam: "renavam", marca_modelo: "modelo",
  ano_fabricacao: "ano", ano_modelo: "ano", cor: "cor", combustivel: "combustivel",
  cambio: "cambio", km_atual: "km", km_entrada: "kmEntrada",
  fipe_codigo: "fipeCodigo", fipe_valor: "fipe",
  pneu_de: "pneus", pneu_dd: "pneus", pneu_te: "pneus", pneu_td: "pneus",
  leilao_sinistro: "leilao", gnv: "gnv", opcionais: "opcionais",
  detalhes_lataria: "lataria", detalhes_mecanica: "mecanica",
  pontos_positivos: "positivos", ressalvas_lojista: "ressalvas",
  observacoes_internas: "internas",
  gastos_descricao: "gastos", valor_por: "por",
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
                     "reparo", "juros", "documentacao", "outro"];
const SITUACOES = ["em_estoque", "vendido", "devolvido"];
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
const CAMPOS_ESTOQUE =
  "*,veiculo(id,placa,marca_modelo,ano_modelo,cor,km_atual,fipe_valor,valor_por)," +
  "comprador(id,nome,tipo,telefone),estoque_custo(id,tipo,descricao,previsto,realizado,pago_em,anexo_id,do_fechamento)";

async function estoque(req, res, tok) {
  const cab = cabecalhos(tok);

  if (req.method === "GET") {
    const id = String(req.query.id || "");
    if (id && RX_ID.test(id)) {
      const linha = await supa(`${base("estoque")}?select=${CAMPOS_ESTOQUE}&id=eq.${id}`, { headers: cab });
      return res.status(200).json({ estoque: (linha || [])[0] || null });
    }
    const sit = SITUACOES.indexOf(String(req.query.situacao || "")) >= 0
      ? `&situacao=eq.${req.query.situacao}` : "";
    const lista = await supa(
      `${base("estoque")}?select=${CAMPOS_ESTOQUE}${sit}&order=entrou_em.desc&limit=300`,
      { headers: cab });
    return res.status(200).json({ estoque: lista || [] });
  }

  if (req.method === "POST") {
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const veiculoId = String(c.veiculo_id || "");
    if (!RX_ID.test(veiculoId)) return res.status(400).json({ erro: "veiculo_id inválido." });

    // Um carro entra uma vez. O índice único da 0019 garante isso no
    // banco; aqui a checagem existe para a mensagem sair legível em vez
    // de "duplicate key value violates unique constraint".
    const jaTem = await supa(`${base("estoque")}?select=id&veiculo_id=eq.${veiculoId}`, { headers: cab });
    if ((jaTem || []).length) {
      return res.status(409).json({ erro: "Este carro já está no estoque.", id: jaTem[0].id });
    }

    const linha = {
      veiculo_id: veiculoId,
      atendimento_id: RX_ID.test(String(c.atendimento_id || "")) ? c.atendimento_id : null,
      valor_compra: decimal(c.valor_compra),
      observacoes: texto(c.observacoes),
    };
    if (dataISO(c.entrou_em)) linha.entrou_em = c.entrou_em;

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

    const completo = await supa(`${base("estoque")}?select=${CAMPOS_ESTOQUE}&id=eq.${novo.id}`, { headers: cab });
    return res.status(201).json({ ok: true, estoque: (completo || [])[0] || novo });
  }

  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_ID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const c = await corpoDe(req);
    if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    const mud = {};
    if (c.situacao !== undefined && SITUACOES.indexOf(String(c.situacao)) >= 0) mud.situacao = c.situacao;
    if (c.valor_compra !== undefined) mud.valor_compra = decimal(c.valor_compra);
    if (c.valor_venda !== undefined) mud.valor_venda = decimal(c.valor_venda);
    if (c.vendido_em !== undefined) mud.vendido_em = dataISO(c.vendido_em);
    if (c.nota_venda !== undefined) mud.nota_venda = texto(c.nota_venda);
    if (c.observacoes !== undefined) mud.observacoes = texto(c.observacoes);
    if (c.comprador_id !== undefined) {
      mud.comprador_id = RX_ID.test(String(c.comprador_id || "")) ? c.comprador_id : null;
    }
    if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para atualizar." });

    const salvo = await supa(`${base("estoque")}?id=eq.${id}`, {
      method: "PATCH", headers: cabecalhos(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(mud),
    });
    if (!(Array.isArray(salvo) ? salvo[0] : salvo)) {
      return res.status(403).json({ erro: "A regra do banco recusou a alteração." });
    }
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
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
}

/** O cadastro de compradores. */
async function comprador(req, res, tok) {
  const cab = cabecalhos(tok);

  if (req.method === "GET") {
    const busca = String(req.query.busca || "").trim();
    // O `ilike` do PostgREST usa vírgula e parêntese como sintaxe —
    // mesmo cuidado do api/atendimento.js.
    const seguro = busca.replace(/[,()*]/g, " ").trim();
    const filtro = seguro ? `&nome=ilike.*${encodeURIComponent(seguro)}*` : "";
    const lista = await supa(
      `${base("comprador")}?select=*${filtro}&order=nome.asc&limit=200`, { headers: cab });
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
    ["nome", "documento", "telefone", "email", "cidade"].forEach((k) => {
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
