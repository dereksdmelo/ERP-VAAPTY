/**
 * /api/fipe — a tabela FIPE, para conferência.
 *
 *   GET ?acao=marcas
 *   GET ?acao=modelos&marca=26
 *   GET ?acao=anos&marca=26&modelo=4925
 *   GET ?acao=valor&marca=26&modelo=4925&ano=2010-1
 *
 * Por que existe, se /api/placa já traz o valor FIPE: são fontes
 * diferentes. A Placa Fipe *adivinha* a versão a partir da placa e
 * devolve candidatas com percentual de similaridade. Versão errada
 * contamina o FIPE, que contamina o POR, que contamina a negociação.
 * Aqui o negociador confirma escolhendo à mão.
 *
 * POR QUE NÃO A FIPE OFICIAL: veiculos.fipe.org.br está atrás do
 * Cloudflare e devolve 403 para requisição de servidor; do navegador,
 * o CORS barra. Contornar proteção anti-robô está fora de questão.
 * A Parallelum espelha a mesma tabela e é aberta a uso programático.
 *
 * O QUE SE PERDE: a Parallelum não tem caminho ano → modelos, então a
 * ordem é marca → modelo → ano, e não marca → ano → modelo como o
 * Derek pediu. A lista de modelos de uma marca é longa (261 na
 * Hyundai), e por isso a tela tem busca por texto. Ver PENDENCIAS.md.
 */

const BASE = "https://parallelum.com.br/fipe/api/v1/carros/marcas";
const ANON = process.env.SUPABASE_ANON_KEY || "";

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const codigo = (v) => {
  const s = String(v == null ? "" : v).trim();
  return /^[\w-]{1,20}$/.test(s) ? s : null;
};

async function buscar(caminho) {
  let r, texto;
  try {
    r = await fetch(`${BASE}${caminho}`, { headers: { Accept: "application/json" } });
    texto = await r.text();
  } catch (e) {
    const x = new Error("Não consegui alcançar a tabela FIPE.");
    x.status = 502;
    throw x;
  }
  let dado = null;
  try { dado = texto ? JSON.parse(texto) : null; } catch (e) {}
  if (!r.ok || dado == null) {
    const pedaco = String(texto || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
    const x = new Error(`A tabela FIPE respondeu ${r.status}${pedaco ? `: ${pedaco}` : " sem corpo"}.`);
    x.status = 502;
    throw x;
  }
  return dado;
}

// "R$ 44.935,00" → 44935
const valorNumerico = (s) => {
  const n = Number(String(s || "").replace(/[^\d,]/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
};

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ erro: "Use GET." });
  }
  if (!ANON) return res.status(500).json({ erro: "SUPABASE_ANON_KEY não configurada." });
  if (!tokenDe(req)) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  const acao = String(req.query.acao || "");
  const marca = codigo(req.query.marca);
  const modelo = codigo(req.query.modelo);
  const ano = codigo(req.query.ano);

  // A tabela muda uma vez por mês: um dia na borda é conservador.
  const guardar = () => res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");

  try {
    if (acao === "marcas") {
      const d = await buscar("");
      guardar();
      return res.status(200).json({ marcas: (d || []).map((m) => ({ codigo: m.codigo, nome: m.nome })) });
    }

    if (acao === "modelos") {
      if (!marca) return res.status(400).json({ erro: "Informe a marca." });
      const d = await buscar(`/${marca}/modelos`);
      guardar();
      return res.status(200).json({
        modelos: (d.modelos || []).map((m) => ({ codigo: m.codigo, nome: m.nome })),
      });
    }

    if (acao === "anos") {
      if (!marca || !modelo) return res.status(400).json({ erro: "Informe marca e modelo." });
      const d = await buscar(`/${marca}/modelos/${modelo}/anos`);
      guardar();
      return res.status(200).json({ anos: (d || []).map((a) => ({ codigo: a.codigo, nome: a.nome })) });
    }

    if (acao === "valor") {
      if (!marca || !modelo || !ano) return res.status(400).json({ erro: "Informe marca, modelo e ano." });
      const d = await buscar(`/${marca}/modelos/${modelo}/anos/${ano}`);
      if (!d || !d.Valor) return res.status(422).json({ erro: "A FIPE não tem valor para essa combinação." });
      guardar();
      return res.status(200).json({
        valor: valorNumerico(d.Valor),
        valor_texto: d.Valor,
        marca: d.Marca,
        modelo: d.Modelo,
        ano_modelo: d.AnoModelo,
        combustivel: d.Combustivel,
        codigo_fipe: d.CodigoFipe,
        mes_referencia: String(d.MesReferencia || "").trim(),
      });
    }

    return res.status(400).json({ erro: "Ação desconhecida. Use marcas, modelos, anos ou valor." });
  } catch (e) {
    return res.status(e.status || 502).json({ erro: String(e.message) || "Falha ao consultar a FIPE." });
  }
};
