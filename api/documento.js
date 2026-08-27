/**
 * /api/documento — registro dos documentos gerados no atendimento.
 *
 * POST { veiculo_id, tipo, rodada, protocolo, conteudo, negociador }
 *      grava uma linha. Cada geração é um evento; segunda via é linha
 *      nova, com protocolo novo.
 * GET  ?veiculo_id=   o que já foi gerado, do mais recente para o mais
 *      antigo, sem o conteúdo (que é grande e ninguém lê em lista).
 *
 * Mesmas regras do resto de api/: fetch puro, sem biblioteca, e a chave
 * de serviço não sai daqui — nem em resposta, nem em log.
 *
 * Depende da migração 0003.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_KEY || "";

const TIPOS = ["termo_aceite", "autorizacao_cautelar", "pre_contrato"];
const MAX_CONTEUDO = 200 * 1024;   // o modelo maior hoje dá ~9 KB

const REST = (tabela) => `${URL_BASE}/rest/v1/${tabela}`;
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

const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

const limpar = (s) => {
  const t = String(s == null ? "" : s);
  return CHAVE ? t.split(CHAVE).join("[oculto]") : t;
};

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};

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
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a gravação.";
    const erro = new Error(limpar(msg));
    erro.status = r.status === 401 || r.status === 403 ? 500 : 502;
    throw erro;
  }
  return dado;
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json(SEM_LOGIN);

  try {
    if (req.method === "GET") {
      const vid = String(req.query.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const linhas = await banco(
        `${REST("documento")}?select=id,tipo,rodada,protocolo,gerado_em&veiculo_id=eq.${vid}&order=gerado_em.desc`,
        { headers: cabecalhos(tok) }
      );
      return res.status(200).json({ documentos: linhas || [] });
    }

    if (req.method === "POST") {
      let corpo = req.body;
      if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
      if (!corpo || typeof corpo !== "object") {
        return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
      }

      const vid = String(corpo.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const tipo = String(corpo.tipo || "");
      if (TIPOS.indexOf(tipo) < 0) return res.status(400).json({ erro: "Tipo de documento desconhecido." });

      const conteudo = texto(corpo.conteudo);
      if (conteudo && conteudo.length > MAX_CONTEUDO) {
        return res.status(413).json({ erro: "Documento grande demais para registrar." });
      }

      // Só o termo de aceite tem rodada; nos outros a coluna fica nula.
      const rodada = tipo === "termo_aceite" && Number.isFinite(Number(corpo.rodada))
        ? Math.trunc(Number(corpo.rodada))
        : null;

      const r = await banco(REST("documento"), {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({
          veiculo_id: vid, tipo, rodada,
          protocolo: texto(corpo.protocolo),
          conteudo,
          negociador: texto(corpo.negociador),
        }),
      });
      const linha = Array.isArray(r) ? r[0] : r;

      return res.status(201).json({
        ok: true,
        id: linha ? linha.id : null,
        tipo,
        gerado_em: (linha && linha.gerado_em) || new Date().toISOString(),
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Use GET ou POST." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha ao registrar o documento." });
  }
};
