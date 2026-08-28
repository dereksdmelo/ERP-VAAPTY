/**
 * /api/fipe — a tabela FIPE oficial, para conferência.
 *
 *   GET ?acao=marcas
 *   GET ?acao=modelos&marca=26&ano=2010
 *   GET ?acao=valor&marca=26&modelo=4925&ano=2010&combustivel=1
 *
 * Por que existe, se /api/placa já traz o valor FIPE: são fontes
 * diferentes. A Placa Fipe *adivinha* a versão a partir da placa e
 * devolve as candidatas com um percentual de similaridade. Versão
 * errada contamina o FIPE, que contamina o POR, que contamina a
 * negociação inteira. Aqui o negociador confirma na fonte.
 *
 * A ordem é MARCA → ANO → MODELO, e não a da FIPE (marca → modelo →
 * ano): escolhendo o modelo primeiro, a lista mistura o mesmo carro de
 * muitos anos. O endpoint `ConsultarModelosAtravesDoAno` da FIPE faz
 * exatamente esse caminho.
 *
 * O ano da FIPE carrega o combustível junto ("2010-1"). Como o
 * negociador escolhe só o ano, consulto os três combustíveis e junto as
 * listas, marcando cada modelo com o seu — assim a consulta de valor
 * depois sai com o parâmetro certo.
 */

const FIPE = "https://veiculos.fipe.org.br/api/veiculos";
const CARRO = 1;                       // codigoTipoVeiculo
const COMBUSTIVEIS = [1, 2, 3];        // gasolina, álcool, diesel
const ANON = process.env.SUPABASE_ANON_KEY || "";

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

// A tabela de referência muda uma vez por mês. Guardar por uma hora
// evita uma ida extra à FIPE em cada clique do negociador.
let refCache = { codigo: null, mes: null, em: 0 };

async function chamar(rota, corpo) {
  const r = await fetch(`${FIPE}/${rota}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Referer: "https://veiculos.fipe.org.br/",
      "User-Agent": "Mozilla/5.0 (compatible; VaaptyFicha/1.0)",
    },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  let dado = null;
  try { dado = texto ? JSON.parse(texto) : null; } catch (e) {}
  if (!r.ok) {
    const e = new Error("A FIPE não respondeu como esperado.");
    e.status = 502;
    throw e;
  }
  return dado;
}

async function referencia() {
  const agora = Date.now();
  if (refCache.codigo && agora - refCache.em < 3600000) return refCache;
  const tabelas = await chamar("ConsultarTabelaDeReferencia", {});
  if (!Array.isArray(tabelas) || !tabelas.length) {
    const e = new Error("A FIPE não devolveu a tabela de referência.");
    e.status = 502;
    throw e;
  }
  refCache = { codigo: tabelas[0].Codigo, mes: String(tabelas[0].Mes || "").trim(), em: agora };
  return refCache;
}

const inteiro = (v) => {
  const n = Number(String(v == null ? "" : v).replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

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
  // Não gasta cota da Placa Fipe, mas é rota interna: exige login como
  // o resto de api/. ANON só entra aqui para a checagem de configuração.
  if (!ANON) return res.status(500).json({ erro: "SUPABASE_ANON_KEY não configurada." });
  if (!tokenDe(req)) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  const acao = String(req.query.acao || "");

  try {
    const ref = await referencia();

    if (acao === "marcas") {
      const marcas = await chamar("ConsultarMarcas", {
        codigoTabelaReferencia: ref.codigo, codigoTipoVeiculo: CARRO,
      });
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");
      return res.status(200).json({
        mes: ref.mes,
        marcas: (marcas || []).map((m) => ({ codigo: m.Value, nome: m.Label })),
      });
    }

    if (acao === "modelos") {
      const marca = inteiro(req.query.marca);
      const ano = inteiro(req.query.ano);
      if (!marca || !ano) return res.status(400).json({ erro: "Informe marca e ano." });

      // Os três combustíveis, juntados. "nadaencontrado" é como a FIPE
      // diz que não há nada — não é erro.
      const vistos = {};
      const modelos = [];
      for (const comb of COMBUSTIVEIS) {
        let lista;
        try {
          lista = await chamar("ConsultarModelosAtravesDoAno", {
            codigoTabelaReferencia: ref.codigo, codigoTipoVeiculo: CARRO,
            codigoMarca: marca, ano: `${ano}-${comb}`,
            codigoTipoCombustivel: comb, anoModelo: ano,
          });
        } catch (e) { continue; }
        if (!Array.isArray(lista)) continue;
        lista.forEach((m) => {
          const chave = `${m.Value}-${comb}`;
          if (vistos[chave]) return;
          vistos[chave] = true;
          modelos.push({ codigo: m.Value, nome: m.Label, combustivel: comb });
        });
      }

      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");
      return res.status(200).json({ mes: ref.mes, modelos });
    }

    if (acao === "valor") {
      const marca = inteiro(req.query.marca);
      const modelo = inteiro(req.query.modelo);
      const ano = inteiro(req.query.ano);
      const comb = inteiro(req.query.combustivel) || 1;
      if (!marca || !modelo || !ano) return res.status(400).json({ erro: "Informe marca, modelo e ano." });

      const d = await chamar("ConsultarValorComTodosParametros", {
        codigoTabelaReferencia: ref.codigo, codigoTipoVeiculo: CARRO,
        codigoMarca: marca, codigoModelo: modelo,
        ano: `${ano}-${comb}`, anoModelo: ano, codigoTipoCombustivel: comb,
        tipoVeiculo: "carro", tipoConsulta: "tradicional",
      });

      if (!d || !d.Valor) return res.status(422).json({ erro: "A FIPE não tem valor para essa combinação." });

      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");
      return res.status(200).json({
        valor: valorNumerico(d.Valor),
        valor_texto: d.Valor,
        marca: d.Marca,
        modelo: d.Modelo,
        ano_modelo: d.AnoModelo,
        combustivel: d.Combustivel,
        codigo_fipe: d.CodigoFipe,
        mes_referencia: String(d.MesReferencia || "").trim(),
        // Código que a própria FIPE emite para a consulta. É a prova de
        // que o número veio da fonte, e não de estimativa.
        autenticacao: d.Autenticacao,
      });
    }

    return res.status(400).json({ erro: "Ação desconhecida. Use marcas, modelos ou valor." });
  } catch (e) {
    return res.status(e.status || 502).json({ erro: String(e.message) || "Falha ao consultar a FIPE." });
  }
};
