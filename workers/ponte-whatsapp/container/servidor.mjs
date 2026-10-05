/* A PONTE DO WHATSAPP POR QR CODE (24/09/2026).
 *
 * O Derek: "o sendboss conecta via QR code, tipo whatsapp web... e é com botões... e não tem janela
 * de 24h". Este programa faz o que o SendBoss faz: segura a sessão de um número como se fosse um
 * WhatsApp Web (biblioteca Baileys) e conversa com o sistema por HTTP.
 *
 *   o que CHEGA no número   → POST {ERP}/ponte/entrada   (o Worker trata igual a uma mensagem da Meta)
 *   o que o SISTEMA manda   ← POST /enviar                (no mesmo formato que a Meta recebe)
 *   o estado (QR, conectado) ← GET /estado
 *
 * A SESSAO NAO MORA AQUI. O container e descartavel (a Cloudflare reinicia quando quer); as chaves
 * da sessao ficam no Durable Object da ponte (`/_auth`), senao cada reinicio pediria o QR de novo.
 *
 * Uma instancia deste programa = um numero (`canal`). */
import http from "node:http";
import makeWASocket, { DisconnectReason, BufferJSON, initAuthCreds, proto, fetchLatestBaileysVersion,
  downloadMediaMessage, generateWAMessageFromContent } from "baileys";
import pino from "pino";

const SEGREDO = process.env.PONTE_SEGREDO || "";
const PONTE_URL = process.env.PONTE_URL || "";     // o Worker da ponte (guarda a sessao)
const ERP_URL = process.env.ERP_URL || "";
const GUARDA_MIDIA = process.env.GUARDA_MIDIA === "1";         // o Worker do ERP (recebe as mensagens)
const log = pino({ level: process.env.LOG || "warn" });
const BOTOES_COMO = process.env.BOTOES || "texto";   // "nativo" = botoes pra todo mundo
// numeros que ja recebem os botoes nativos (teste antes de ligar pra todos)
const NATIVO_PARA = String(process.env.BOTOES_NATIVO_PARA || "").split(",").map((x) => x.replace(/\D/g, "")).filter(Boolean);
let CANAL = process.env.CANAL || "";

const st = { estado: "iniciando", qr: "", numero: "", nome: "", desde: Date.now(), erro: "" };
let sock = null, ligando = false, tentativas = 0;
const enviadosPorMim = new Set();                  // ids que ESTE programa mandou: o eco deles nao volta como "mandado pelo celular"
const botoesPorConversa = new Map();               // jid -> [{id,title}] — pra entender "1", "2" ou o texto do botao

/* ---------- a sessao, guardada fora ---------- */
const H = () => ({ "x-ponte-segredo": SEGREDO, "content-type": "application/json" });
async function authCarregar() {
  const r = await fetch(PONTE_URL + "/_auth?canal=" + encodeURIComponent(CANAL), { headers: H() });
  if (!r.ok) throw new Error("não consegui ler a sessão guardada (" + r.status + ")");
  const d = await r.json();
  const mapa = new Map();
  for (const [k, v] of Object.entries(d.chaves || {})) mapa.set(k, JSON.parse(v, BufferJSON.reviver));
  return mapa;
}
let pendentes = {}, timerFlush = null;
function authGravar(k, v) {
  pendentes[k] = v == null ? null : JSON.stringify(v, BufferJSON.replacer);
  clearTimeout(timerFlush); timerFlush = setTimeout(authFlush, 400);
}
async function authFlush() {
  const lote = pendentes; pendentes = {};
  if (!Object.keys(lote).length) return;
  try {
    const r = await fetch(PONTE_URL + "/_auth?canal=" + encodeURIComponent(CANAL), { method: "PUT", headers: H(), body: JSON.stringify({ set: lote }) });
    if (!r.ok) throw new Error("status " + r.status);
  } catch (e) { log.error({ e: String(e) }, "falhou gravar sessão; tento de novo"); Object.assign(pendentes, lote, pendentes); timerFlush = setTimeout(authFlush, 3000); }
}
async function authZerar() {
  pendentes = {};
  await fetch(PONTE_URL + "/_auth?canal=" + encodeURIComponent(CANAL), { method: "DELETE", headers: H() }).catch(() => {});
}
async function estadoDeAuth() {
  const mapa = await authCarregar();
  const creds = mapa.get("creds") || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (tipo, ids) => {
          const out = {};
          for (const id of ids) {
            let v = mapa.get(tipo + "-" + id);
            if (v && tipo === "app-state-sync-key") v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }
          return out;
        },
        set: async (dados) => {
          for (const cat of Object.keys(dados)) for (const id of Object.keys(dados[cat])) {
            const v = dados[cat][id], k = cat + "-" + id;
            if (v) mapa.set(k, v); else mapa.delete(k);
            authGravar(k, v || null);
          }
        },
      },
    },
    salvarCreds: () => authGravar("creds", creds),
  };
}

/* ---------- o que chega vai pro ERP ----------
 *
 * NO ERP DA VAAPTY NÃO EXISTE /ponte/*, e não vai existir: o teto de 12
 * funções da Vercel está cheio (um 13º arquivo em api/ derruba o build
 * inteiro). O receptor mora em api/atendimento.js sob
 * `?recurso=ponte&acao=`, e `rota()` é a tradução -- um lugar só, para
 * que o resto deste arquivo continue falando em /ponte/entrada como no
 * ERP da Camisetas Já.
 */
const rota = (caminho) =>
  "/api/atendimento?recurso=ponte&acao=" + String(caminho).replace("/ponte/", "");

async function proErp(caminho, corpo) {
  try {
    const r = await fetch(ERP_URL + rota(caminho), { method: "POST", headers: H(), body: JSON.stringify(Object.assign({ canal: CANAL }, corpo)) });
    return await r.json().catch(() => ({}));
  } catch (e) { log.error({ e: String(e), caminho }, "ERP não respondeu"); return {}; }
}
async function subirMidia(buf, mime, nome) {
  try {
    const r = await fetch(ERP_URL + rota("/ponte/midia") + "&canal=" + encodeURIComponent(CANAL) + "&nome=" + encodeURIComponent(nome || "arquivo"),
      { method: "POST", headers: { "x-ponte-segredo": SEGREDO, "content-type": mime || "application/octet-stream" }, body: buf });
    const d = await r.json(); return d && d.ok ? d.chave : "";
  } catch (e) { return ""; }
}
/* O TELEFONE POR TRAS DO "LID" (24/09/2026, o Derek: "preciso que apareca as mensagens enviadas
 * por outros lugares tambem"). O WhatsApp esta trocando o numero do contato por um id interno
 * (`...@lid`) em parte das conversas. Na mensagem que CHEGA o telefone costuma vir ao lado; na que a
 * LOJA manda pelo celular, muitas vezes nao — e a ponte descartava, sem saber de quem era. Tres
 * fontes, nessa ordem: o que veio junto, o mapa que a ponte vai aprendendo (toda mensagem que traz
 * os dois ensina), e o mapa do proprio WhatsApp (`lidMapping`, que fica guardado com a sessao). */
const lidPn = new Map();
function aprenderLid(lid, pn) { if (lid && pn && /@lid$/.test(lid) && /@s\.whatsapp\.net$/.test(pn)) lidPn.set(lid.split(":")[0].replace(/@lid$/, "") , pn.split("@")[0].split(":")[0]); }
async function foneDoJid(key) {
  const cand = [key.remoteJid, key.remoteJidAlt, key.senderPn, key.participantPn, key.participantAlt];
  let pn = "";
  for (const j of cand) if (j && /@s\.whatsapp\.net$/.test(j)) { pn = j.split("@")[0].split(":")[0]; break; }
  const lid = [key.remoteJid, key.remoteJidAlt, key.participant].find((j) => j && /@lid$/.test(j)) || "";
  if (pn && lid) aprenderLid(lid, pn + "@s.whatsapp.net");
  if (pn) return pn;
  if (!lid) return "";
  const k = lid.split(":")[0].replace(/@lid$/, "");
  if (lidPn.has(k)) return lidPn.get(k);
  try {
    const r = sock && sock.signalRepository && sock.signalRepository.lidMapping && await sock.signalRepository.lidMapping.getPNForLID(lid);
    if (r) { const f = String(r).split("@")[0].split(":")[0]; lidPn.set(k, f); return f; }
  } catch (e) {}
  return "";
}
// o que a ponte deixou de passar, e por que — aparece no /estado (pra nao virar "sumiu")
const pulados = [];
const testeLog = [];   // o que foi mandado no teste de formatos de botao
function pular(motivo, msg) { pulados.unshift({ quando: Date.now(), motivo, jid: (msg && msg.key && msg.key.remoteJid) || "", deMim: !!(msg && msg.key && msg.key.fromMe) }); if (pulados.length > 30) pulados.pop(); }
function conteudoDe(m) {
  if (!m) return null;
  if (m.ephemeralMessage) return conteudoDe(m.ephemeralMessage.message);
  if (m.viewOnceMessage) return conteudoDe(m.viewOnceMessage.message);
  if (m.viewOnceMessageV2) return conteudoDe(m.viewOnceMessageV2.message);
  if (m.documentWithCaptionMessage) return conteudoDe(m.documentWithCaptionMessage.message);
  // o que a loja mandou por OUTRO aparelho (o celular) chega embrulhado pra sincronizar
  if (m.deviceSentMessage) return conteudoDe(m.deviceSentMessage.message);
  if (m.editedMessage) return null;
  return m;
}
async function traduzir(msg) {
  const m = conteudoDe(msg.message); if (!m) return null;
  const jid = msg.key.remoteJid;
  const base = { id: msg.key.id, quando: Number(msg.messageTimestamp || 0) * 1000 || Date.now(),
    nome: msg.key.fromMe ? "" : (msg.pushName || "") };
  /* DE QUAL ANUNCIO VEIO (26/09/2026). Anuncio de "clique pro WhatsApp" traz na primeira mensagem o `externalAdReply`
     (titulo, id e link do anuncio, ctwa). Vai pro ERP no formato `referral` da Meta — o relatorio de marketing casa
     com o funil e com as vendas. */
  try {
    const ci = Object.values(m).map((x) => x && typeof x === "object" ? x.contextInfo : null).find(Boolean);
    const ea = ci && ci.externalAdReply;
    if (ea && !msg.key.fromMe) base.referral = { source_type: String(ea.sourceType || "ad"), source_id: String(ea.sourceId || ""),
      headline: String(ea.title || ""), body: String(ea.body || ""), source_url: String(ea.sourceUrl || ""), ctwa_clid: String(ea.ctwaClid || "") };
    else if (ci && /ad/i.test(String(ci.entryPointConversionSource || ci.conversionSource || "")) && !msg.key.fromMe)
      base.referral = { source_type: "ad", source_id: "", headline: String(ci.entryPointConversionSource || ci.conversionSource), body: "", source_url: "", ctwa_clid: "" };
  } catch (e) {}
  // resposta de botao — nos formatos que o WhatsApp usa, e o "1"/"2"/texto do botao como reserva
  const nf = m.interactiveResponseMessage && m.interactiveResponseMessage.nativeFlowResponseMessage;
  if (nf) { try { const p = JSON.parse(nf.paramsJson || "{}"); const b = (botoesPorConversa.get(jid) || []).find((x) => x.id === p.id);
    return Object.assign(base, { tipo: "botao", botao: { id: p.id, title: (b && b.title) || (m.interactiveResponseMessage.body && m.interactiveResponseMessage.body.text) || "" } }); } catch (e) {} }
  if (m.listResponseMessage && m.listResponseMessage.singleSelectReply) return Object.assign(base, { tipo: "botao", botao: { id: m.listResponseMessage.singleSelectReply.selectedRowId, title: m.listResponseMessage.title || "" } });
  if (m.buttonsResponseMessage) return Object.assign(base, { tipo: "botao", botao: { id: m.buttonsResponseMessage.selectedButtonId, title: m.buttonsResponseMessage.selectedDisplayText || "" } });
  if (m.templateButtonReplyMessage) return Object.assign(base, { tipo: "botao", botao: { id: m.templateButtonReplyMessage.selectedId, title: m.templateButtonReplyMessage.selectedDisplayText || "" } });
  const texto = m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || "";
  if (texto) {
    const bts = botoesPorConversa.get(jid);
    if (bts && !msg.key.fromMe) {
      // "1", "1.", "1)", "1️⃣", "opção 1": o numero sozinho, com enfeite em volta
      const t = texto.trim(), mn = /^\D{0,8}([1-9])\D{0,6}$/.exec(t), n = mn ? Number(mn[1]) : 0;
      const b = (n && bts[n - 1]) || bts.find((x) => x.title.toLowerCase() === t.toLowerCase());
      if (b) return Object.assign(base, { tipo: "botao", botao: { id: b.id, title: b.title } });
    }
    return Object.assign(base, { tipo: "texto", texto });
  }
  if (m.reactionMessage) return Object.assign(base, { tipo: "reacao", reacao: { emoji: m.reactionMessage.text || "", ao: (m.reactionMessage.key && m.reactionMessage.key.id) || "" } });
  const midias = [["imageMessage", "image"], ["audioMessage", "audio"], ["videoMessage", "video"], ["documentMessage", "document"], ["stickerMessage", "sticker"]];
  for (const [campo, tipo] of midias) {
    if (!m[campo]) continue;
    const x = m[campo], mime = String(x.mimetype || "").split(";")[0];
    let chave = "";
    /* NA COLETA O ARQUIVO NÃO É GUARDADO (ver api/atendimento.js,
     * ?recurso=ponte): guardar pediria a chave de serviço no Storage, um
     * terceiro uso que a decisão 9 proíbe sem conversa. Enquanto o ERP
     * devolve chave vazia, baixar o vídeo para jogar fora é só banda e
     * memória -- então nem se baixa. `GUARDA_MIDIA=1` religa quando o
     * outro lado souber guardar. */
    if (GUARDA_MIDIA) {
      try { const buf = await downloadMediaMessage(msg, "buffer", {}, { logger: log, reuploadRequest: sock.updateMediaMessage }); chave = await subirMidia(buf, mime, x.fileName || tipo); } catch (e) { log.warn({ e: String(e) }, "mídia não baixou"); }
    }
    return Object.assign(base, { tipo: "midia", midia: { tipo, mime, nome: x.fileName || "", legenda: x.caption || "", voz: !!x.ptt, chave } });
  }
  return null;
}

/* ---------- ligar ---------- */
async function ligar() {
  if (ligando || !CANAL) return; ligando = true;
  try {
    const { state, salvarCreds } = await estadoDeAuth();
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    st.estado = "conectando"; st.erro = "";
    sock = makeWASocket({ auth: state, logger: log, version, browser: ["Vaapty", "Chrome", "1.0"], markOnlineOnConnect: false, syncFullHistory: false });
    sock.ev.on("creds.update", salvarCreds);
    sock.ev.on("connection.update", async (u) => {
      if (u.qr) { st.estado = "qr"; st.qr = u.qr; }
      if (u.connection === "open") {
        tentativas = 0; st.estado = "conectado"; st.qr = ""; st.desde = Date.now();
        st.numero = String((sock.user && sock.user.id) || "").split(":")[0].split("@")[0]; st.nome = (sock.user && sock.user.name) || "";
        proErp("/ponte/estado", { estado: "conectado", numero: st.numero, nome: st.nome });
      }
      if (u.connection === "close") {
        const cod = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
        sock = null;
        if (cod === DisconnectReason.loggedOut) {
          // desconectaram pelo celular (ou a sessao caiu de vez): limpa e volta a mostrar QR
          st.estado = "desligado"; st.numero = ""; st.erro = "desconectado pelo celular";
          proErp("/ponte/estado", { estado: "desligado" });
          await authZerar();
          setTimeout(() => { ligando = false; ligar(); }, 1500);
        } else {
          st.estado = "reconectando"; st.erro = "código " + cod;
          const espera = Math.min(60000, 2000 * Math.pow(2, tentativas++));
          setTimeout(() => { ligando = false; ligar(); }, espera);
        }
      }
    });
    sock.ev.on("lid-mapping.update", (m) => { try { for (const x of [].concat(m || [])) aprenderLid(x.lid, x.pn); } catch (e) {} });
    sock.ev.on("messaging-history.set", (h) => { try { for (const x of (h && h.lidPnMappings) || []) aprenderLid(x.lid, x.pn); } catch (e) {} });
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages) {
        const jid = msg.key && msg.key.remoteJid || "";
        if (!jid || /@g\.us$|@broadcast$|@newsletter$/.test(jid)) continue;          // grupo, status, canal: fora
        if (msg.key.fromMe && enviadosPorMim.has(msg.key.id)) continue;               // o que nos mesmos mandamos
        const dsm = msg.message && msg.message.deviceSentMessage;
        const chave0 = dsm && dsm.destinationJid ? Object.assign({}, msg.key, { remoteJid: dsm.destinationJid }) : msg.key;
        const fone = await foneDoJid(chave0); if (!fone) { pular("sem telefone (LID sem mapa)", msg); continue; }
        if (st.numero && fone === st.numero) continue;   // conversa consigo mesmo (anotacoes do celular)
        const chaves = Object.keys(msg.message || {}).filter((k) => ["messageContextInfo", "senderKeyDistributionMessage"].indexOf(k) < 0);
        if (!chaves.length || chaves[0] === "protocolMessage") continue;   // mensagem tecnica, sem conteudo pra pessoa
        const t = await traduzir(msg); if (!t) { pular("tipo de mensagem não tratado: " + Object.keys(msg.message || {}).join(","), msg); continue; }
        await proErp("/ponte/entrada", Object.assign(t, { fone, eco: !!msg.key.fromMe }));
      }
    });
    /* RECIBOS (24/09/2026, o Derek: "consegue analisar se chegou pra cliente a mensagem do robo?").
       Entregue/lida chegam por aqui (recibo de cada destinatario) e nao so pelo `messages.update`
       — sem este, a conversa nunca mostrava os dois tracos nem dava pra saber se chegou. */
    sock.ev.on("message-receipt.update", async (ups) => {
      for (const u of ups || []) {
        const r = u.receipt || {}, nome = r.readTimestamp || r.playedTimestamp ? "read" : (r.receiptTimestamp ? "delivered" : "");
        if (!nome || !u.key || !u.key.id) continue;
        const fone = await foneDoJid(Object.assign({}, u.key, { remoteJid: u.key.remoteJid || r.userJid })); if (!fone) continue;
        proErp("/ponte/status", { id: u.key.id, status: nome, fone });
      }
    });
    sock.ev.on("messages.update", async (ups) => {
      for (const u of ups) {
        const s = u.update && u.update.status; if (!s || !u.key.fromMe) continue;
        const nome = s >= 4 ? "read" : (s === 3 ? "delivered" : (s === 2 ? "sent" : "")); if (!nome) continue;
        const fone = await foneDoJid(u.key); if (!fone) continue;
        proErp("/ponte/status", { id: u.key.id, status: nome, fone });
      }
    });
  } catch (e) {
    st.estado = "erro"; st.erro = String((e && e.message) || e).slice(0, 200);
    setTimeout(() => { ligando = false; ligar(); }, 10000);
    return;
  }
  ligando = false;
}

/* ---------- mandar (recebe o formato da Meta, que e o que o sistema ja fala) ---------- */
/* O ENDERECO REAL DO NUMERO (24/09/2026, o orcamento pro Derek "nao chegou"). Numero de celular antigo no Brasil
   esta registrado no WhatsApp SEM o nono digito (554788315272), e o sistema mandou pra 5547988315272: o servidor
   aceita, nao entrega e nao manda recibo nenhum — some calado. Antes de enviar, pergunta ao WhatsApp qual e o
   endereco (onWhatsApp), tentando com e sem o 9; guarda por 1 dia. Numero que nao tem WhatsApp vira ERRO. */
const _jids = new Map();
async function jidDe(para) {
  const d = String(para).replace(/\D/g, "");
  const c = _jids.get(d); if (c && Date.now() - c.q < 86400000) return c.jid;
  const tenta = [d];
  if (/^55\d{2}9\d{8}$/.test(d)) tenta.push(d.slice(0, 4) + d.slice(5));            // sem o nono digito
  else if (/^55\d{2}[6-9]\d{7}$/.test(d)) tenta.push(d.slice(0, 4) + "9" + d.slice(4)); // com o nono digito
  for (const n of tenta) {
    try { const r = await sock.onWhatsApp(n); const x = (r || []).find((y) => y && y.exists); if (x && x.jid) { _jids.set(d, { jid: x.jid, q: Date.now() }); return x.jid; } } catch (e) { return d + "@s.whatsapp.net"; }   // consulta falhou: segue como antes
  }
  _jids.set(d, { jid: null, q: Date.now() });
  return null;
}
async function enviar(para, c) {
  if (!sock || st.estado !== "conectado") return { ok: false, erro: "O número está desconectado — escaneie o QR code." };
  const jid = await jidDe(para);
  if (!jid) return { ok: false, erro: "Esse número não tem WhatsApp (conferi com e sem o 9)." };
  /* "DIGITANDO…" ANTES DE MANDAR (24/09/2026, disparos: "tem que ser feito de um jeito que se certifique que
     nao bloqueie o whatsapp"). Quem chama pede `digitando` (ms, ate 8 s): o contato ve o numero escrevendo,
     como uma pessoa faria, e o envio nao sai no mesmo instante do anterior. Falhar aqui nao impede o envio. */
  if (Number(c.digitando) > 0) {
    try { await sock.sendPresenceUpdate("composing", jid); await new Promise((ok) => setTimeout(ok, Math.min(8000, Number(c.digitando)))); await sock.sendPresenceUpdate("paused", jid); } catch (e) {}
  }
  let r;
  if (c.type === "text") r = await sock.sendMessage(jid, { text: c.text.body });
  else if (c.type === "image") r = await sock.sendMessage(jid, { image: { url: c.image.link }, caption: c.image.caption || undefined });
  else if (c.type === "video") r = await sock.sendMessage(jid, { video: { url: c.video.link }, caption: c.video.caption || undefined });
  else if (c.type === "audio") r = await sock.sendMessage(jid, { audio: { url: c.audio.link }, mimetype: "audio/ogg; codecs=opus", ptt: true });
  else if (c.type === "document") r = await sock.sendMessage(jid, { document: { url: c.document.link }, fileName: c.document.filename || "arquivo", mimetype: c.document.mime_type || "application/octet-stream", caption: c.document.caption || undefined });
  else if (c.type === "interactive" && c.interactive.type === "button" && BOTOES_COMO !== "nativo" && NATIVO_PARA.indexOf(String(para).replace(/\D/g, "")) < 0) {
    /* OPCOES NUMERADAS (24/09/2026). O formato de botao "nativeFlow" foi ACEITO pelo servidor do
       WhatsApp e NUNCA CHEGOU no celular do Derek — descartado calado, sem erro. Mensagem que some
       sem aviso e o pior jeito de falhar num robo de atendimento. Texto sempre chega: a pergunta e
       as opcoes com numero; volta "1", "2", "3" ou o texto da opcao (ver `traduzir`). */
    const bts = c.interactive.action.buttons.map((b) => ({ id: b.reply.id, title: b.reply.title }));
    botoesPorConversa.set(jid, bts);
    const num = ["1️⃣", "2️⃣", "3️⃣"];
    r = await sock.sendMessage(jid, { text: c.interactive.body.text + "\n\n" + bts.map((b, i) => num[i] + " " + b.title).join("\n") + "\n\n_Responda com o número da opção._" });
  }
  else if (c.type === "interactive" && c.interactive.type === "button") {
    /* BOTOES CLICAVEIS (24/09/2026). Tres tentativas no iPhone do Derek: o interativo DENTRO do
       embrulho "viewOnce" era aceito pelo servidor e nunca entregue no iPhone (no Android chegava).
       O mesmo interativo SEM o embrulho, com o no "biz/native_flow", chegou — e foi o que ele
       escolheu (teste B; o C, formato antigo, tambem chegou, mas o WhatsApp o esta aposentando).
       O rodape diz o que fazer se num aparelho qualquer os botoes nao vierem, e "1/2/3" continua
       valendo na volta (aqui e no servidor). */
    const bts = c.interactive.action.buttons.map((b) => ({ id: b.reply.id, title: b.reply.title }));
    botoesPorConversa.set(jid, bts);
    const I = proto.Message.InteractiveMessage;
    try {
      const msg = generateWAMessageFromContent(jid, { interactiveMessage: I.create({
        // IGUAL ao teste B que chegou no iPhone (24/09): cabecalho SEM subtitulo e rodape curto — a
        // versao com subtitulo vazio e rodape longo foi aceita pelo servidor e nunca entregue
        header: I.Header.create({ title: "", hasMediaAttachment: false }),
        body: I.Body.create({ text: c.interactive.body.text }),
        footer: I.Footer.create({ text: "Toque numa opção" }),
        nativeFlowMessage: I.NativeFlowMessage.create({ messageParamsJson: "",
          buttons: bts.map((b) => ({ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: b.title, id: b.id }) })) }),
      }) }, { userJid: sock.user.id });
      await sock.relayMessage(jid, msg.message, { messageId: msg.key.id,
        additionalNodes: [{ tag: "biz", attrs: {}, content: [{ tag: "interactive", attrs: { type: "native_flow", v: "1" }, content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" } }] }] }] });
      r = { key: msg.key };
    } catch (e) {
      log.warn({ e: String(e) }, "botão recusado, vai numerado");
      r = await sock.sendMessage(jid, { text: c.interactive.body.text + "\n\n" + bts.map((b, i) => (i + 1) + ". " + b.title).join("\n") + "\n\n_Responda com o número._" });
    }
  } else return { ok: false, erro: "tipo de mensagem não suportado pela conexão QR: " + c.type };
  const id = r && r.key && r.key.id || "";
  if (id) { enviadosPorMim.add(id); if (enviadosPorMim.size > 5000) enviadosPorMim.delete(enviadosPorMim.values().next().value); }
  return { ok: true, id };
}

/* ---------- HTTP ---------- */
function json(res, cod, obj) { res.writeHead(cod, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); }
async function lerCorpo(req) { const partes = []; for await (const p of req) partes.push(p); return Buffer.concat(partes).toString("utf8"); }
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (req.headers["x-ponte-segredo"] !== SEGREDO) return json(res, 401, { ok: false, erro: "sem permissão" });
    const canal = u.searchParams.get("canal") || req.headers["x-canal"] || "";
    if (canal && !CANAL) { CANAL = canal; ligar(); }
    if (u.pathname === "/estado") { if (!sock && !ligando && CANAL) ligar(); return json(res, 200, Object.assign({ ok: true, canal: CANAL, lids: lidPn.size, pulados: pulados.slice(0, 10), testeBotoes: testeLog.slice(0, 9) }, st)); }
    if (u.pathname === "/enviar" && req.method === "POST") { const b = JSON.parse(await lerCorpo(req) || "{}"); return json(res, 200, await enviar(b.para, b.conteudo || {})); }
    if (u.pathname === "/sair" && req.method === "POST") { try { await sock.logout(); } catch (e) {} await authZerar(); return json(res, 200, { ok: true }); }
    return json(res, 404, { ok: false, erro: "caminho desconhecido" });
  } catch (e) { return json(res, 500, { ok: false, erro: String((e && e.message) || e).slice(0, 200) }); }
}).listen(8080, () => log.warn("ponte ouvindo na 8080"));
