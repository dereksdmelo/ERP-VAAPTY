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
 * Duas mãos preenchem: o negociador na entrega e o administrativo na
 * conferência. Quando qualquer item do administrativo é marcado, o
 * servidor carimba quem conferiu e quando — o cliente não escolhe esse
 * valor, senão "conferido" não responde a pergunta que importa quando
 * algo dá errado.
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

const ITENS = [
  "recibo_compra_venda", "segunda_via_dut", "licenciamento_atual", "transferencia",
  "emplacamento_mercosul", "outros_itens", "comprovante_residencia",
  "copia_cnh_titular", "manual_chave_copia",
];
const ADM = ["adm_entrada", "adm_saida", "adm_debitos", "adm_quitacao", "adm_outros", "adm_laudo_cautelar"];
const VALORES = ["valor_venda", "valor_cautelar", "valor_debitos", "valor_quitacao", "comissao_vaapty", "valor_cliente"];
const BANCO = ["banco_favorecido", "banco_documento", "banco_nome", "banco_agencia", "banco_conta", "banco_tipo", "banco_pix"];

const CAMPOS = ["id", "atendimento_id"].concat(ITENS, ADM, VALORES, BANCO,
  ["adm_conferido_por", "adm_conferido_em", "observacoes", "atualizado_em"]).join(",");

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

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }
  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

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
      if (c.observacoes !== undefined) linha.observacoes = texto(c.observacoes);

      // O carimbo da conferência é do servidor, não do cliente.
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
