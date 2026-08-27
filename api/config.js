/**
 * GET /api/config
 *
 * O index.html não passa por build: não tem como receber variável de
 * ambiente embutida. Este endpoint entrega o que o navegador precisa
 * para falar com o Supabase Auth.
 *
 * Só sai daqui o que é público por natureza:
 *
 *   SUPABASE_URL       endereço do projeto
 *   SUPABASE_ANON_KEY  chave anônima — feita para viver no navegador.
 *                      Sozinha ela não abre nada: quem decide o que
 *                      cada um enxerga é a RLS, a partir do login.
 *
 * A SUPABASE_SERVICE_KEY NUNCA entra aqui. Ela passa por cima da RLS;
 * no navegador, seria a carteira de clientes inteira aberta.
 */

module.exports = async function handler(req, res) {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const anon = process.env.SUPABASE_ANON_KEY || "";

  if (!url || !anon) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
  return res.status(200).json({ url, anon });
};
