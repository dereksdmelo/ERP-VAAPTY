/* OS LEMBRETES DE PRAZO DE TRANSFERÊNCIA (0092, 28/10/2026). O Derek:
 * avisar o lojista "quando vencer os 3 meses e também quando estiver
 * faltando 2 meses, 1 mês, 2 semanas e 1 semana pra vencer o prazo",
 * pelo telefone do adm.
 *
 * Um por volta do cron, no máximo. Quem decide se é hora — interruptor
 * ligado, dia e horário, teto do dia, intervalo — e qual o carro e qual o
 * estágio é `lojista_aviso_proximo`, no banco: duas voltas que se cruzem
 * leem a mesma regra. Sem usuário e sem a chave de serviço: as funções
 * estreitas pedem o IA_SEGREDO, como as da Flávia (decisão 64).
 *
 * Grava mesmo quando falha: a trava é "cada estágio uma vez por carro", e
 * um número que não existe no WhatsApp não pode ser tentado a cada volta. */
const LOJ = require("../regras/lojista.js");

async function avisarPrazos(env) {
  const URL_BASE = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SEG = env.IA_SEGREDO;
  if (!URL_BASE || !ANON || !SEG || !env.PONTE || !env.PONTE_SEGREDO) return { pulado: "falta configuração" };
  const rpc = async (nome, corpo) => {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${nome}: ${t.slice(0, 200)}`);
    try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
  };
  const x = await rpc("lojista_aviso_proximo", { p_segredo: SEG });
  if (!x || !x.estoque_id) return { nada: true };
  const site = env.SITE_URL || "https://vaapty-erp.dereksdmelo.workers.dev";
  const texto = LOJ.textoLojista(x.tipo, x, site);
  let fone = String(x.telefone || "").replace(/\D/g, "");
  if (fone.length <= 11) fone = `55${fone}`;
  let id = null, erro = "";
  try {
    const r = await env.PONTE.fetch(`https://ponte/enviar?canal=${encodeURIComponent(x.canal)}`, {
      method: "POST", signal: AbortSignal.timeout(40000),
      headers: { "x-ponte-segredo": env.PONTE_SEGREDO, "Content-Type": "application/json" },
      body: JSON.stringify({ para: fone, conteudo: { type: "text", text: { body: texto }, digitando: Math.min(6000, 1500 + 20 * texto.length) } }),
    });
    const d = await r.json().catch(() => ({ ok: false, erro: `a ponte respondeu ${r.status}` }));
    if (d && d.ok) id = d.id || `loj-${x.estoque_id}-${x.tipo}`; else erro = (d && d.erro) || "a ponte não mandou";
  } catch (e) { erro = "a ponte não respondeu"; }
  await rpc("lojista_aviso_gravar", { p_segredo: SEG, p_estoque: x.estoque_id, p_tipo: x.tipo, p_estado: id ? "enviado" : "falhou",
    p_telefone: fone, p_texto: texto, p_erro: erro || null, p_wa_id: id });
  if (id) {
    try {
      await rpc("wa_receber", { p_canal: x.canal, p_telefone: fone, p_nome: "", p_wa_id: id, p_eco: true,
        p_tipo: "texto", p_texto: texto, p_anexo: null, p_quando: new Date().toISOString(), p_anuncio: null });
    } catch (e) {}
  }
  return { estoque: x.estoque_id, tipo: x.tipo, enviado: !!id, erro: erro || undefined };
}

module.exports = { avisarPrazos };
