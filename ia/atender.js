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
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${nome}: ${t.slice(0, 200)}`);
    try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
  };
  const ponte = async (caminho, canal, corpo) => {
    const r = await env.PONTE.fetch(`https://ponte${caminho}?canal=${encodeURIComponent(canal)}`, {
      method: "POST", signal: AbortSignal.timeout(40000), headers: { "x-ponte-segredo": env.PONTE_SEGREDO, "Content-Type": "application/json" },
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
        method: "POST", signal: AbortSignal.timeout(45000),
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

/* TODA CHAMADA DE FORA TEM PRAZO (23/10/2026). Uma pergunta pendurada —
 * um container da ponte que não responde — segurava a execução do cron
 * e o Cloudflare não começava a seguinte: das 11h19 em diante não rodou
 * mais nada, nem a Flávia. Banco 20 s, IA 45 s, ponte 40 s. */

/* A LEITURA DO AGENDADO (23/10/2026, decisão 65): qual é o carro, e se
 * o cliente confirmou que vem.
 *
 * O Derek viu a agenda com "sem carro" em quase todo cartão, e nenhum
 * ✓ de confirmado, com as duas coisas escritas na conversa. Quem
 * pergunta o carro é a Ana, a Camila ou a Flávia; quem confirma é o
 * cliente respondendo o lembrete. O leitor por expressão da 0059 só
 * procura data e hora — e modelo de carro em texto livre, ou um "pode
 * deixar, tô indo", não se pega por expressão sem errar para os dois
 * lados.
 *
 * **Confirmar não é agendar.** O cliente escolhendo o horário é o que
 * MARCA; confirmar é ele dizer, depois de marcado, que vem — quase
 * sempre respondendo o lembrete. Contar o primeiro como o segundo
 * poria ✓ em todo agendamento, e o ✓ deixaria de dizer alguma coisa.
 * Na dúvida, não confirma: a pré-venda liga, que é o que ela faz com
 * quem não tem ✓ (decisão 27). */
const INSTRUCAO_LEITURA = [
  "Você lê a conversa de WhatsApp entre a loja (LOJA) e um cliente (CLIENTE) que quer vender o carro.",
  "Responda SÓ um objeto JSON, sem cercas de código: {\"carro\": \"\", \"confirmou\": false}",
  "",
  "\"carro\": o carro que o cliente quer vender, como uma pessoa escreveria na agenda: marca ou modelo e o ano, se aparecer",
  "(ex.: \"Onix LT 2019\", \"Gol G5 2010\", \"Hilux 2015 diesel\"). Vale o que o cliente disse e o que aparece na leitura",
  "de foto ou documento. Se forem dois carros, os dois separados por \" e \". Se o carro não aparecer, \"\". Nunca invente.",
  "Nunca ponha placa, nome do dono ou número de documento.",
  "",
  "\"confirmou\": true só se o horário JÁ ESTAVA COMBINADO e, numa troca de mensagens POSTERIOR, o cliente disse com",
  "clareza que vem — quase sempre respondendo a um LEMBRETE ou a um pedido de confirmação da loja que veio depois",
  "(\"confirmado\", \"pode deixar, tô indo\", \"estarei aí\", \"sim, vou\", \"amanhã eu vou\").",
  "O \"ok\", \"pode ser\", \"combinado\" ou \"pode confirmar\" dito NA MESMA conversa em que o horário está sendo escolhido",
  "é o AGENDAMENTO, não a confirmação: false. Se depois ele disse que não pode, que vai remarcar, ou ficou em dúvida: false.",
  "Na dúvida, false.",
].join("\n");

async function lerLeads(env) {
  const URL_BASE = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SEG = env.IA_SEGREDO, CHAVE = env.ANTHROPIC_API_KEY;
  if (!URL_BASE || !ANON || !SEG || !CHAVE) return { pulado: "falta configuração" };
  const MODELO = env.IA_MODELO || "claude-haiku-4-5-20251001";
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
  const leads = (await rpc("ia_leads_para_ler", { p_segredo: SEG })) || [];
  const feitos = [];
  for (const l of leads) {
    let carro = "", confirmou = false;
    try {
      const marcado = String(l.agendado_para || "").slice(0, 16).replace("T", " às ");
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: AbortSignal.timeout(45000),
        headers: { "x-api-key": CHAVE, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: MODELO, max_tokens: 120, system: INSTRUCAO_LEITURA,
          messages: [{ role: "user", content: `Horário marcado na agenda: ${marcado}.\n\n${FLAVIA.conversaEmTexto(l.msgs || [], 6000)}` }] }),
      });
      if (!r.ok) {   // não marca como lido: tenta na próxima
        const corpo = await r.text().catch(() => "");
        console.error("leitura: IA", r.status, corpo.slice(0, 300));
        feitos.push({ lead: l.lead_id, erro: `IA ${r.status}` });
        if (r.status === 401 || r.status === 400 || r.status === 404) break;   // erro de chave ou de modelo não melhora no lead seguinte
        continue;
      }
      const d = await r.json();
      const txt = ((d.content || []).find((x) => x.type === "text") || {}).text || "";
      const i = txt.indexOf("{"), j = txt.lastIndexOf("}");
      const o = i >= 0 && j > i ? JSON.parse(txt.slice(i, j + 1)) : {};
      carro = String(o.carro || "").replace(/\b[A-Z]{3}-?\d[A-Z0-9]\d{2}\b/gi, "").replace(/\s+/g, " ").trim().slice(0, 60);
      confirmou = o.confirmou === true;
    } catch (e) { console.error("leitura: resposta ilegível", String((e && e.message) || e).slice(0, 200)); }
    try {
      await rpc("ia_lead_gravar", { p_segredo: SEG, p_lead: l.lead_id, p_carro: carro, p_confirmou: confirmou });
      feitos.push({ lead: l.lead_id, carro: carro || undefined, confirmou });
    } catch (e) { feitos.push({ lead: l.lead_id, erro: String(e.message || e).slice(0, 120) }); }
  }
  if (leads.length) console.log("leitura:", leads.length, "leads,", feitos.filter((f) => !f.erro).length, "gravados", JSON.stringify(feitos.filter((f) => f.erro)).slice(0, 300));
  return { lidos: feitos };
}

module.exports = { atenderFila, lerLeads };
