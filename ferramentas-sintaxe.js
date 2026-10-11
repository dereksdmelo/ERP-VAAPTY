/**
 * Confere que o `index.html` transpila ANTES de publicar.
 *
 * A aplicação inteira é UM script transpilado no navegador pelo Babel
 * (decisão 7): um erro de sintaxe não quebra uma tela, derruba o
 * sistema — o negociador abre e vê a página em branco, sem mensagem.
 * `ferramentas-escopo.js` acha estado fora do componente; este acha o
 * que nem chega a executar.
 *
 * Usa o `esbuild` que já está nas dependências da ponte do WhatsApp
 * (`workers/ponte-whatsapp`), sem instalar nada. O `esbuild` entende
 * JSX, que é tudo de que o Babel daqui precisa.
 *
 *     node ferramentas-sintaxe.js
 */
const fs = require("fs");
const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");

const esbuild = path.join(__dirname, "workers/ponte-whatsapp/node_modules/.bin/esbuild");
if (!fs.existsSync(esbuild)) {
  console.error("não achei o esbuild em workers/ponte-whatsapp — rode `npm install` lá, ou valide no navegador");
  process.exit(2);
}
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const m = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error("não achei o <script type=\"text/babel\"> no index.html"); process.exit(2); }

const tmp = path.join(os.tmpdir(), `vaapty-app-${process.pid}.jsx`);
fs.writeFileSync(tmp, m[1]);
const r = spawnSync(esbuild, [tmp, "--loader:.jsx=jsx", "--log-level=error", "--outfile=/dev/null"], { encoding: "utf8" });
fs.unlinkSync(tmp);
if (r.status !== 0) { console.error(r.stderr || r.stdout); console.error("O index.html NÃO transpila."); process.exit(1); }
console.log(`index.html transpila (${m[1].split("\n").length} linhas)`);
