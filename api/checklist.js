/**
 * /api/checklist — o check list do negócio, agora digital.
 *
 *   GET  ?atendimento_id=      lê (ou devolve vazio, se ainda não existe)
 *   PUT  ?atendimento_id=      grava; cria na primeira vez
 *
 * Uma linha por atendimento — a 0008 tem unique em atendimento_id, e a
 * gravação usa upsert em cima dele. Check list é o resumo do negócio,
 * não um evento que se repete como o documento impresso.
 *
 * Duas mãos preenchem, e desde a 0012 em telas separadas: o negociador
 * na entrega, o administrativo na sua própria tela. Quando qualquer
 * item do administrativo é marcado, o servidor carimba quem conferiu e
 * quando — o cliente não escolhe esse valor, senão "conferido" não
 * responde a pergunta que importa quando algo dá errado.
 *
 * E quem não é administrativo não marca esses itens: o PUT recusa. A
 * RLS da 0008 libera a linha inteira para a equipe e não sabe separar
 * coluna, então a separação é aqui. Vale dizer o que isso não é: quem
 * tiver o token e souber falar PostgREST direto passa por cima. Para
 * fechar de verdade seria preciso trigger no banco ou coluna em outra
 * tabela — não foi feito, e é honesto saber disso antes de chamar de
 * controle de acesso.
 *
 * ATENÇÃO: aqui trafega dado bancário de cliente. Nada é escrito em
 * log, e a RLS da 0008 é quem decide o acesso.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const REST = `${URL_BASE}/rest/v1/checklist`;

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};
const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O id do usuário, lido do miolo do token. Quem valida é o banco. */
function donoDoToken(tok) {
  try {
    const meio = String(tok).replace(/^Bearer\s+/, "").split(".")[1];
    if (!meio) return null;
    const base = meio.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(base, "base64").toString("utf8")).sub || null;
  } catch (e) { return null; }
}

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};
const decimal = (v) => {
  let s = String(v == null ? "" : v).replace(/R\$|\s/g, "").trim();
  if (!s) return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const MODOS_CONTA = ["com_comissao", "limpo"];

/**
 * Uma lista de {descrição, valor} vinda da tela, saneada.
 *
 * O teto de 40 não é medo de abuso: é que uma lista de débitos maior
 * que isso quer dizer que alguém colou a consulta inteira do Detran no
 * lugar de escolher o que vai ser descontado.
 */
function itensDeValor(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 40)
    .map((x) => ({ descricao: texto(x && x.descricao) || "", valor: decimal(x && x.valor) || 0 }))
    .filter((x) => x.descricao || x.valor);
}

const ITENS = [
  "recibo_compra_venda", "segunda_via_dut", "licenciamento_atual", "transferencia",
  "emplacamento_mercosul", "outros_itens", "comprovante_residencia",
  "copia_cnh_titular", "manual_chave_copia",
];
const ADM = ["adm_entrada", "adm_saida", "adm_debitos", "adm_quitacao", "adm_outros", "adm_laudo_cautelar"];
const VALORES = ["valor_venda", "valor_cautelar", "valor_debitos", "valor_quitacao", "comissao_vaapty", "valor_cliente"];
const BANCO = ["banco_favorecido", "banco_documento", "banco_nome", "banco_agencia", "banco_conta", "banco_tipo", "banco_pix"];

const CONTA = ["debitos_itens", "descontos_extras", "modo_conta"];
const CAMPOS = ["id", "atendimento_id"].concat(ITENS, ADM, VALORES, BANCO, CONTA,
  ["adm_conferido_por", "adm_conferido_em", "observacoes", "atualizado_em"]).join(",");

/**
 * Uma ida a mais ao banco por gravação com item do administrativo. Vale
 * o custo: sem ela, "conferido pelo administrativo" seria só um rótulo
 * que qualquer um marca.
 */
async function eAdministrativo(tok) {
  const id = donoDoToken(tok);
  if (!id) return false;
  try {
    const r = await fetch(
      `${URL_BASE}/rest/v1/perfil?select=administrativo,papel&id=eq.${id}&limit=1`,
      { headers: cabecalhos(tok) }
    );
    if (!r.ok) return false;
    const linhas = await r.json().catch(() => []);
    const eu = Array.isArray(linhas) ? linhas[0] : null;
    return !!(eu && (eu.administrativo || eu.papel === "gerente"));
  } catch (e) { return false; }
}

async function banco(url, opcoes) {
  let r;
  try { r = await fetch(url, opcoes); }
  catch (e) { const x = new Error("Não consegui falar com o banco."); x.status = 502; throw x; }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a gravação.";
    const x = new Error(String(msg));
    x.status = r.status === 401 ? 401 : r.status === 403 ? 403 : 502;
    throw x;
  }
  return dado;
}

/* ==================================================================
 * O CHECK LIST DE DOCUMENTAÇÕES (0027)
 *
 * A folha do envelope: 36 itens, três vistos cada. A LISTA mora aqui e
 * não no banco — ela muda quando a casa muda o processo, e migração
 * para acrescentar uma linha de conferência seria atrito à toa.
 * ================================================================== */

const VISTOS = ["adm", "gerencia", "financeiro"];

// codigo, rótulo, grupo, vistos ("tres" = adm+gerência+financeiro, "um" = só
// adm), pedeDoc (o item é um papel que precisa estar anexado; os outros
// são perguntas de sim/não, e cobrar anexo neles seria ruído)
const ITENS_DOC = [
  ["fechamento", "Check List Fechamento", "pf", "tres", true],
  ["resumo_negociacao", "Resumo Negociação Sances", "pf", "tres", true],
  ["procuracao", "Procuração", "pf", "tres", true],
  ["crv_dut", "CRV/DUT", "pf", "tres", true],
  ["crlv", "CRLV", "pf", "tres", true],
  ["dossie_detran", "Dossiê Detran", "pf", "tres", true],
  ["prf", "PRF", "pf", "tres", true],
  ["divida_ativa", "Dívida Ativa", "pf", "tres", true],
  ["cnh_contratante", "CNH Contratante", "pf", "tres", true],
  ["cnh_proprietario", "CNH Proprietário", "pf", "tres", true],
  ["comprovante_residencia", "Comprovante de Residência", "pf", "tres", true],
  ["serasa", "Consulta Serasa", "pf", "tres", true],
  ["pre_contrato", "Pré-contrato", "pf", "tres", true],
  ["contrato", "Contrato", "pf", "tres", true],
  ["cautelar", "Cautelar veículo", "pf", "tres", true],
  ["manual", "Manual", "pf", "tres", false],
  ["chave_reserva", "Chave Reserva", "pf", "tres", false],
  ["gnv_selo", "GNV, Selo Atualizado?", "pf", "tres", false],
  ["placa_mercosul", "Tem placa Mercosul?", "pf", "tres", false],
  ["trocar_placa", "Trocar de Placa?", "pf", "tres", false],
  ["tem_financiamento", "Tem Financiamento?", "pf", "tres", false],
  ["financiamento_incluso", "Financiamento está Incluso?", "pf", "tres", false],
  ["financiamento_quitado", "Financiamento está Quitado?", "pf", "tres", false],
  ["tem_debitos", "Tem Débitos?", "pf", "tres", false],
  ["debitos_cobrados", "Foi cobrado os Débitos?", "pf", "tres", false],
  ["debitos_pagos", "Vai ser pago os Débitos?", "pf", "tres", false],

  ["cartao_cnpj", "Cartão CNPJ", "pj", "tres", true],
  ["contrato_social", "Contrato Social", "pj", "tres", true],
  ["documentos_socios", "Documentos Sócios", "pj", "tres", true],
  ["multas_duplicacao", "Multas (Duplicação)", "pj", "tres", true],

  ["arq_comprovante_cliente", "Comprovante Cliente", "arquivamento", "um", true],
  ["arq_comprovante_lojista", "Comprovante Lojista", "arquivamento", "um", true],
  ["arq_contrato_lojista", "Contrato Lojista", "arquivamento", "um", true],
  ["arq_protocolo_retirada", "Protocolo de Retirada", "arquivamento", "um", true],

  ["transf_dut_atpv", "Cópia DUT ou ATPV Reconhecida", "transferencia", "um", true],
  ["transf_procuracao", "Cópia Procuração", "transferencia", "um", true],
  ["transf_comunicado_venda", "Comunicado Venda", "transferencia", "um", true],
];
const CODIGOS_DOC = ITENS_DOC.map((x) => x[0]);

async function documentos(req, res, tok) {
  const RESTD = `${URL_BASE}/rest/v1/checklist_doc`;

  if (req.method === "GET") {
    const aid = String(req.query.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    // Os nomes vêm numa consulta à parte: são três chaves estrangeiras
    // para `perfil` na mesma tabela, e o embed do PostgREST precisaria
    // do nome exato de cada constraint — que muda se a migração for
    // reescrita. Um select a mais é mais barato que esse acoplamento.
    const [linhas, gente] = await Promise.all([
      banco(`${RESTD}?select=*&atendimento_id=eq.${aid}`, { headers: cabecalhos(tok) }),
      banco(`${URL_BASE}/rest/v1/perfil?select=id,nome`, { headers: cabecalhos(tok) }),
    ]);
    const nomes = {};
    (gente || []).forEach((p) => { nomes[p.id] = p.nome; });
    const marcas = (linhas || []).map((m) => ({
      ...m,
      adm_nome: nomes[m.adm_por] || null,
      gerencia_nome: nomes[m.gerencia_por] || null,
      financeiro_nome: nomes[m.financeiro_por] || null,
    }));
    // A lista fixa vem do código (muda com o processo, não com o
    // carro); os extras vêm das próprias linhas, que carregam o rótulo.
    // Assim as duas chegam à tela num formato só, e a tela não precisa
    // saber que existem duas origens.
    const extras = (linhas || [])
      .filter((m) => /^extra/.test(m.item) && m.rotulo)
      .map((m) => [m.item, m.rotulo, m.grupo || "extra", "tres", m.pede_doc !== false]);
    return res.status(200).json({ itens: ITENS_DOC.concat(extras), marcas });
  }

  if (req.method === "PUT") {
    const corpo = await lerCorpo(req);
    if (!corpo) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const aid = String(corpo.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    const item = String(corpo.item || "");
    const eExtra = /^extra_[a-z0-9_]{1,40}$/.test(item);
    if (CODIGOS_DOC.indexOf(item) < 0 && !eExtra) return res.status(400).json({ erro: "Item desconhecido." });

    const eu = donoDoToken(tok);
    const adm = await eAdministrativo(tok);
    const linha = { atendimento_id: aid, item, atualizado_em: new Date().toISOString() };

    // Quem carimba é o servidor, a partir do token. Sem isso,
    // "conferido" não responde a pergunta que importa quando algo dá
    // errado: conferido por quem.
    VISTOS.forEach((v) => {
      if (corpo[v] === undefined) return;
      linha[v] = corpo[v] === null ? null : !!corpo[v];
      linha[`${v}_por`] = corpo[v] === null ? null : eu;
      linha[`${v}_em`] = corpo[v] === null ? null : new Date().toISOString();
    });
    if (corpo.observacao !== undefined) linha.observacao = texto(corpo.observacao);

    // Item extra nasce com o rótulo na própria linha: sem ele a linha
    // existiria sem dizer o que é, e sumiria da tela.
    if (eExtra) {
      const rot = texto(corpo.rotulo);
      if (rot) {
        linha.rotulo = rot;
        linha.grupo = texto(corpo.grupo) || "extra";
        linha.pede_doc = corpo.pede_doc !== false;
      }
    }
    if (Object.keys(linha).length <= 3) return res.status(400).json({ erro: "Nada para marcar." });

    // O visto do administrativo e o da gerência são permissão, não
    // conveniência de tela: quem não é adm nem gerente não carimba.
    if ((linha.adm !== undefined || linha.gerencia !== undefined) && !adm) {
      return res.status(403).json({ erro: "Só o administrativo ou o gerente dá esse visto." });
    }

    const r = await banco(`${RESTD}?on_conflict=atendimento_id,item`, {
      method: "POST",
      headers: json(tok, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify(linha),
    });
    const salvo = Array.isArray(r) ? r[0] : r;
    if (!salvo) return res.status(403).json({ erro: "O banco recusou a marcação." });
    return res.status(200).json({ ok: true, marca: salvo });
  }

  if (req.method === "DELETE") {
    const aid = String(req.query.atendimento_id || "");
    const item = String(req.query.item || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    // Só o item extra se apaga. Os 36 da folha são o processo da casa —
    // sumir com um deles esconderia justamente o que falta conferir.
    if (!/^extra_[a-z0-9_]{1,40}$/.test(item)) return res.status(400).json({ erro: "Só item extra pode ser removido." });
    await banco(`${RESTD}?atendimento_id=eq.${aid}&item=eq.${item}`, { method: "DELETE", headers: cabecalhos(tok) });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, PUT, DELETE");
  return res.status(405).json({ erro: "Use GET, PUT ou DELETE." });
}

/* ===================== O DUT =====================
 *
 * O lojista pede o preenchimento (ou só o reconhecimento de firma) e o
 * administrativo acompanha. Vivia num formulário do Google com 1.278
 * respostas, onde o acompanhamento eram dois comentários de célula.
 *
 * **Mora aqui** porque é a conferência de documento do administrativo,
 * que é o assunto deste arquivo (decisão 30) — e porque arquivo novo
 * em `api/` tem teto.
 *
 * **O lojista não tem login e nunca vai ter** — são dezenas de lojas
 * da rede. Por isso o POST público vem ANTES da checagem de sessão e
 * passa pelas funções estreitas da 0057, nunca pela chave de serviço
 * (decisões 9 e 42).
 */
const crypto = require("crypto");
const hashDe = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const REST_DUT = `${URL_BASE}/rest/v1/dut_pedido`;

const rpcPub = async (nome, corpo) => {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const t = await r.text();
  if (!r.ok) { const e = new Error(t.slice(0, 200)); e.status = r.status; throw e; }
  try { return t ? JSON.parse(t) : null; } catch (x) { return null; }
};

async function dutPublico(req, res) {
  const acao = String(req.query.acao || "");

  // "Cadê o meu?" — só o estado, nunca o cadastro do comprador.
  if (acao === "estado" && req.method === "GET") {
    const prot = String(req.query.protocolo || "").trim();
    if (!prot) return res.status(400).json({ erro: "Informe o protocolo." });
    const r = await rpcPub("dut_estado", { p_protocolo: prot });
    const linha = Array.isArray(r) ? r[0] : r;
    if (!linha) return res.status(404).json({ erro: "Não achei esse protocolo." });
    return res.status(200).json({ pedido: linha });
  }

  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "método" }); }

  const c = (req.body && typeof req.body === "object") ? req.body : {};
  const placa = String(c.placa || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (placa.length < 7) return res.status(400).json({ erro: "Confira a placa." });

  /* O TIPO SAI DO QUE FOI PEDIDO, não de um botão a mais. Quem manda a
   * ATPV já preenchida quer só o reconhecimento — e esse pedido pula a
   * etapa de preenchimento inteira. Tratar os dois como um só faria
   * metade da fila parecer atrasada. */
  const tipo = c.tipo === "reconhecer" ? "reconhecer" : "preencher";
  const token = crypto.randomBytes(32).toString("base64url");

  const r = await rpcPub("dut_criar", {
    p_token_hash: hashDe(token), p_tipo: tipo, p_placa: placa,
    p_veiculo: texto(c.veiculo), p_nome: texto(c.comprador_nome),
    p_doc: texto(c.comprador_doc), p_rg: texto(c.comprador_rg),
    p_endereco: texto(c.comprador_endereco),
    p_valor: decimal(c.valor_venda), p_km: Number(String(c.km || "").replace(/\D/g, "")) || null,
    p_data: /^\d{4}-\d{2}-\d{2}$/.test(String(c.data_venda || "")) ? c.data_venda : null,
    p_entrega: c.entrega === "envio" ? "envio" : "retirada",
    p_envio: texto(c.endereco_envio), p_lojista: texto(c.lojista_nome), p_whats: texto(c.lojista_whats),
  });
  const linha = Array.isArray(r) ? r[0] : r;
  if (!linha || !linha.id) return res.status(502).json({ erro: "Não consegui registrar o pedido." });
  // O token volta UMA vez, para os anexos subirem em seguida. Ele não
  // é recuperável: o banco guarda só o hash (0057).
  return res.status(200).json({ id: linha.id, protocolo: linha.protocolo, token });
}

/* A FILA DO ADMINISTRATIVO. Quem decide é a RLS da 0057 — ler é da
 * equipe (o negociador também ouve "cadê o DUT?" na mesa), escrever é
 * de quem é administrativo ou gerente. */
async function dutFila(req, res, tok) {
  const id = String(req.query.id || "");

  if (req.method === "GET") {
    if (RX_UUID.test(id)) {
      const r = await fetch(`${REST_DUT}?select=*,dut_anexo(*)&id=eq.${id}`, { headers: cabecalhos(tok) });
      const linha = (await r.json().catch(() => []))[0];
      if (!linha) return res.status(404).json({ erro: "Pedido não encontrado." });
      return res.status(200).json({ pedido: linha });
    }
    const f = [];
    const sit = String(req.query.situacao || "");
    if (["recebido", "pendente", "preenchido", "reconhecido", "entregue", "cancelado"].indexOf(sit) >= 0) {
      f.push(`situacao=eq.${sit}`);
    } else if (sit === "abertos") {
      // O padrão é o que ainda dá trabalho: fila que mostra os
      // entregues junto obriga a procurar o que falta fazer.
      f.push("situacao=in.(recebido,pendente,preenchido,reconhecido)");
    }
    const q = String(req.query.q || "").trim().replace(/[(),*]/g, " ").trim();
    if (q) f.push(`or=(placa.ilike.*${q}*,protocolo.ilike.*${q}*,lojista_nome.ilike.*${q}*,comprador_nome.ilike.*${q}*)`);
    const lim = Math.min(300, Math.max(1, Number(req.query.limite) || 80));
    const r = await fetch(`${REST_DUT}?select=*,dut_anexo(id,rotulo,nome,tipo)&order=criado_em.desc&limit=${lim}${f.length ? `&${f.join("&")}` : ""}`,
      { headers: cabecalhos(tok) });
    if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler a fila." });
    return res.status(200).json({ pedidos: await r.json().catch(() => []) });
  }

  if (req.method === "PATCH" && RX_UUID.test(id)) {
    const c = (req.body && typeof req.body === "object") ? req.body : {};
    const mud = { atualizado_em: new Date().toISOString() };
    const eu = donoDoToken(tok);

    /* O CARIMBO É DO SERVIDOR, não da tela. "Preenchido por quem" é a
     * pergunta que importa quando o cartório devolve o papel errado —
     * e deixar a tela escolher o nome esvazia a resposta (0008). */
    const PASSOS = { preenchido: "preenchido", reconhecido: "reconhecido", entregue: "entregue" };
    if (PASSOS[c.situacao]) {
      mud.situacao = c.situacao;
      mud[`${PASSOS[c.situacao]}_em`] = new Date().toISOString();
      if (eu) mud[`${PASSOS[c.situacao]}_por`] = eu;
    } else if (c.situacao === "pendente" || c.situacao === "cancelado" || c.situacao === "recebido") {
      mud.situacao = c.situacao;
    }
    // Desfazer um passo apaga o carimbo junto: data de preenchimento
    // num pedido que voltou para a fila é mentira que ninguém vê.
    if (c.situacao === "recebido" || c.situacao === "pendente") {
      mud.preenchido_em = null; mud.preenchido_por = null;
      mud.reconhecido_em = null; mud.reconhecido_por = null;
      mud.entregue_em = null; mud.entregue_por = null;
    }
    if (typeof c.pendencia === "string") mud.pendencia = texto(c.pendencia);
    if (typeof c.observacoes === "string") mud.observacoes = texto(c.observacoes);
    if (typeof c.rastreio === "string") mud.rastreio = texto(c.rastreio);
    if (c.entrega === "envio" || c.entrega === "retirada") mud.entrega = c.entrega;

    const r = await fetch(`${REST_DUT}?id=eq.${id}`, {
      method: "PATCH", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify(mud),
    });
    const linha = (await r.json().catch(() => []))[0];
    // Lista vazia é a RLS recusando, não "não achei" (mesma tradução
    // da decisão 10).
    if (!linha) return res.status(403).json({ erro: "Só o administrativo mexe na fila do DUT." });
    return res.status(200).json({ pedido: linha });
  }

  return res.status(400).json({ erro: "Requisição inválida." });
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  // O lojista chega sem login: isto vem antes da checagem de sessão,
  // como o webhook do ZapSign e a ponte do WhatsApp.
  if (String(req.query.recurso || "") === "dut-publico") {
    try { return await dutPublico(req, res); }
    catch (e) { return res.status(e.status || 502).json({ erro: "Não consegui registrar o pedido." }); }
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  if (String(req.query.recurso || "") === "dut") {
    try { return await dutFila(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

  const aid = String(req.query.atendimento_id || "");
  if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

  try {
    if (String(req.query.recurso || "") === "documentos") {
    try { return await documentos(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

    if (req.method === "GET") {
      const r = await banco(`${REST}?select=${CAMPOS}&atendimento_id=eq.${aid}&limit=1`,
                            { headers: cabecalhos(tok) });
      const linha = Array.isArray(r) ? r[0] : null;
      // Ainda não existe é resposta normal, não erro: o atendimento
      // simplesmente não chegou na entrega.
      return res.status(200).json({ checklist: linha || null });
    }

    if (req.method === "PUT" || req.method === "PATCH") {
      let c = req.body;
      if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
      if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
      if (!c || typeof c !== "object") return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

      const linha = { atendimento_id: aid };
      ITENS.concat(ADM).forEach((k) => { if (c[k] !== undefined) linha[k] = !!c[k]; });
      VALORES.forEach((k) => { if (c[k] !== undefined) linha[k] = decimal(c[k]); });
      BANCO.forEach((k) => { if (c[k] !== undefined) linha[k] = texto(c[k]); });

      // O detalhe dos débitos manda no total. Deixar os dois entrarem
      // soltos criaria a pior das respostas: uma lista que não bate com
      // o número que o cliente assinou.
      if (c.debitos_itens !== undefined) {
        const itens = itensDeValor(c.debitos_itens);
        linha.debitos_itens = itens;
        if (itens.length) linha.valor_debitos = itens.reduce((t, x) => t + x.valor, 0);
      }
      if (c.descontos_extras !== undefined) {
        linha.descontos_extras = itensDeValor(c.descontos_extras).map((x, i) => ({
          ...x, custo: Array.isArray(c.descontos_extras) && c.descontos_extras[i]
            ? c.descontos_extras[i].custo !== false : true,
        }));
      }
      if (c.modo_conta !== undefined) {
        linha.modo_conta = MODOS_CONTA.indexOf(String(c.modo_conta)) >= 0 ? String(c.modo_conta) : "com_comissao";
      }
      if (c.observacoes !== undefined) linha.observacoes = texto(c.observacoes);

      // O carimbo da conferência é do servidor, não do cliente.
      if (ADM.some((k) => linha[k] !== undefined)) {
        if (!(await eAdministrativo(tok))) {
          return res.status(403).json({ erro: "A conferência é da tela do administrativo." });
        }
      }
      if (ADM.some((k) => linha[k])) {
        linha.adm_conferido_por = donoDoToken(tok);
        linha.adm_conferido_em = new Date().toISOString();
      }

      const r = await banco(`${REST}?on_conflict=atendimento_id`, {
        method: "POST",
        headers: json(tok, { Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify(linha),
      });
      const salvo = Array.isArray(r) ? r[0] : r;
      if (!salvo) return res.status(403).json({ erro: "Sem permissão para gravar este check list." });
      return res.status(200).json({ ok: true, checklist: salvo });
    }

    res.setHeader("Allow", "GET, PUT, PATCH");
    return res.status(405).json({ erro: "Use GET ou PUT." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: String(e.message) || "Falha no check list." });
  }
};
