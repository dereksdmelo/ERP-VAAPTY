/* A FLÁVIA ATENDENDO DE VERDADE (22/10/2026, decisão 64).
 *
 * O cron do Worker do ERP chama `atenderFila(env)` a cada minuto. Para
 * cada conversa que espera resposta num número com a Flávia ligada:
 *
 *   1. reserva a mensagem do cliente (duas voltas não respondem a mesma);
 *   2. redige com a MESMA instrução do treino (ia/flavia.js) — o que o
 *      gerente corrigiu lá vale aqui no rascunho seguinte;
 *   3. manda pela ponte, uma mensagem de cada vez, com "digitando…" antes,
 *      no ritmo de uma pessoa (decisão 52: número que dispara em rajada
 *      é número que o WhatsApp bane);
 *   4. grava o que mandou: primeiro os ids na `ia_resposta`, DEPOIS a
 *      mensagem na conversa — na ordem inversa, a volta seguinte veria
 *      uma mensagem da loja que não está entre as da Flávia, acharia que
 *      uma pessoa assumiu e calaria a conversa por 12 horas;
 *   5. se ela confirmou um horário, o lead vai para AGENDADO pela mesma
 *      função que a conversa já usa (`wa_lead_avanca`, 0059).
 *
 * Sem usuário e sem a chave de serviço: tudo passa pelas funções
 * estreitas da 0075, com o `IA_SEGREDO`.
 *
 * O que ela NÃO faz ainda: ler mídia que chega no número ao vivo. A
 * leitura de foto, documento e áudio (0073) roda com o token de quem
 * abre o treino; aqui a mídia aparece como "ainda não lida", e a
 * instrução já manda perguntar o carro nesse caso. */
const FLAVIA = require("./flavia.js");

const ESPERA_ENTRE = (txt) => Math.min(6000, 1500 + 35 * String(txt || "").length);
const DO_CANAL = { "prospeccao-ativa": "prospeccao", tv: "tv", loja: "fluxo_loja" };

async function atenderFila(env) {
  const URL_BASE = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SEG = env.IA_SEGREDO;
  const CHAVE = env.ANTHROPIC_API_KEY;
  if (!URL_BASE || !ANON || !SEG || !CHAVE || !env.PONTE || !env.PONTE_SEGREDO) return { pulado: "falta configuração" };
  const MODELO = env.IA_MODELO_FLAVIA || env.IA_MODELO || "claude-haiku-4-5-20251001";

  const rpc = async (nome, corpo) => {
    const r = await fetch(`${URL_BASE}/rest/v1/rpc/${nome}`, {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${nome}: ${t.slice(0, 200)}`);
    try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
  };
  const ponte = async (caminho, canal, corpo) => {
    const r = await env.PONTE.fetch(`https://ponte${caminho}?canal=${encodeURIComponent(canal)}`, {
      method: "POST", headers: { "x-ponte-segredo": env.PONTE_SEGREDO, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    return r.json().catch(() => ({ ok: false, erro: `a ponte respondeu ${r.status}` }));
  };

  const fila = (await rpc("ia_fila", { p_segredo: SEG })) || [];
  const feitos = [];
  for (const item of fila) {
    const id = await rpc("ia_reservar", { p_segredo: SEG, p_conversa: item.conversa_id, p_mensagem: item.mensagem_id });
    if (!id) continue;
    const fim = (estado, extra) => rpc("ia_concluir", {
      p_segredo: SEG, p_id: id, p_estado: estado, p_mensagens: extra.mensagens || null, p_agendar: extra.agendar || "",
      p_encerrar: !!extra.encerrar, p_wa_ids: extra.wa_ids || [], p_erro: extra.erro || null,
      p_modelo: MODELO, p_uso: extra.uso || null,
    });
    try {
      const ctx = await rpc("ia_contexto", { p_segredo: SEG, p_conversa: item.conversa_id });
      const msgs = (ctx && ctx.msgs) || [];
      // A conversa é relida aqui, não a da fila: mensagem que o cliente
      // mandou nesse meio-tempo entra na resposta.
      const agora = FLAVIA.paredeDe(new Date().toISOString());
      const linha = (ctx && ctx.config) || {};
      const cfg = { ...FLAVIA.CONFIG_PADRAO };
      Object.keys(cfg).forEach((k) => { if (linha[k] !== undefined && linha[k] !== null) cfg[k] = typeof linha[k] === "string" ? linha[k].slice(0, 5) : linha[k]; });
      if (linha.ia_nome) cfg.ia_nome = linha.ia_nome;
      const livres = FLAVIA.horariosLivres(cfg, agora, (ctx && ctx.ocupados) || []);
      const sistema = FLAVIA.instrucao(cfg, agora, livres, (ctx && ctx.exemplos) || []);

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": CHAVE, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODELO, max_tokens: 700, system: sistema,
          messages: [{ role: "user", content: FLAVIA.conversaEmTexto(msgs) }] }),
      });
      const corpo = await r.text();
      if (!r.ok) { await fim("falhou", { erro: `IA ${r.status}: ${corpo.slice(0, 200)}` }); continue; }
      let saida = "", uso = null;
      try { const d = JSON.parse(corpo); saida = ((d.content || []).find((x) => x.type === "text") || {}).text || ""; uso = d.usage || null; } catch (e) {}
      const p = FLAVIA.lerSaida(saida, livres);
      // Texto fora do formato não sai para o cliente: no treino ele é
      // mostrado marcado, aqui não há ninguém para julgar antes.
      if (!p || p.formato_livre) { await fim("falhou", { erro: "resposta fora do formato", uso }); continue; }

      const canal = item.canal, para = item.telefone;
      const enviados = [], wa_ids = [];
      let erro = "";
      for (const texto of p.mensagens) {
        const e = await ponte("/enviar", canal, { para, conteudo: { type: "text", text: { body: texto }, digitando: ESPERA_ENTRE(texto) } });
        if (!e || !e.ok) { erro = (e && e.erro) || "a ponte não mandou"; break; }
        enviados.push(texto); if (e.id) wa_ids.push(e.id);
      }
      await fim(enviados.length ? "enviada" : "falhou", { mensagens: enviados, agendar: p.agendar, encerrar: p.encerrar, wa_ids, erro, uso });

      // Na conversa, como mensagem da loja. A ponte não devolve o eco do
      // que ela mesma mandou, então é aqui que a mensagem entra.
      let ultimaGravada = null;
      for (let i = 0; i < enviados.length; i++) {
        try {
          ultimaGravada = await rpc("wa_receber", {
            p_canal: canal, p_telefone: para, p_nome: "", p_wa_id: wa_ids[i] || `ia-${id}-${i}`, p_eco: true,
            p_tipo: "texto", p_texto: enviados[i], p_anexo: null, p_quando: new Date(Date.now() + i).toISOString(), p_anuncio: null,
          }) || ultimaGravada;
        } catch (e) {}
      }
      if (ultimaGravada && p.agendar) {
        try {
          await rpc("wa_lead_avanca", { p_mensagem: ultimaGravada, p_evento: "agendou", p_quando: `${p.agendar}:00`,
            p_origem: ctx && ctx.conversa && ctx.conversa.anuncio ? "facebook" : (DO_CANAL[canal] || "outro") });
        } catch (e) {}
      }
      feitos.push({ conversa: item.conversa_id, enviadas: enviados.length, erro: erro || undefined });
    } catch (e) {
      try { await fim("falhou", { erro: String((e && e.message) || e) }); } catch (x) {}
    }
  }
  return { fila: fila.length, feitos };
}

module.exports = { atenderFila };
