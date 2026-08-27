/**
 * GET /api/desvalorizacao?chave=<token>
 *
 * O retorno da consulta de placa traz um campo `desvalorizometro`: um
 * base64 que decodifica para
 *
 *   ano#codigo_modelo#?#codigo_marca#?#nome da versão#assinatura
 *
 * Ou seja, é uma CHAVE, não o dado. Existe um segundo endpoint da
 * Placa Fipe que a consome — e a documentação não está aqui. Este
 * arquivo tenta as rotas prováveis, em ordem, e devolve o que cada uma
 * respondeu, para descobrirmos qual é a boa sem chutar no escuro.
 *
 * ROTAS é lista fechada de propósito: sem ela, este endpoint viraria um
 * relé aberto para qualquer caminho da Placa Fipe usando nosso token.
 *
 * Quando a rota certa for conhecida, este arquivo encolhe para uma
 * chamada só e o diagnóstico sai.
 */

const HOST = "https://api.placafipe.com.br";

const ROTAS = [
  "getdesvalorizometro",
  "getdesvalorizacao",
  "desvalorizometro",
  "getdepreciacao",
];

module.exports = async function handler(req, res) {
  const token = process.env.PLACAFIPE_TOKEN;
  if (!token) return res.status(500).json({ erro: "PLACAFIPE_TOKEN não configurado." });

  const chave = String(req.query.chave || "");
  if (!chave || chave.length > 400 || !/^[A-Za-z0-9+/=]+$/.test(chave)) {
    return res.status(400).json({ erro: "Passe a chave `desvalorizometro` que veio na consulta de placa." });
  }

  // Uma rota específica, se pedida; senão tenta todas.
  const pedida = String(req.query.rota || "");
  const tentar = pedida ? ROTAS.filter((r) => r === pedida) : ROTAS;
  if (!tentar.length) return res.status(400).json({ erro: "Rota fora da lista." });

  const diagnostico = [];
  for (const rota of tentar) {
    let r, corpo;
    try {
      r = await fetch(`${HOST}/${rota}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, desvalorizometro: chave }),
      });
      corpo = await r.text();
    } catch (e) {
      diagnostico.push({ rota, erro: "falha de rede" });
      continue;
    }

    let dado = null;
    try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}

    if (r.ok && dado && dado.codigo === 1) {
      res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400");
      return res.status(200).json({ rota, dados: dado });
    }

    diagnostico.push({
      rota,
      http: r.status,
      // Só o começo: se a resposta for uma página de erro, não interessa inteira.
      resposta: dado || String(corpo || "").slice(0, 200),
    });
  }

  return res.status(404).json({
    erro: "Nenhuma das rotas conhecidas respondeu com dados.",
    diagnostico,
  });
};
