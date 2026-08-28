/**
 * /api/placa — tudo que vem da Placa Fipe.
 *
 *   GET ?placa=ABC1D23                consulta o veículo pela placa
 *   GET ?acao=cota                    consumo do dia (não gasta consulta)
 *   GET ?acao=desvalorizacao&chave=   histórico FIPE mês a mês
 *
 * Eram três arquivos. Viraram um porque o plano Hobby da Vercel aceita
 * no máximo 12 funções por deploy, e o décimo terceiro derrubou o
 * build. Juntar por fonte — uma função por serviço externo — foi o
 * corte que não mistura assuntos: tudo aqui fala com a Placa Fipe e usa
 * o mesmo PLACAFIPE_TOKEN, que nunca chega ao navegador.
 */

const HOST = "https://api.placafipe.com.br";

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const MESES_GRAFICO = 60;

const numDesval = (v) => {
  const n = Number(String(v == null ? "" : v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

/* ------------------ consumo do dia ------------------ */
/* O getquotas da Placa Fipe não desconta consulta. */
async function cota(res, token) {
  try {
    const r = await fetch(`${HOST}/getquotas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const d = await r.json();
    const usadas = Number(d.uso_diario || 0);
    const limiteDiario = Number(d.limite_diario || 0);
    return res.status(200).json({
      usadas,
      limiteDiario,
      restantes: Math.max(0, limiteDiario - usadas),
      renovaEm: d.renovar_em || null,
      ok: d.codigo === 1,
      mensagem: d.msg || "",
    });
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui consultar a cota." });
  }
}

/* ------------------ histórico FIPE ------------------ */
/**
 * A chave vem em cada versão devolvida pela consulta de placa. É um
 * base64 com ano, código do modelo, código da marca, versão e uma
 * assinatura — parâmetros já assinados, que a gente repassa sem
 * interpretar.
 *
 * Na mesa vale porque o cliente ancora no que pagou: ver a curva real,
 * e quanto o carro muda por mês, troca "quanto eu quero" por "quanto
 * custa esperar".
 */
async function desvalorizacao(req, res, token) {
  const chave = String(req.query.chave || "");
  if (!chave || chave.length > 400 || !/^[A-Za-z0-9+/=]+$/.test(chave)) {
    return res.status(400).json({ erro: "Falta a chave do desvalorizômetro." });
  }

  let d;
  try {
    const r = await fetch(`${HOST}/getdesvalorizometro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, desvalorizometro: chave }),
    });
    d = await r.json();
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com a Placa Fipe." });
  }

  if (d.codigo !== 1 || !d.desvalorizometro || !Array.isArray(d.desvalorizometro.tabelas)) {
    return res.status(422).json({ erro: d.msg || "Histórico indisponível para este veículo." });
  }

  const serie = d.desvalorizometro.tabelas
    .map((t) => ({ valor: numDesval(t.valor), mes: t.mes_ano_extenso }))
    .filter((x) => x.valor != null);
  if (!serie.length) return res.status(422).json({ erro: "Histórico vazio." });

  const ultimo = serie[serie.length - 1];
  const atras = (n) => (serie.length > n ? serie[serie.length - 1 - n] : null);
  const conta = (n) => {
    const antes = atras(n);
    if (!antes || !antes.valor) return null;
    const reais = ultimo.valor - antes.valor;
    return {
      de: antes.mes,
      valor_antes: antes.valor,
      reais,
      pct: Math.round((reais / antes.valor) * 1000) / 10,
      por_mes: Math.round(reais / n),
    };
  };
  const pico = serie.reduce((a, b) => (b.valor > a.valor ? b : a), serie[0]);

  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=604800");
  return res.status(200).json({
    marca: d.marca,
    modelo: d.modelo,
    ano_modelo: d.ano_modelo,
    atual: { valor: ultimo.valor, mes: ultimo.mes },
    pico: { valor: pico.valor, mes: pico.mes },
    desde_o_pico: {
      reais: ultimo.valor - pico.valor,
      pct: Math.round(((ultimo.valor - pico.valor) / pico.valor) * 1000) / 10,
    },
    doze_meses: conta(12),
    vinte_quatro_meses: conta(24),
    serie: serie.slice(-MESES_GRAFICO),
    meses_disponiveis: serie.length,
  });
}

module.exports = async function handler(req, res) {
  const token = process.env.PLACAFIPE_TOKEN;
  if (!token) {
    return res.status(500).json({ erro: "PLACAFIPE_TOKEN não configurado na Vercel." });
  }

  const acao = String(req.query.acao || "");
  if (acao === "cota") return cota(res, token);
  if (acao === "desvalorizacao") return desvalorizacao(req, res, token);

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
      // Chave do histórico FIPE desta versão, para /api/desvalorizacao.
      desvalorizometro: f.desvalorizometro || null,
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
