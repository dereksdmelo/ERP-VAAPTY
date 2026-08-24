/**
 * GET /api/cota
 * Mostra o consumo do dia. Este endpoint da Placa Fipe não gasta consulta.
 */

module.exports = async function handler(req, res) {
  const token = process.env.PLACAFIPE_TOKEN;
  if (!token) return res.status(500).json({ erro: "PLACAFIPE_TOKEN não configurado." });

  try {
    const r = await fetch("https://api.placafipe.com.br/getquotas", {
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
};
