/* O WORKER DA PONTE DO WHATSAPP POR QR CODE (24/09/2026).
 *
 * Uma instancia de container por numero (`canal`), acordada e mantida por aqui. Duas coisas moram
 * neste Worker e nao no container:
 *   - a SESSAO do WhatsApp (as chaves que o QR code gerou), no armazenamento do Durable Object: o
 *     container pode ser reiniciado a qualquer hora e, sem isto, pediria o QR de novo;
 *   - a porta: so passa quem tem o segredo compartilhado com o Worker do ERP.
 *
 * Quem fala com a ponte e so o Worker do ERP (enviar, estado, sair) e o proprio container (sessao). */
import { Container, getContainer } from "@cloudflare/containers";
/* SEM DOCKER (24/09/2026). O Mac do Derek nao roda Docker (macOS 13), e montar imagem propria exige
 * Docker. Entao o container usa a imagem OFICIAL do Node (docker.io/library/node) e, ao ligar, baixa
 * daqui o programa da ponte — `container/servidor.mjs` empacotado num arquivo so (esbuild), gerado
 * por `npm run empacotar`. Trocar a ponte = empacotar + `wrangler deploy`, sem imagem nova. */
import CODIGO from "./gerado/ponte.txt";
const CARREGADOR = "(async()=>{const r=await fetch(process.env.PONTE_URL+'/_codigo',{headers:{'x-ponte-segredo':process.env.PONTE_SEGREDO}});"
  + "if(!r.ok){console.error('nao baixei a ponte',r.status);process.exit(1)}require('fs').writeFileSync('/tmp/ponte.mjs',await r.text());await import('/tmp/ponte.mjs')})()";

export class Ponte extends Container {
  defaultPort = 8080;
  sleepAfter = "15m";   // o cron do ERP pergunta o estado a cada minuto: na pratica, nunca dorme

  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = { PONTE_SEGREDO: env.PONTE_SEGREDO || "", PONTE_URL: env.PONTE_URL || "", ERP_URL: env.ERP_URL || "", LOG: "warn",
      BOTOES: env.BOTOES || "texto", BOTOES_NATIVO_PARA: env.BOTOES_NATIVO_PARA || "" };
    this.entrypoint = ["node", "-e", CARREGADOR];
  }

  async fetch(req) {
    const u = new URL(req.url);
    if (u.pathname === "/_auth") return this.sessao(req);
    /* REINICIAR sem desconectar (24/09/2026): o programa e baixado ao LIGAR, entao publicar uma
       versao nova nao muda o container que ja esta rodando. Parar e deixar a proxima pergunta
       (o cron de 1 minuto) ligar de novo — a sessao esta guardada aqui, o QR nao volta. */
    if (u.pathname === "/_reiniciar") {
      let antes = null, erro = "";
      try { antes = await this.getState(); } catch (e) {}
      try { await this.destroy(); } catch (e) { erro = String((e && e.message) || e).slice(0, 150); }
      return Response.json({ ok: !erro, reiniciando: true, antes: antes, erro: erro || undefined });
    }
    return this.containerFetch(req);
  }

  /* A sessao: GET devolve tudo, PUT grava um lote (null apaga), DELETE zera (desconectado). O DO
     guarda ate 128 chaves por chamada — o lote e fatiado. */
  async sessao(req) {
    const s = this.ctx.storage;
    if (req.method === "GET") {
      const tudo = await s.list({ prefix: "a:" });
      const chaves = {};
      for (const [k, v] of tudo) chaves[k.slice(2)] = v;
      return Response.json({ ok: true, chaves });
    }
    if (req.method === "PUT") {
      const b = await req.json().catch(() => ({}));
      const pares = Object.entries(b.set || {});
      const por = [], tira = [];
      for (const [k, v] of pares) { if (v == null) tira.push("a:" + k); else por.push(["a:" + k, v]); }
      for (let i = 0; i < por.length; i += 100) await s.put(Object.fromEntries(por.slice(i, i + 100)));
      for (let i = 0; i < tira.length; i += 100) await s.delete(tira.slice(i, i + 100));
      return Response.json({ ok: true, gravadas: por.length, apagadas: tira.length });
    }
    if (req.method === "DELETE") {
      const tudo = await s.list({ prefix: "a:" });
      const ks = [...tudo.keys()];
      for (let i = 0; i < ks.length; i += 100) await s.delete(ks.slice(i, i + 100));
      return Response.json({ ok: true, apagadas: ks.length });
    }
    return Response.json({ ok: false, erro: "método" }, { status: 405 });
  }
}

export default {
  async fetch(req, env) {
    if (!env.PONTE_SEGREDO || req.headers.get("x-ponte-segredo") !== env.PONTE_SEGREDO)
      return Response.json({ ok: false, erro: "sem permissão" }, { status: 401 });
    const u = new URL(req.url);
    if (u.pathname === "/_codigo") return new Response(CODIGO, { headers: { "content-type": "text/javascript; charset=utf-8" } });
    const canal = String(u.searchParams.get("canal") || "").replace(/[^\w\-]/g, "").slice(0, 60);
    if (!canal) return Response.json({ ok: false, erro: "faltou o canal" }, { status: 400 });
    const h = new Headers(req.headers); h.set("x-canal", canal);
    try {
      return await getContainer(env.PONTE, canal).fetch(new Request(req, { headers: h }));
    } catch (e) {
      return Response.json({ ok: false, estado: "iniciando", erro: "a ponte está ligando: " + String((e && e.message) || e).slice(0, 160) }, { status: 503 });
    }
  },
};
