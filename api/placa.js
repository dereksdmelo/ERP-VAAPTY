/**
 * GET /api/placa?placa=ABC1D23
 *
 * Consulta a Placa Fipe do lado do servidor. O token vive na variável
 * de ambiente PLACAFIPE_TOKEN e nunca chega ao navegador.
 */

const HOST = "https://api.placafipe.com.br";

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

module.exports = async function handler(req, res) {
  const token = process.env.PLACAFIPE_TOKEN;
  if (!token) {
    return res.status(500).json({ erro: "PLACAFIPE_TOKEN não configurado na Vercel." });
  }

  const placa = String(req.query.placa || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) {
    return res.status(400).json({ erro: "Placa fora do formato ABC1234 ou ABC1D23." });
  }

  let d;
  try {
    const r = await fetch(`${HOST}/getplacafipe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placa, token }),
    });
    d = await r.json();
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com a Placa Fipe." });
  }

  if (d.codigo !== 1 || !d.informacoes_veiculo) {
    // 4862 = token vencido, 7771 = sem assinatura
    return res.status(422).json({ erro: d.msg || "Veículo não encontrado.", codigo: d.codigo });
  }

  const iv = d.informacoes_veiculo;
  const chassi = iv.chassi || "";

  /**
   * Tudo que a Placa Fipe manda e este arquivo não mapeia. Existe para
   * responder uma pergunta concreta: o desvalorizômetro vem no retorno?
   * Sem isto a resposta era descartada antes de alguém poder olhar.
   *
   * Só chaves desconhecidas, e nada de token: o que a gente envia não
   * volta no corpo.
   */
  const CONHECIDAS = ["codigo", "msg", "informacoes_veiculo", "fipe"];
  const extras = {};
  Object.keys(d).forEach((k) => { if (CONHECIDAS.indexOf(k) < 0) extras[k] = d[k]; });

  const ivExtras = {};
  const IV_CONHECIDAS = ["marca", "modelo", "ano", "ano_modelo", "cor", "combustivel",
                         "cilindradas", "municipio", "uf", "chassi"];
  Object.keys(iv).forEach((k) => { if (IV_CONHECIDAS.indexOf(k) < 0) ivExtras[k] = iv[k]; });
  if (Object.keys(ivExtras).length) extras.informacoes_veiculo = ivExtras;

  const fipeExtras = {};
  const F_CONHECIDAS = ["codigo_fipe", "modelo", "ano_modelo", "combustivel", "valor",
                        "mes_referencia", "similaridade"];
  const primeira = (d.fipe || [])[0] || {};
  Object.keys(primeira).forEach((k) => { if (F_CONHECIDAS.indexOf(k) < 0) fipeExtras[k] = primeira[k]; });
  if (Object.keys(fipeExtras).length) extras.fipe_primeira_versao = fipeExtras;

  const versoes = (d.fipe || [])
    .map((f) => ({
      codigoFipe: f.codigo_fipe,
      nome: f.modelo,
      anoModelo: f.ano_modelo,
      combustivel: f.combustivel,
      valor: num(f.valor) || 0,
      mesReferencia: f.mes_referencia,
      confianca: num(f.similaridade) || 0,
    }))
    .sort((a, b) => b.confianca - a.confianca);

  // Consulta boa por 30 dias no navegador; o valor FIPE só muda uma vez por mês.
  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");

  return res.status(200).json({
    placa,
    marca: iv.marca,
    modeloAbreviado: iv.modelo,
    anoFabricacao: num(iv.ano),
    anoModelo: num(iv.ano_modelo),
    cor: iv.cor || "",
    combustivel: iv.combustivel || "",
    cilindradas: num(iv.cilindradas),
    municipio: iv.municipio || "",
    uf: iv.uf || "",
    chassi,
    chassiCompleto: /^[A-HJ-NPR-Z0-9]{17}$/.test(chassi),
    versoes,
    ambiguo: versoes.length !== 1,
    extras,
  });
};
