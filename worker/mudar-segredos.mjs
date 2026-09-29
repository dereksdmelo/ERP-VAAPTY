/* MOVE OS SEGREDOS DA VERCEL PARA O CLOUDFLARE, sem ninguem ler.
 *
 *   node worker/mudar-segredos.mjs <arquivo.env>
 *
 * Por que existe: sao 14 valores, e redigitar cada um no painel e onde
 * se erra um caractere e se perde uma tarde procurando. Este programa
 * le o `.env` que a Vercel baixou e entrega cada valor ao
 * `wrangler secret put` PELA ENTRADA PADRAO.
 *
 * **O valor nunca e impresso, nunca vai para argumento de linha de
 * comando (que aparece no `ps` de qualquer processo da maquina) e
 * nunca entra na conversa com o Claude.** O que sai na tela e so o
 * NOME de cada variavel e se deu certo.
 *
 * O arquivo de origem e apagado no fim, sempre -- inclusive se algo
 * falhar no meio.
 */
/* ====================================================================
 * A ARMADILHA, descoberta em 29/09/2026 e o motivo de este arquivo
 * conferir o que move.
 *
 * **`vercel env pull` NAO devolve o valor de variavel marcada como
 * Sensitive na Vercel** -- ele escreve um PLACEHOLDER de 11
 * caracteres, sem avisar. O arquivo fica com a cara certa: o nome
 * esta la, tem valor entre aspas, o script move sem reclamar e o
 * `wrangler` aceita.
 *
 * O estrago e pior que nao ter movido nada: um placeholder de 11
 * caracteres **passa** no `if (!token)` dos handlers, entao o sistema
 * se da por configurado e so falha na hora de falar com o fornecedor
 * -- com o cliente na mesa.
 *
 * Na primeira passada vieram certas so `SUPABASE_URL` e
 * `SUPABASE_ANON_KEY`, que sao exatamente as duas que NAO sao
 * secretas (a anon key ja vai para o navegador). As cinco de verdade
 * vieram falsas.
 *
 * Por isso o `suspeito()` abaixo barra o que parece placeholder, e
 * por isso **este script nao substitui conferir o sistema no ar
 * depois**: foi um `?acao=cota` devolvendo "Token inválido" que pegou.
 * ==================================================================== */
import { readFileSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";

/* A lista e FECHADA, tirada do que os 12 handlers leem de process.env.
   Sem ela viriam junto as variaveis que a propria Vercel injeta
   (VERCEL_*, NX_*, TURBO_*) -- lixo no melhor caso, e no pior um valor
   da plataforma velha decidindo comportamento na plataforma nova. */
const NOSSAS = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY",
  "PLACAFIPE_TOKEN", "SHINKAI_API_KEY", "SHINKAI_ORIGEM", "ZAPSIGN_TOKEN",
  "ANTHROPIC_API_KEY", "IA_MODELO", "IA_JANELA", "IA_JANELA_RESUMO",
  "TURN_URL", "TURN_USUARIO", "TURN_SENHA"];

const arquivo = process.argv[2];
if (!arquivo) { console.error("uso: node worker/mudar-segredos.mjs <arquivo.env>"); process.exit(2); }

let bruto;
try { bruto = readFileSync(arquivo, "utf8"); }
catch (e) { console.error("não consegui ler " + arquivo + ": " + e.message); process.exit(2); }

const valores = new Map();
for (const linha of bruto.split("\n")) {
  const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linha);
  if (!m) continue;
  let v = m[2].trim();
  // A Vercel escreve com aspas e escapa quebra de linha como \n --
  // chave PEM e JWT multilinha chegam assim.
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"');
  }
  if (v) valores.set(m[1], v);
}

let postos = 0, pulados = [], ruins = [], falsos = [];
try {
  for (const nome of NOSSAS) {
    const v = valores.get(nome);
    if (!v) { pulados.push(nome); continue; }
    /* Placeholder da Vercel: curto e sem cara de credencial. Um JWT
       tem tres partes e passa de 100; token e chave passam de 20. */
    const jwt = v.split(".").length === 3 && v.length > 100;
    if (!jwt && v.length <= 20) {
      falsos.push(nome);
      console.log("  PULEI " + nome + " — valor de " + v.length + " caracteres, é o placeholder da Vercel, não a chave");
      continue;
    }
    const r = spawnSync("npx", ["wrangler", "secret", "put", nome],
      { input: v, cwd: new URL(".", import.meta.url).pathname, encoding: "utf8" });
    const ok = r.status === 0;
    if (ok) postos++; else ruins.push(nome);
    console.log((ok ? "  ok   " : "  FALHOU ") + nome + (ok ? "" : " — " + String(r.stderr || "").trim().split("\n").pop()));
  }
} finally {
  // Some com o arquivo aconteca o que acontecer. Segredo em disco e
  // segredo esperando vazar.
  try { unlinkSync(arquivo); console.log("\napaguei " + arquivo); }
  catch (e) { console.log("\n** APAGUE " + arquivo + " NA MAO: " + e.message + " **"); }
}

console.log("\n" + postos + " no Cloudflare" + (pulados.length ? " · não estavam no arquivo: " + pulados.join(", ") : ""));
if (falsos.length) {
  console.log("\n** A Vercel NAO entregou estas, por serem Sensitive — ponha à mão, uma a uma: **");
  for (const n of falsos) console.log("   npx wrangler secret put " + n);
}
if (ruins.length) { console.log("falharam: " + ruins.join(", ")); process.exit(1); }
