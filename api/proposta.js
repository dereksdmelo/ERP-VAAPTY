/**
 * /api/proposta — o que cada lojista ofertou por um carro.
 *
 * GET ?atendimento_id=   as propostas, da maior para a menor
 * POST                   { atendimento_id, lojista, valor, observacao }
 * PATCH ?id=             { valor, apresentada, observacao }
 * DELETE ?id=
 *
 * Na planilha isso eram quatro pares de colunas PROPOSTAS/LOJISTA, o
 * que limitava a quatro e obrigava a apagar para registrar a quinta.
 * Aqui é uma linha por proposta.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

const REST = `${URL_BASE}/rest/v1/proposta`;

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};
const decimal = (v) => {
  let s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

async function banco(url, opcoes) {
  let r;
  try { r = await fetch(url, opcoes); }
  catch (e) { const x = new Error("Não consegui falar com o banco."); x.status = 502; throw x; }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a operação.";
    const x = new Error(String(msg));
    x.status = r.status === 401 ? 401 : 502;
    throw x;
  }
  return dado;
}

async function lerCorpo(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : null;
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  try {
    if (req.method === "GET") {
      const aid = String(req.query.atendimento_id || "");
      if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
      const lista = await banco(
        `${REST}?select=id,lojista,valor,apresentada,observacao,recebida_em&atendimento_id=eq.${aid}&order=valor.desc.nullslast`,
        { headers: cabecalhos(tok) }
      );
      return res.status(200).json({ propostas: lista || [] });
    }

    if (req.method === "POST") {
      const c = await lerCorpo(req);
      if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

      const aid = String(c.atendimento_id || "");
      if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

      const lojista = texto(c.lojista);
      if (!lojista) return res.status(400).json({ erro: "Diga de qual lojista é a proposta." });

      const r = await banco(REST, {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({
          atendimento_id: aid, lojista,
          valor: decimal(c.valor),
          observacao: texto(c.observacao),
          apresentada: !!c.apresentada,
        }),
      });
      return res.status(201).json({ ok: true, proposta: Array.isArray(r) ? r[0] : r });
    }

    if (req.method === "PATCH") {
      const id = String(req.query.id || "");
      if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
      const c = await lerCorpo(req);
      if (!c) return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

      const mud = {};
      if (c.valor !== undefined) mud.valor = decimal(c.valor);
      if (c.observacao !== undefined) mud.observacao = texto(c.observacao);
      if (c.apresentada !== undefined) mud.apresentada = !!c.apresentada;
      if (c.lojista !== undefined) mud.lojista = texto(c.lojista);
      if (!Object.keys(mud).length) return res.status(400).json({ erro: "Nada para atualizar." });

      const r = await banco(`${REST}?id=eq.${id}`, {
        method: "PATCH",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify(mud),
      });
      return res.status(200).json({ ok: true, proposta: Array.isArray(r) ? r[0] : r });
    }

    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
      await banco(`${REST}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos(tok) });
      return res.status(200).json({ ok: true, id });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: String(e.message) || "Falha na proposta." });
  }
};
