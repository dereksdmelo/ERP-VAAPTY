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

let postos = 0, pulados = [], ruins = [];
try {
  for (const nome of NOSSAS) {
    const v = valores.get(nome);
    if (!v) { pulados.push(nome); continue; }
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

console.log(postos + " no Cloudflare" + (pulados.length ? " · não estavam no arquivo: " + pulados.join(", ") : ""));
if (ruins.length) { console.log("falharam: " + ruins.join(", ")); process.exit(1); }
