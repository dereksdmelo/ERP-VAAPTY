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

// O PUT dos vistos chamava `lerCorpo` e ela não existia aqui: era o
// segundo motivo de nenhum visto ter gravado (28/10/2026).
async function lerCorpo(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : null;
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

/* A ESTEIRA DO NEGÓCIO FECHADO (0089, 28/10/2026). O Derek:
 *
 *   negócios fechados (revisar) — o adm coloca todos os itens
 *   aprovações — os gerentes analisam o que o adm revisou; pelo menos dois
 *   pagamentos a realizar — revisados e aprovados, esperando o pagamento
 *   (e a opção de ver os que ainda estão em revisão, para o fluxo de caixa)
 *
 * A etapa é CALCULADA, não gravada: revisado_em, as aprovações e pago_em
 * dizem onde o negócio está, e uma coluna "etapa" seria uma segunda
 * verdade que alguém esquece de mudar.
 *
 * **Aprovação vale para a revisão que ela viu.** Devolver ao adm apaga o
 * revisado_em; quando o adm conclui de novo, as aprovações de antes ficam
 * mais velhas que a revisão e deixam de contar — quem aprovou precisa
 * olhar o que mudou. */
const APROVACOES_MINIMAS = 2;
async function quemSou(tok) {
  const id = donoDoToken(tok);
  if (!id) return null;
  const r = await banco(`${URL_BASE}/rest/v1/perfil?select=id,nome,papel,administrativo,financeiro&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
  const eu = Array.isArray(r) ? r[0] : null;
  if (!eu) return null;
  const gerente = eu.papel === "gerente";
  return { ...eu, gerente, adm: !!(eu.administrativo || gerente), fin: !!(eu.financeiro || gerente) };
}
const umaLinha = (x) => (Array.isArray(x) ? x[0] : x) || null;
function etapaDe(cl, aprov) {
  if (cl && cl.pago_em) return "pago";
  if (!cl || !cl.revisado_em) return "revisar";
  const validas = aprov.filter((a) => a.decisao === "aprovado" && String(a.criado_em) >= String(cl.revisado_em));
  return validas.length >= APROVACOES_MINIMAS ? "pagar" : "aprovar";
}
// O que falta o adm responder no check list de documentações. "Não" é
// resposta (decisão 1: gate que não se satisfaz com a verdade treina a
// mentir). Os itens de pessoa jurídica só contam se algum deles foi
// respondido — cliente pessoa física não tem contrato social.
function faltamNaRevisao(marcas, itens) {
  const ITENS_DOC = itens;
  const porItem = {};
  (marcas || []).forEach((m) => { porItem[m.item] = m; });
  const respondido = (c) => porItem[c] && porItem[c].adm !== null && porItem[c].adm !== undefined;
  const pj = ITENS_DOC.filter((i) => i[2] === "pj").some((i) => respondido(i[0]));
  const fixos = ITENS_DOC.filter((i) => i[2] !== "pj" || pj).filter((i) => !respondido(i[0])).map((i) => i[1]);
  const extras = (marcas || []).filter((m) => /^extra/.test(m.item) && (m.adm === null || m.adm === undefined)).map((m) => m.rotulo || m.item);
  return fixos.concat(extras);
}
async function esteira(req, res, tok) {
  const eu = await quemSou(tok);
  if (!eu) return res.status(403).json({ erro: "Sem perfil." });
  const RA = `${URL_BASE}/rest/v1/aprovacao_negocio`;

  if (req.method === "GET") {
    // Fechados dos últimos 120 dias, ou do mês pedido. Mais velho que
    // isso é a planilha importada, que ninguém vai revisar.
    const de = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.de || "")) ? req.query.de
      : new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.ate || "")) ? `&data=lte.${req.query.ate}` : "";
    const ats = await banco(`${URL_BASE}/rest/v1/atendimento?select=*,` +
      `veiculo(id,placa,marca_modelo),checklist(revisado_em,revisado_por,pago_em,pago_por,pago_obs,adm_conferido_em,valor_venda,valor_cliente,` +
      `valor_quitacao,valor_debitos,valor_cautelar,banco_favorecido,banco_documento,banco_nome,banco_agencia,banco_conta,banco_tipo,banco_pix)` +
      `&status=eq.fechado&data=gte.${de}${ate}&order=data.desc&limit=300`, { headers: cabecalhos(tok) }) || [];
    const ids = ats.map((a) => a.id);
    const [aprov, gente] = await Promise.all([
      ids.length ? banco(`${RA}?select=atendimento_id,perfil_id,decisao,motivo,criado_em&atendimento_id=in.(${ids.join(",")})`, { headers: cabecalhos(tok) }) : [],
      banco(`${URL_BASE}/rest/v1/perfil?select=id,nome`, { headers: cabecalhos(tok) }),
    ]);
    const nomes = {}; (gente || []).forEach((p) => { nomes[p.id] = p.nome; });
    const porAt = {};
    (aprov || []).forEach((a) => { (porAt[a.atendimento_id] = porAt[a.atendimento_id] || []).push({ ...a, nome: nomes[a.perfil_id] || "" }); });
    const negocios = ats.map((a) => {
      const cl = umaLinha(a.checklist);
      const ap = porAt[a.id] || [];
      const valem = cl && cl.revisado_em ? ap.filter((x) => String(x.criado_em) >= String(cl.revisado_em)) : [];
      const devolvido = ap.filter((x) => x.decisao === "devolvido").sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em)))[0];
      return {
        ...a, checklist: cl, veiculo: umaLinha(a.veiculo),
        etapa: etapaDe(cl, ap),
        aprovacoes: valem.filter((x) => x.decisao === "aprovado"),
        // A devolução mais recente, enquanto ninguém revisou de novo.
        devolucao: devolvido && (!cl || !cl.revisado_em || String(devolvido.criado_em) > String(cl.revisado_em)) ? devolvido : null,
        revisado_nome: cl && cl.revisado_por ? nomes[cl.revisado_por] || "" : "",
        pago_nome: cl && cl.pago_por ? nomes[cl.pago_por] || "" : "",
        eu_aprovei: valem.some((x) => x.perfil_id === eu.id && x.decisao === "aprovado"),
      };
    });
    return res.status(200).json({ negocios, minimo: APROVACOES_MINIMAS, eu: { id: eu.id, gerente: eu.gerente, adm: eu.adm, fin: eu.fin } });
  }

  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ erro: "Use GET ou POST." }); }
  const c = await lerCorpo(req);
  const aid = String((c && c.atendimento_id) || "");
  if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
  const acao = String(req.query.acao || "");
  const agora = new Date().toISOString();
  const gravarCl = async (campos) => {
    const r = await banco(`${REST}?on_conflict=atendimento_id`, {
      method: "POST", headers: json(tok, { Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({ atendimento_id: aid, ...campos }),
    });
    if (!umaLinha(r)) { const e = new Error("A regra do banco recusou."); e.status = 403; throw e; }
    return umaLinha(r);
  };

  if (acao === "revisado") {
    if (!eu.adm) return res.status(403).json({ erro: "Só o administrativo conclui a revisão." });
    if (c.desfazer) { await gravarCl({ revisado_em: null, revisado_por: null }); return res.status(200).json({ ok: true }); }
    const marcas = await banco(`${URL_BASE}/rest/v1/checklist_doc?select=item,adm,rotulo&atendimento_id=eq.${aid}`, { headers: cabecalhos(tok) });
    const faltam = faltamNaRevisao(marcas, await itensDoc(tok));
    if (faltam.length) return res.status(409).json({ erro: `Faltam ${faltam.length} ${faltam.length === 1 ? "item" : "itens"} do check list de documentações.`, faltam });
    await gravarCl({ revisado_em: agora, revisado_por: eu.id });
    return res.status(200).json({ ok: true });
  }

  if (acao === "aprovar") {
    if (!eu.gerente) return res.status(403).json({ erro: "Só gerente aprova." });
    const decisao = c.decisao === "devolvido" ? "devolvido" : c.decisao === "desfazer" ? "desfazer" : "aprovado";
    if (decisao === "desfazer") {
      await banco(`${RA}?atendimento_id=eq.${aid}&perfil_id=eq.${eu.id}`, { method: "DELETE", headers: cabecalhos(tok) });
      return res.status(200).json({ ok: true });
    }
    const motivo = texto(c.motivo);
    if (decisao === "devolvido" && (!motivo || motivo.length < 3)) return res.status(400).json({ erro: "Diga o que o adm precisa corrigir." });
    const cl = umaLinha(await banco(`${REST}?select=revisado_em&atendimento_id=eq.${aid}&limit=1`, { headers: cabecalhos(tok) }));
    if (!cl || !cl.revisado_em) return res.status(409).json({ erro: "Este negócio ainda não foi revisado pelo administrativo." });
    await banco(`${RA}?on_conflict=atendimento_id,perfil_id`, {
      method: "POST", headers: json(tok, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ atendimento_id: aid, perfil_id: eu.id, decisao, motivo, criado_em: agora }),
    });
    // Devolver tira da fila dos gerentes e põe de volta na do adm.
    if (decisao === "devolvido") await gravarCl({ revisado_em: null, revisado_por: null });
    return res.status(200).json({ ok: true });
  }

  if (acao === "pago") {
    if (!eu.fin) return res.status(403).json({ erro: "Só o financeiro ou o gerente marca o pagamento." });
    if (c.desfazer) { await gravarCl({ pago_em: null, pago_por: null, pago_obs: null }); return res.status(200).json({ ok: true }); }
    const ap = await banco(`${RA}?select=decisao,criado_em&atendimento_id=eq.${aid}`, { headers: cabecalhos(tok) }) || [];
    const cl = umaLinha(await banco(`${REST}?select=revisado_em,pago_em&atendimento_id=eq.${aid}&limit=1`, { headers: cabecalhos(tok) }));
    if (etapaDe(cl, ap) !== "pagar") return res.status(409).json({ erro: `Só se paga depois da revisão do adm e de ${APROVACOES_MINIMAS} aprovações.` });
    await gravarCl({ pago_em: agora, pago_por: eu.id, pago_obs: texto(c.obs) });
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ erro: "Ação desconhecida." });
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

/* A LISTA MORA NO BANCO DESDE A 0091 (28/10/2026, o Derek: "lista de
 * documentos exigidos editável"). `ITENS_DOC` acima continua como o
 * ponto de partida e a rede: se a leitura falhar, ou a tabela estiver
 * vazia, vale a lista de sempre — check list que some no meio da
 * conferência seria pior que check list desatualizado. Os desativados
 * saem da conferência mas continuam valendo para o visto que já foi
 * dado com eles (o código é a chave do visto e do anexo). */
async function listaDoc(tok, tambemInativos) {
  try {
    const r = await fetch(`${URL_BASE}/rest/v1/doc_exigido?select=codigo,rotulo,grupo,vistos,pede_doc,ordem,ativo&order=ordem.asc,codigo.asc`,
      { headers: cabecalhos(tok) });
    if (!r.ok) return null;
    const ls = await r.json().catch(() => null);
    if (!Array.isArray(ls) || !ls.length) return null;
    return tambemInativos ? ls : ls.filter((x) => x.ativo !== false);
  } catch (e) { return null; }
}
async function itensDoc(tok) {
  const ls = await listaDoc(tok, false);
  return ls ? ls.map((x) => [x.codigo, x.rotulo, x.grupo, x.vistos, x.pede_doc !== false]) : ITENS_DOC;
}
const GRUPOS_DOC_OK = ["pf", "pj", "arquivamento", "transferencia"];

/* O EDITOR DA LISTA: o gerente lê tudo (inclusive o desativado) e grava
 * a lista inteira de uma vez. Item novo ganha o código no servidor, a
 * partir do rótulo — código escolhido na tela colidiria com o de outro
 * item e herdaria os vistos dele. */
async function docExigido(req, res, tok) {
  if (req.method === "GET") {
    const ls = await listaDoc(tok, true);
    return res.status(200).json({
      itens: ls || ITENS_DOC.map((x, i) => ({ codigo: x[0], rotulo: x[1], grupo: x[2], vistos: x[3], pede_doc: x[4], ordem: (i + 1) * 10, ativo: true })),
      do_banco: !!ls,
    });
  }
  if (req.method !== "PUT") { res.setHeader("Allow", "GET, PUT"); return res.status(405).json({ erro: "Use GET ou PUT." }); }
  const eu = await quemSou(tok);
  if (!eu || !eu.gerente) return res.status(403).json({ erro: "Só o gerente muda a lista de documentos." });
  const c = await lerCorpo(req);
  const itens = c && Array.isArray(c.itens) ? c.itens : null;
  if (!itens || !itens.length) return res.status(400).json({ erro: "Mande a lista." });
  const usados = new Set();
  const semAcento = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const linhas = [];
  for (let i = 0; i < itens.length; i++) {
    const x = itens[i] || {};
    const rotulo = texto(x.rotulo);
    if (!rotulo) return res.status(400).json({ erro: `O item ${i + 1} está sem nome.` });
    let codigo = String(x.codigo || "").trim();
    if (!/^[a-z0-9_]{2,60}$/.test(codigo)) {
      const base = semAcento(rotulo).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "item";
      codigo = base; let n = 2;
      while (usados.has(codigo) || /^extra/.test(codigo)) codigo = `${base}_${n++}`;
    }
    if (usados.has(codigo)) return res.status(400).json({ erro: `"${rotulo}" aparece duas vezes.` });
    usados.add(codigo);
    linhas.push({
      codigo, rotulo,
      grupo: GRUPOS_DOC_OK.indexOf(x.grupo) >= 0 ? x.grupo : "pf",
      vistos: x.vistos === "um" ? "um" : "tres",
      pede_doc: x.pede_doc !== false,
      ordem: (i + 1) * 10,
      ativo: x.ativo !== false,
      atualizado_em: new Date().toISOString(),
    });
  }
  const r = await fetch(`${URL_BASE}/rest/v1/doc_exigido?on_conflict=codigo`, {
    method: "POST", headers: json(tok, { Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(linhas),
  });
  const salvo = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(salvo)) return res.status(r.ok ? 403 : 502).json({ erro: (salvo && salvo.message) || "O banco recusou a lista." });
  return res.status(200).json({ ok: true, itens: salvo });
}

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
    return res.status(200).json({ itens: (await itensDoc(tok)).concat(extras), marcas });
  }

  if (req.method === "PUT") {
    const corpo = await lerCorpo(req);
    if (!corpo) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const aid = String(corpo.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    const item = String(corpo.item || "");
    const eExtra = /^extra_[a-z0-9_]{1,40}$/.test(item);
    // Item desativado ainda aceita visto: o que já foi dado com ele não
    // pode ficar sem como ser corrigido.
    const conhecidos = ((await listaDoc(tok, true)) || ITENS_DOC.map((x) => ({ codigo: x[0] }))).map((x) => x.codigo);
    if (conhecidos.indexOf(item) < 0 && !eExtra) return res.status(400).json({ erro: "Item desconhecido." });

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

/* O LOJISTA É AVISADO SOZINHO (28/10/2026). O Derek: "uma automação pra
 * avisar automaticamente o lojista que o documento já foi reconhecido e
 * está pronto pra ser retirado… e caso esteja faltando algo, faça a mesma
 * coisa… tudo pelo celular do adm, é claro".
 *
 * Sai pelo número de operação (0058, `comercial = false`) — o do
 * administrativo, que é o que o lojista conhece —, pela ponte, e entra
 * na conversa como mensagem da loja: quem abrir o WhatsApp do adm vê o
 * que foi dito. **Nunca derruba a mudança de etapa**: o pedido já mudou
 * quando isto roda; se falhar, a tela diz e o botão "WhatsApp" do cartão
 * continua ali para mandar à mão (a régua do aviso de chegada, decisão
 * 63). O texto é fixo e curto, e o "falta" é o que a pessoa escreveu —
 * o mesmo que o lojista lê na consulta do protocolo. */
function textoAoLojista(p, tipo, site) {
  const ola = p.lojista_nome ? `Olá, ${String(p.lojista_nome).trim()}!` : "Olá!";
  const qual = `o DUT da placa ${p.placa} (protocolo ${p.protocolo})`;
  const corpo = tipo === "pronto"
    ? (p.entrega === "envio"
      ? `${ola} ${qual[0].toUpperCase()}${qual.slice(1)} já foi reconhecido em cartório e vai ser enviado. Assim que sair, mandamos o rastreio.`
      : `${ola} ${qual[0].toUpperCase()}${qual.slice(1)} já foi reconhecido em cartório e está pronto para retirada aqui na Vaapty.`)
    : `${ola} Sobre ${qual}, está faltando:\n\n${String(p.pendencia || "").trim()}\n\nAssim que estiver resolvido, a gente segue com o pedido.`;
  return site ? `${corpo}\n\nVocê acompanha pelo protocolo em ${site}/dut.html` : corpo;
}
async function avisarLojista(req, tok, p, tipo) {
  try {
    let fone = String(p.lojista_whats || "").replace(/\D/g, "");
    if (fone.length < 10) return { enviado: false, erro: "o pedido não tem o WhatsApp do lojista" };
    if (fone.length <= 11) fone = `55${fone}`;
    const segredo = process.env.PONTE_SEGREDO || "";
    const base = process.env.PONTE_URL || "";
    if (!segredo || (!req.ponte && !base)) return { enviado: false, erro: "a ponte do WhatsApp não está configurada" };
    const canais = (await (await fetch(`${URL_BASE}/rest/v1/wa_canal?select=slug,nome&comercial=eq.false&ativo=eq.true&telefone=not.is.null&order=slug`,
      { headers: cabecalhos(tok) })).json().catch(() => [])) || [];
    const canal = canais.find((x) => /adm/i.test(`${x.slug} ${x.nome}`)) || canais[0];
    if (!canal) return { enviado: false, erro: "nenhum número do administrativo ligado" };
    const host = String((req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "");
    const texto = textoAoLojista(p, tipo, host ? `https://${host}` : "");
    const alvo = `${base || "https://ponte"}/enviar?canal=${encodeURIComponent(canal.slug)}`;
    const pedido = {
      method: "POST", signal: AbortSignal.timeout(30000),
      headers: { "x-ponte-segredo": segredo, "Content-Type": "application/json" },
      body: JSON.stringify({ para: fone, conteudo: { type: "text", text: { body: texto } } }),
    };
    const r = req.ponte ? await req.ponte.fetch(alvo, pedido) : await fetch(alvo, pedido);
    const d = await r.json().catch(() => ({}));
    if (!d || !d.ok) return { enviado: false, erro: String((d && d.erro) || `a ponte respondeu ${r.status}`).slice(0, 160), texto };
    // Na conversa, como mensagem da loja: a ponte não ecoa o que manda.
    try {
      await fetch(`${URL_BASE}/rest/v1/rpc/wa_receber`, {
        method: "POST", headers: json(tok),
        body: JSON.stringify({ p_canal: canal.slug, p_telefone: fone, p_nome: "", p_wa_id: String(d.id || `dut-${p.id}-${Date.now()}`),
          p_eco: true, p_tipo: "texto", p_texto: texto, p_anexo: null, p_quando: new Date().toISOString(), p_anuncio: null }),
      });
    } catch (e) {}
    return { enviado: true, canal: canal.nome, tipo };
  } catch (e) {
    return { enviado: false, erro: "a ponte não respondeu" };
  }
}

/* PELO NÚMERO DO ADM, texto ou arquivo, e gravado na conversa como da
 * loja (a ponte não ecoa o que manda). Um lugar só para o DUT e para as
 * transferências: o canal é o de operação (0058) com "adm" no nome. */
async function mandarPeloAdm(req, tok, telefone, conteudo, textoNaConversa) {
  let fone = String(telefone || "").replace(/\D/g, "");
  if (fone.length < 10) return { enviado: false, erro: "o lojista não tem WhatsApp com DDD no cadastro" };
  if (fone.length <= 11) fone = `55${fone}`;
  const segredo = process.env.PONTE_SEGREDO || "";
  const base = process.env.PONTE_URL || "";
  if (!segredo || (!req.ponte && !base)) return { enviado: false, erro: "a ponte do WhatsApp não está configurada" };
  const canais = (await (await fetch(`${URL_BASE}/rest/v1/wa_canal?select=slug,nome&comercial=eq.false&ativo=eq.true&telefone=not.is.null&order=slug`,
    { headers: cabecalhos(tok) })).json().catch(() => [])) || [];
  const canal = canais.find((x) => /adm/i.test(`${x.slug} ${x.nome}`)) || canais[0];
  if (!canal) return { enviado: false, erro: "nenhum número do administrativo ligado" };
  try {
    const alvo = `${base || "https://ponte"}/enviar?canal=${encodeURIComponent(canal.slug)}`;
    const pedido = {
      method: "POST", signal: AbortSignal.timeout(40000),
      headers: { "x-ponte-segredo": segredo, "Content-Type": "application/json" },
      body: JSON.stringify({ para: fone, conteudo }),
    };
    const r = req.ponte ? await req.ponte.fetch(alvo, pedido) : await fetch(alvo, pedido);
    const d = await r.json().catch(() => ({}));
    if (!d || !d.ok) return { enviado: false, erro: String((d && d.erro) || `a ponte respondeu ${r.status}`).slice(0, 160), fone };
    try {
      await fetch(`${URL_BASE}/rest/v1/rpc/wa_receber`, {
        method: "POST", headers: json(tok),
        body: JSON.stringify({ p_canal: canal.slug, p_telefone: fone, p_nome: "", p_wa_id: String(d.id || `adm-${Date.now()}`),
          p_eco: true, p_tipo: conteudo.type === "document" ? "midia" : "texto", p_texto: textoNaConversa || "",
          p_anexo: conteudo.type === "document" ? { tipo: "document", nome: conteudo.document.filename || "" } : null,
          p_quando: new Date().toISOString(), p_anuncio: null }),
      });
    } catch (e) {}
    return { enviado: true, canal: canal.nome, id: d.id || null, fone };
  } catch (e) { return { enviado: false, erro: "a ponte não respondeu", fone }; }
}

/* A TRANSFERÊNCIA DOS CARROS VENDIDOS AOS LOJISTAS (0092, 28/10/2026).
 * A lista é do adm e do gerente; os interruptores das automações, do
 * gerente. O prazo é de 3 meses da venda (`regras/lojista.js`). */
const LOJ = require("../regras/lojista.js");
async function transferencia(req, res, tok) {
  const eu = await quemSou(tok);
  if (!eu || !eu.adm) return res.status(403).json({ erro: "As transferências são do administrativo." });
  const RE = `${URL_BASE}/rest/v1/estoque`;
  const site = (() => { const h = String((req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || ""); return h ? `https://${h}` : ""; })();

  if (req.method === "GET") {
    const [carros, cfg] = await Promise.all([
      fetch(`${RE}?select=id,atendimento_id,vendido_em,entrou_em,semana_venda,transferido_em,transferido_obs,natureza,` +
        `veiculo(placa,marca_modelo),comprador(id,nome,telefone)&situacao=eq.vendido&natureza=neq.indicacao&order=vendido_em.desc.nullslast,entrou_em.desc&limit=1000`,
        { headers: cabecalhos(tok) }).then((r) => r.json()).catch(() => []),
      fetch(`${URL_BASE}/rest/v1/config_loja?select=lojista_lembretes,lojista_boas_vindas,lojista_crlv&id=eq.1`, { headers: cabecalhos(tok) })
        .then((r) => r.json()).then((x) => (Array.isArray(x) && x[0]) || {}).catch(() => ({})),
    ]);
    const lista = Array.isArray(carros) ? carros : [];
    const ids = lista.filter((c) => !c.transferido_em).map((c) => c.id);
    const avisos = ids.length ? await fetch(`${URL_BASE}/rest/v1/aviso_lojista?select=estoque_id,tipo,estado,criado_em&estoque_id=in.(${ids.slice(0, 400).join(",")})`,
      { headers: cabecalhos(tok) }).then((r) => r.json()).catch(() => []) : [];
    const placas = Array.from(new Set(lista.map((c) => c.veiculo && c.veiculo.placa).filter(Boolean)));
    const duts = placas.length ? await fetch(`${URL_BASE}/rest/v1/dut_pedido?select=placa,situacao,protocolo,criado_em&placa=in.(${placas.slice(0, 400).map((p) => encodeURIComponent(p)).join(",")})&order=criado_em.desc`,
      { headers: cabecalhos(tok) }).then((r) => r.json()).catch(() => []) : [];
    const porAviso = {}; (Array.isArray(avisos) ? avisos : []).forEach((a) => { (porAviso[a.estoque_id] = porAviso[a.estoque_id] || []).push(a); });
    const porDut = {}; (Array.isArray(duts) ? duts : []).forEach((d) => { if (!porDut[d.placa]) porDut[d.placa] = d; });
    return res.status(200).json({
      carros: lista.map((c) => {
        const base = c.vendido_em || c.entrou_em || null;
        return { ...c, base, estimada: !c.vendido_em, prazo: base ? LOJ.prazoDe(base) : null,
          avisos: porAviso[c.id] || [], dut: c.veiculo && porDut[c.veiculo.placa] || null };
      }),
      config: cfg, eu: { gerente: eu.gerente, adm: eu.adm },
    });
  }

  const c = await lerCorpo(req) || {};
  const acao = String(req.query.acao || "");

  if (acao === "config") {
    if (!eu.gerente) return res.status(403).json({ erro: "Só o gerente liga e desliga as automações." });
    const mud = {};
    ["lojista_lembretes", "lojista_boas_vindas", "lojista_crlv"].forEach((k) => { if (typeof c[k] === "boolean") mud[k] = c[k]; });
    if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para mudar." });
    const r = await fetch(`${URL_BASE}/rest/v1/config_loja?id=eq.1`, { method: "PATCH", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify(mud) });
    const x = await r.json().catch(() => []);
    if (!Array.isArray(x) || !x[0]) return res.status(403).json({ erro: "A regra do banco recusou." });
    return res.status(200).json({ config: x[0] });
  }

  const eid = String(c.estoque_id || "");
  if (!RX_UUID.test(eid)) return res.status(400).json({ erro: "estoque_id inválido." });

  if (acao === "transferido") {
    const mud = c.desfazer ? { transferido_em: null, transferido_por: null, transferido_obs: null }
      : { transferido_em: /^\d{4}-\d{2}-\d{2}$/.test(String(c.data || "")) ? c.data : new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }),
          transferido_por: eu.id, transferido_obs: texto(c.obs) };
    const r = await fetch(`${RE}?id=eq.${eid}`, { method: "PATCH", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify(mud) });
    const x = await r.json().catch(() => []);
    if (!Array.isArray(x) || !x[0]) return res.status(403).json({ erro: "A regra do banco recusou." });
    return res.status(200).json({ ok: true });
  }

  /* BOAS-VINDAS E CRLV. Do clique de quem confirmou a venda (com
   * `auto`, obedecem aos interruptores e saem uma vez por carro) ou do
   * botão da tela (sem `auto`, mandam de novo se a pessoa pediu). */
  if (acao === "boas-vindas" || acao === "crlv") {
    const car = ((await fetch(`${RE}?select=id,atendimento_id,vendido_em,veiculo(placa,marca_modelo),comprador(nome,telefone)&id=eq.${eid}`,
      { headers: cabecalhos(tok) }).then((r) => r.json()).catch(() => [])) || [])[0];
    if (!car) return res.status(404).json({ erro: "Carro não encontrado no estoque." });
    const cfg = c.auto ? ((await fetch(`${URL_BASE}/rest/v1/config_loja?select=lojista_boas_vindas,lojista_crlv&id=eq.1`, { headers: cabecalhos(tok) })
      .then((r) => r.json()).catch(() => [])) || [])[0] || {} : { lojista_boas_vindas: true, lojista_crlv: true };
    const jaFoi = c.auto ? ((await fetch(`${URL_BASE}/rest/v1/aviso_lojista?select=tipo&estoque_id=eq.${eid}&estado=eq.enviado`, { headers: cabecalhos(tok) })
      .then((r) => r.json()).catch(() => [])) || []).map((a) => a.tipo) : [];
    const x = { nome: car.comprador && car.comprador.nome, carro: car.veiculo && car.veiculo.marca_modelo, placa: car.veiculo && car.veiculo.placa, vendido_em: car.vendido_em };
    const fone = car.comprador && car.comprador.telefone;
    const gravar = (tipo, r, txt) => fetch(`${URL_BASE}/rest/v1/aviso_lojista?on_conflict=estoque_id,tipo`, {
      method: "POST", headers: json(tok, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({ estoque_id: eid, tipo, estado: r.enviado ? "enviado" : "falhou", telefone: r.fone || null, texto: txt, erro: r.erro || null, wa_id: r.id || null, criado_em: new Date().toISOString() }),
    }).catch(() => {});
    const saida = {};
    if (acao === "boas-vindas" && cfg.lojista_boas_vindas && jaFoi.indexOf("boas_vindas") < 0) {
      const txt = LOJ.textoLojista("boas_vindas", x, site);
      saida.boas_vindas = await mandarPeloAdm(req, tok, fone, { type: "text", text: { body: txt } }, txt);
      await gravar("boas_vindas", saida.boas_vindas, txt);
    }
    if (cfg.lojista_crlv && jaFoi.indexOf("crlv") < 0 && (acao === "crlv" || acao === "boas-vindas")) {
      let arq = null;
      try { arq = car.atendimento_id ? await require("./foto.js").crlvParaLojista(tok, car.atendimento_id) : null; } catch (e) {}
      if (arq) {
        const leg = LOJ.textoLojista("crlv", x, site);
        saida.crlv = await mandarPeloAdm(req, tok, fone,
          { type: "document", document: { link: arq.url, filename: `CRLV ${x.placa || ""}.pdf`.replace(/\s+\.pdf$/, ".pdf"), mime_type: arq.tipo, caption: leg } }, leg);
        await gravar("crlv", saida.crlv, leg);
      } else saida.crlv = { enviado: false, erro: "o CRLV não está anexado no check list de documentações" };
    }
    return res.status(200).json(saida);
  }
  return res.status(400).json({ erro: "Ação desconhecida." });
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
    if (["recebido", "pendente", "preenchido", "no_cartorio", "reconhecido", "entregue", "cancelado"].indexOf(sit) >= 0) {
      f.push(`situacao=eq.${sit}`);
    } else if (sit === "abertos") {
      // O padrão é o que ainda dá trabalho: fila que mostra os
      // entregues junto obriga a procurar o que falta fazer.
      f.push("situacao=in.(recebido,pendente,preenchido,no_cartorio,reconhecido)");
    }
    const q = String(req.query.q || "").trim().replace(/[(),*]/g, " ").trim();
    if (q) f.push(`or=(placa.ilike.*${q}*,protocolo.ilike.*${q}*,lojista_nome.ilike.*${q}*,comprador_nome.ilike.*${q}*)`);
    const lim = Math.min(300, Math.max(1, Number(req.query.limite) || 80));
    /* QUEM marcou cada passo vem junto (19/10/2026): o financeiro pediu
     * "um relatório de quando foi atualizado", e a data sem o nome não
     * responde a pergunta que vem logo depois. São três chaves para a
     * mesma `perfil`, então cada embutido diz por qual coluna vai. Se o
     * PostgREST não aceitar a dica, a fila volta sem os nomes em vez de
     * não voltar. */
    const resto = `&order=criado_em.desc&limit=${lim}${f.length ? `&${f.join("&")}` : ""}`;
    const QUEM = ",preenchido_por_perfil:perfil!preenchido_por(nome),cartorio_por_perfil:perfil!cartorio_por(nome),reconhecido_por_perfil:perfil!reconhecido_por(nome),entregue_por_perfil:perfil!entregue_por(nome)";
    let r = await fetch(`${REST_DUT}?select=*,dut_anexo(id,rotulo,nome,tipo)${QUEM}${resto}`, { headers: cabecalhos(tok) });
    if (!r.ok && r.status !== 401) r = await fetch(`${REST_DUT}?select=*,dut_anexo(id,rotulo,nome,tipo)${resto}`, { headers: cabecalhos(tok) });
    if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler a fila." });
    return res.status(200).json({ pedidos: await r.json().catch(() => []) });
  }

  if (req.method === "PATCH" && RX_UUID.test(id)) {
    const c = (req.body && typeof req.body === "object") ? req.body : {};
    const mud = { atualizado_em: new Date().toISOString() };
    // Como estava antes: o aviso ao lojista só sai quando a etapa MUDA,
    // não a cada "Salvar" do mesmo pedido.
    let antes = {};
    try { antes = ((await (await fetch(`${REST_DUT}?select=situacao,pendencia&id=eq.${id}`, { headers: cabecalhos(tok) })).json()) || [])[0] || {}; } catch (e) {}
    const eu = donoDoToken(tok);

    /* O CARIMBO É DO SERVIDOR, não da tela. "Preenchido por quem" é a
     * pergunta que importa quando o cartório devolve o papel errado —
     * e deixar a tela escolher o nome esvazia a resposta (0008). */
    // "no_cartorio" (0090): levar ao cartório é passo com data e nome.
    const PASSOS = { preenchido: "preenchido", no_cartorio: "cartorio", reconhecido: "reconhecido", entregue: "entregue" };
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
      mud.cartorio_em = null; mud.cartorio_por = null;
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
    const pronto = linha.situacao === "reconhecido" && antes.situacao !== "reconhecido";
    const falta = linha.situacao === "pendente" && !!linha.pendencia && (antes.situacao !== "pendente" || antes.pendencia !== linha.pendencia);
    const aviso = pronto || falta ? await avisarLojista(req, tok, linha, pronto ? "pronto" : "falta") : null;
    return res.status(200).json({ pedido: linha, aviso });
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

  /* O VISTO NUNCA GRAVOU, e isso durou desde a 0027. Esta rota
   * conferia o `atendimento_id` da QUERY antes de chegar aqui, e a tela
   * manda o do PUT no corpo: todo visto voltava 400 "atendimento_id
   * inválido". Em 28/10/2026 a `checklist_doc` tinha zero linhas. A rota
   * dos documentos lê o atendimento sozinha (query no GET, corpo no PUT),
   * então ela vem antes da conferência. */
  if (String(req.query.recurso || "") === "documentos") {
    try { return await documentos(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }
  if (String(req.query.recurso || "") === "transferencia") {
    try { return await transferencia(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }
  if (String(req.query.recurso || "") === "doc-exigido") {
    try { return await docExigido(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }
  if (String(req.query.recurso || "") === "esteira") {
    try { return await esteira(req, res, tok); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

  const aid = String(req.query.atendimento_id || "");
  if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

  try {

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
