/**
 * O teste do SCORE e do ÍNDICE AT.
 *
 *     node ferramentas-indice.js
 *
 * Os casos são os da aba FLUXO X CONVERSÃO do `CRM SETEMBRO 2026.xlsx`,
 * com o valor que a PLANILHA calculou — não o que eu acho que daria. A
 * fila da vez (decisão 67) é ordenada por este número: errar aqui manda
 * o cliente para a pessoa errada sem ninguém perceber.
 */
const { score, indiceAt } = require("./regras/indice-at.js");

const perto = (a, b) => Math.abs(a - b) < 1e-6;
let falhas = 0;
const confere = (nome, obtido, esperado) => {
  const ok = perto(obtido, esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"}  ${nome}: ${obtido} ${ok ? "" : `(esperado ${esperado})`}`);
};

// Setembro/2026, colunas C e F da aba.
const andreBruno = { atrasos: 1, avaliacao_google: 4, postura: 100 };
const andre = { atrasos: 1, avaliacao_google: 1, postura: 100 };
confere("ANDRÉ BRUNO score", score(andreBruno), 1.08);
confere("ANDRÉ BRUNO índice AT", indiceAt({ vendas: 1, fluxo: 14, score: score(andreBruno) }), 0.7714285714285715);
confere("ANDRE score", score(andre), 0.96);
confere("ANDRE índice AT", indiceAt({ vendas: 2, fluxo: 17, score: score(andre) }), 2.2588235294117647);

// O 360% que o PENDENCIAS.md não conseguia fechar (agosto): 1
// prospecção, 10 avaliações, 7 "ficou mais" → 1,2 × 2 × 1,5.
confere("agosto 360%", score({ prospectou: 1, avaliacao_google: 10, ficou_mais: 7, postura: 100 }), 3.6);
// E o 180%: 0, 5 e 2 → 1,5 × 1,2.
confere("agosto 180%", score({ prospectou: 0, avaliacao_google: 5, ficou_mais: 2, postura: 100 }), 1.8);

// As bordas que o IF aninhado decide.
confere("sem linha vale 1", score(null), 1);
confere("postura vazia vale 100%", score({ postura: null }), 1);
confere("postura 50%", score({ postura: 50 }), 0.5);
confere("2 atrasos ainda 0,8", score({ atrasos: 2 }), 0.8);
confere("3 vídeos já 2", score({ gravou_video: 3 }), 2);
confere("sem fluxo, índice 0", indiceAt({ vendas: 0, fluxo: 0, score: 1 }), 0);

if (falhas) { console.log(`\n${falhas} caso(s) falharam.`); process.exit(1); }
console.log("\ntodos os casos passaram.");
