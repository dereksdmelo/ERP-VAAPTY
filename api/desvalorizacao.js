/**
 * GET /api/desvalorizacao?chave=<desvalorizometro>
 *
 * O histórico FIPE do carro, mês a mês, desde o lançamento.
 *
 * A chave vem em cada versão devolvida por /api/placa. Ela é um base64
 * que decodifica para ano#codigo_modelo#tipo#codigo_marca#combustivel#
 * versão#assinatura — parâmetros já assinados pela Placa Fipe, que a
 * gente repassa sem interpretar.
 *
 * Para que serve na mesa: o cliente ancora no que pagou. Ver a curva
 * real — e quanto o carro perde por mês parado — muda a conversa de
 * "quanto eu quero" para "quanto custa esperar".
 *
 * A série é longa (mais de 200 meses num carro de 2010). Devolvo os
 * últimos 60 para o gráfico e as contas prontas para a tela.
 */

const HOST = "https://api.placafipe.com.br";
const MESES_GRAFICO = 60;

const num = (v) => {
  const n = Number(String(v == null ? "" : v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

module.exports = async function handler(req, res) {
  const token = process.env.PLACAFIPE_TOKEN;
  if (!token) return res.status(500).json({ erro: "PLACAFIPE_TOKEN não configurado." });

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

  // Da mais antiga para a mais recente, como a Placa Fipe já manda.
  const serie = d.desvalorizometro.tabelas
    .map((t) => ({ valor: num(t.valor), mes: t.mes_ano_extenso }))
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
    // Do topo até hoje: é a perda que o dono ainda não enxergou.
    desde_o_pico: {
      reais: ultimo.valor - pico.valor,
      pct: Math.round(((ultimo.valor - pico.valor) / pico.valor) * 1000) / 10,
    },
    doze_meses: conta(12),
    vinte_quatro_meses: conta(24),
    serie: serie.slice(-MESES_GRAFICO),
    meses_disponiveis: serie.length,
  });
};
