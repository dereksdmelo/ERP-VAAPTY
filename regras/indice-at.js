/**
 * O ÍNDICE AT e o SCORE de confiabilidade — a conta da planilha, num
 * lugar só.
 *
 * Saiu da célula do SCORE da aba FLUXO X CONVERSÃO do `CRM SETEMBRO
 * 2026.xlsx`, lida em 28/10/2026 (até ali era pendência: tentei derivar
 * dos números e não fechava). Conferido contra a mesma planilha: ANDRÉ
 * BRUNO, 1 atraso e 4 avaliações no Google, dá 0,8 × 1,35 = 1,08; com
 * 1 venda em 14 de fluxo, ÍNDICE AT 0,77 — os números dela.
 *
 *     ÍNDICE AT = conversão × SCORE × vendas × 10
 *
 * Ele decide a ordem da FILA DA VEZ (decisão 67): converte bem, é
 * confiável e vende — vem antes.
 *
 * Quem lê isto: `api/perfil.js` (o SCORE vai junto do desempenho para
 * o dashboard) e `api/atendimento.js` (a fila). Mora fora de `api/`
 * pelo teto de 12 funções, como o `regras/remuneracao.js`.
 * `ferramentas-indice.js` guarda os casos da planilha.
 */

// Cada item é uma escada: o primeiro degrau que a contagem NÃO alcança
// devolve o fator. `[1, 0.8], [2, 0.6]` quer dizer "abaixo de 1 vale 1;
// abaixo de 2 vale 0,8; abaixo de 3 vale 0,6; dali em diante, o último".
// É o IF aninhado da planilha, degrau por degrau.
const ESCADAS = {
  faltas:             [[1, 1], [2, 0.8], [3, 0.6], [Infinity, 0.3]],
  atrasos:            [[1, 1], [3, 0.8], [5, 0.6], [Infinity, 0.3]],
  perdeu_atendimento: [[1, 1], [2, 0.8], [3, 0.6], [Infinity, 0.3]],
  ficou_mais:         [[1, 1], [5, 1.2], [10, 1.5], [Infinity, 2]],
  avaliacao_errada:   [[1, 1], [2, 0.7], [3, 0.5], [Infinity, 0.3]],
  gravou_video:       [[1, 1], [2, 1.2], [3, 1.5], [Infinity, 2]],
  prospectou:         [[1, 1], [5, 1.2], [10, 1.5], [Infinity, 2]],
  avaliacao_google:   [[1, 1], [3, 1.2], [5, 1.35], [10, 1.5], [Infinity, 2]],
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const degrau = (escada, n) => { for (const [ate, f] of escada) if (n < ate) return f; return 1; };

/**
 * O SCORE de uma linha de `desempenho` (0013). Sem linha, é 1 — que é o
 * que a planilha dá com tudo zerado e postura 100%.
 *
 * **Postura é guardada em percentual** (100 = 1), porque é assim que a
 * tela da 0013 a digita; na planilha ela é o fator direto. Vazia, vale
 * 100%: postura não lançada não é postura ruim.
 */
function score(d) {
  if (!d) return 1;
  let s = 1;
  Object.keys(ESCADAS).forEach((k) => { s *= degrau(ESCADAS[k], num(d[k])); });
  const postura = d.postura == null || d.postura === "" ? 100 : num(d.postura);
  return s * (postura / 100);
}

/**
 * ÍNDICE AT. Conversão é FRAÇÃO (vendas ÷ fluxo), como na planilha —
 * o `conversao` do funil vem em percentual, e passar aquele número
 * aqui daria um índice cem vezes maior.
 */
function indiceAt({ vendas, fluxo, score: s }) {
  const v = num(vendas), f = num(fluxo);
  if (!f) return 0;
  return (v / f) * (s == null ? 1 : num(s)) * v * 10;
}

module.exports = { score, indiceAt, ESCADAS };
