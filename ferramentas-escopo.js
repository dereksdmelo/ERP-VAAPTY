
// Procura estado de React usado fora do componente que o declara.
// O Babel transpila sem reclamar: so quebra em tempo de execucao, com a
// tela em branco. Foi o que aconteceu com `perdendo` em 15/09/2026, e
// e o tipo de erro que so um teste assim ou abrir a tela pegam.
const fs = require("fs");
const h = fs.readFileSync(process.argv[2] || "index.html", "utf8");
const src = /<script type="text\/babel"[^>]*>([\s\S]*?)<\/script>/.exec(h)[1];

// Setters que nao sao estado de React.
const NATIVOS = /^set(Timeout|Interval|Date|Hours|Minutes|Seconds|Milliseconds|FullYear|Month|Time|Item|Attribute|Property|RequestHeader|SelectionRange|CustomValidity|Data)$/;

const linhas = src.split("\n");
const blocos = [];
let atual = null;
linhas.forEach((l) => {
  if (/^(function|const)\s+[A-Za-z_$][\w$]*\s*[=(]/.test(l)) {
    if (atual) blocos.push(atual);
    atual = { nome: (l.match(/^(?:function|const)\s+([\w$]+)/) || [])[1], cab: l, linhas: [] };
  }
  if (atual) atual.linhas.push(l);
});
if (atual) blocos.push(atual);

let ruins = 0;
blocos.forEach((b) => {
  const corpo = b.linhas.join("\n");
  const declara = new Set();
  let x;
  const rd = /const\s*\[\s*([\w$]+)\s*,\s*set([\w$]+)\s*\]\s*=\s*useState/g;
  while ((x = rd.exec(corpo))) declara.add("set" + x[2]);
  // props desestruturadas: tudo que esta entre { } na assinatura
  const props = new Set();
  const assin = /\(\s*\{([^}]*)\}/.exec(b.cab);
  if (assin) assin[1].split(",").forEach((p) => props.add(p.split(":")[0].trim()));

  const vistos = new Set();
  // Chamada com ponto na frente (`pc.setRemoteDescription()`) é método
  // de objeto, nunca estado de React — um setter do React se chama
  // sempre pelado. Sem esta exclusão, cada API do navegador que usa
  // `setAlgumaCoisa` vira um falso positivo novo, e ferramenta que
  // acusa demais para de ser lida.
  const ru = /(?<![.\w$])(set[A-Z][\w$]*)\s*\(/g;
  while ((x = ru.exec(corpo))) {
    const s = x[1];
    if (declara.has(s) || props.has(s) || NATIVOS.test(s) || vistos.has(s)) continue;
    // setter recebido como argumento nomeado em qualquer lugar do bloco
    if (new RegExp(`[({,]\\s*${s}\\s*[,})=]`).test(corpo)) continue;
    vistos.add(s);
    console.log(`  ${b.nome}(): chama ${s}() sem declarar o estado`);
    ruins++;
  }
});
console.log(ruins ? `\n${ruins} estado(s) fora de escopo` : "nenhum estado fora de escopo");
process.exit(ruins ? 1 : 0);
