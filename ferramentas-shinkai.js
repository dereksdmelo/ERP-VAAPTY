/**
 * O teste da traducao de opcionais para a ficha do Shinkai.
 *
 *     node ferramentas-shinkai.js
 *
 * As duas listas sao LIDAS da fonte -- `OPCIONAIS` do `index.html` e
 * `OPCIONAL_SHINKAI` do `api/foto.js`. Copia de codigo de teste
 * envelhece calada, e ai o teste passa enquanto o carro chega pela
 * metade na mao do lojista.
 *
 * O que estes casos guardam: **opcional que o negociador marcou e
 * existe na ficha deles tem que chegar la marcado**. O casamento e
 * pelo nome exato e o que nao bate e descartado em silencio -- foi
 * assim que "Direcao hid./elet." sumiu do QUI3D81 sem ninguem ver.
 */
const fs = require("fs");
const path = require("path");

// Os chips da secao OPCIONAIS da ficha do Shinkai, lidos na tela deles
// em 21/09/2026 (ficha do QUI3D81). E dado de fora, entao esta escrito
// com a data: **quem mexer aqui confere na tela deles de novo**, nao
// de memoria. Se a lista crescer, e aqui e no mapa que ela entra.
const CHIPS_DELES = [
  "Completo",
  "Ar condicionado",
  "Direção hidráulica/elétrica",
  "ABS",
  "Som / Multimídia",
  "Sensor de ré",
  "Câmera de ré",
  "Rodas de liga",
  "Bancos em couro",
];

function pegar(arquivo, decl, fim) {
  const src = fs.readFileSync(path.join(__dirname, arquivo), "utf8");
  const i = src.indexOf(decl);
  if (i < 0) {
    console.error("Nao achei `" + decl + "` em " + arquivo + ". Se mudou de nome, acerte o marcador aqui.");
    process.exit(2);
  }
  const j = src.indexOf(fim, i);
  const mod = { exports: {} };
  new Function("module", "exports", src.slice(i, j + fim.length) +
    "\nmodule.exports=" + decl.replace(/^const\s+/, "").replace(/\s*=.*$/, "") + ";")(mod, mod.exports);
  return mod.exports;
}

const OPCIONAIS = pegar("index.html", "const OPCIONAIS = [", "];");
const OPCIONAL_SHINKAI = pegar("api/foto.js", "const OPCIONAL_SHINKAI = {", "};");

// O que o `api/foto.js` faz com a lista antes de mandar.
const traduzir = (lista) => lista.map((o) => OPCIONAL_SHINKAI[o] || o);

let falhas = 0;
const certo = (nome, ok, detalhe) => {
  if (ok) return console.log("ok   " + nome);
  falhas++;
  console.log("FALHOU " + nome + (detalhe ? "\n  " + detalhe : ""));
};

// 1. Todo chip deles tem que ser alcancavel a partir de algum opcional
//    nosso. Chip que nenhum opcional nosso produz e equipamento que o
//    lojista nunca vai ver marcado, por mais que o negociador marque.
CHIPS_DELES.forEach((chip) => {
  const origem = OPCIONAIS.filter((o) => traduzir([o])[0] === chip);
  certo("chip \"" + chip + "\" tem origem nossa",
    origem.length > 0,
    "nenhum opcional do index.html vira \"" + chip + "\" -- falta entrada em OPCIONAL_SHINKAI");
});

// 2. O mapa nunca aponta para fora da lista deles. Destino inventado e
//    pior que abreviacao: o chip nao existe, some igual, e ainda da a
//    impressao de que foi tratado.
Object.entries(OPCIONAL_SHINKAI).forEach(([de, para]) => {
  certo("\"" + de + "\" aponta para um chip que existe",
    CHIPS_DELES.indexOf(para) >= 0,
    "\"" + para + "\" nao esta na lista lida da tela deles");
  certo("\"" + de + "\" e um opcional nosso de verdade",
    OPCIONAIS.indexOf(de) >= 0,
    "o index.html nao oferece \"" + de + "\" -- entrada morta no mapa");
});

// 3. A traducao nao pode perder nem duplicar item. O que nao tem chip
//    continua indo (e ignorado la hoje, e chega sozinho no dia em que a
//    lista deles crescer); o que some aqui nao volta nunca.
const traduzida = traduzir(OPCIONAIS);
certo("nenhum opcional se perde na traducao",
  traduzida.length === OPCIONAIS.length,
  OPCIONAIS.length + " entraram, " + traduzida.length + " sairam");
certo("a traducao nao cria repetido",
  new Set(traduzida).size === traduzida.length,
  "dois opcionais nossos viraram o mesmo chip: " +
    traduzida.filter((x, i) => traduzida.indexOf(x) !== i).join(", "));

// 4. O caso do QUI3D81, que e o que abriu tudo isto.
const qui = traduzir(["Completo", "Ar condicionado", "Direção hid./elét.", "Travas elétricas"]);
certo("QUI3D81: a direcao sai com o nome do chip deles",
  qui[2] === "Direção hidráulica/elétrica",
  "saiu \"" + qui[2] + "\"");

// 5. O que AINDA nao chega, dito em voz alta. Nao e falha -- e a conta
//    que o Mateus precisa ver para decidir se a lista deles cresce.
const semChip = OPCIONAIS.filter((o) => CHIPS_DELES.indexOf(traduzir([o])[0]) < 0);
console.log("\n" + semChip.length + " de " + OPCIONAIS.length +
  " opcionais ainda nao tem chip na ficha do Shinkai e sao ignorados la:");
console.log("  " + semChip.join(", "));

console.log(falhas ? "\n" + falhas + " falha(s)" : "\nsem falhas");
process.exit(falhas ? 1 : 0);
