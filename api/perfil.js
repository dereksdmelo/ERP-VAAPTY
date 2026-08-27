/**
 * GET /api/perfil
 *
 * Quem sou eu neste sistema. Devolve nome, papel e se o perfil está
 * ativo — a tela precisa disso para dizer "seu acesso ainda não foi
 * liberado" em vez de mostrar telas vazias.
 *
 * Para o gerente, devolve também a equipe. A RLS da 0004 é que decide:
 * a mesma consulta traz uma linha para negociador e todas para gerente.
 * Não há checagem de papel aqui — se houvesse, seriam duas regras para
 * manter em sincronia.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

/**
 * O id do usuário, lido do miolo do token sem verificar assinatura.
 * Serve só para saber qual das linhas devolvidas é a dele — o gerente
 * recebe a equipe inteira. Quem valida o token de verdade é o banco,
 * que já recusou a consulta se ele fosse falso.
 */
function donoDoToken(tok) {
  try {
    const meio = String(tok).replace(/^Bearer\s+/, "").split(".")[1];
    if (!meio) return null;
    const base = meio.replace(/-/g, "+").replace(/_/g, "/");
    const dados = JSON.parse(Buffer.from(base, "base64").toString("utf8"));
    return dados.sub || null;
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ erro: "Use GET." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  let r, corpo;
  try {
    r = await fetch(`${URL_BASE}/rest/v1/perfil?select=id,nome,papel,ativo&order=nome.asc`, {
      headers: { apikey: ANON, Authorization: tok },
    });
    corpo = await r.text();
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com o banco." });
  }

  if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler o perfil." });

  let linhas = [];
  try { linhas = JSON.parse(corpo) || []; } catch (e) {}

  // Sem perfil ativo a RLS não devolve nada — inclusive o próprio.
  // Nesse caso a conta existe mas ainda não foi liberada.
  if (!linhas.length) {
    return res.status(200).json({ eu: null, equipe: [], liberado: false });
  }

  const meuId = donoDoToken(tok);
  const eu = linhas.filter((l) => l.id === meuId)[0] || (linhas.length === 1 ? linhas[0] : null);

  // O gerente recebe a lista inteira; os outros, só a própria linha.
  return res.status(200).json({ eu, equipe: linhas, liberado: true });
};
