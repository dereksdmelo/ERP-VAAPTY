/**
 * O TESTE DISC DO RH (0174, decisão 80).
 *
 * O modelo DISC (Dominância, Influência, eStabilidade, Conformidade) é de William Marston, de 1928, e é de domínio
 * público. Os questionários comerciais (DiSC®, Thomas, Solides…) são obras protegidas — **este não é cópia de nenhum**:
 * as 24 linhas abaixo foram escritas para a Vaapty, com palavras do dia a dia de uma loja.
 *
 * O formato é o de escolha forçada: em cada linha a pessoa marca a palavra que MAIS parece com ela e a que MENOS
 * parece. A nota de cada fator é (mais − menos), de −24 a +24, levada para 0 a 100.
 *
 * **É um indicador de estilo, não um laudo.** Não mede inteligência, caráter nem competência, e não pode ser o motivo
 * sozinho de reprovar alguém — a tela diz isso. Serve para a conversa da entrevista e para saber como liderar a pessoa.
 *
 * Quem mudar as linhas muda a régua de quem já respondeu: as respostas ficam guardadas (rh_candidato.disc_respostas)
 * pelo ÍNDICE da linha, então trocar a ordem ou a palavra de uma linha estraga a releitura. Acrescente no fim.
 */

const LINHAS = [
  [["Decidido", "D"], ["Comunicativo", "I"], ["Paciente", "S"], ["Detalhista", "C"]],
  [["Entusiasmado", "I"], ["Preciso", "C"], ["Direto", "D"], ["Calmo", "S"]],
  [["Leal", "S"], ["Competitivo", "D"], ["Analítico", "C"], ["Sociável", "I"]],
  [["Organizado", "C"], ["Persuasivo", "I"], ["Prestativo", "S"], ["Ousado", "D"]],
  [["Firme", "D"], ["Constante", "S"], ["Otimista", "I"], ["Cuidadoso", "C"]],
  [["Animado", "I"], ["Tranquilo", "S"], ["Criterioso", "C"], ["Determinado", "D"]],
  [["Metódico", "C"], ["Exigente", "D"], ["Cooperativo", "S"], ["Expressivo", "I"]],
  [["Bom ouvinte", "S"], ["Inspirador", "I"], ["Independente", "D"], ["Lógico", "C"]],
  [["Enérgico", "D"], ["Disciplinado", "C"], ["Espontâneo", "I"], ["Gentil", "S"]],
  [["Cauteloso", "C"], ["Estável", "S"], ["Pioneiro", "D"], ["Carismático", "I"]],
  [["Divertido", "I"], ["Objetivo", "D"], ["Compreensivo", "S"], ["Exato", "C"]],
  [["Sereno", "S"], ["Sistemático", "C"], ["Convincente", "I"], ["Persistente", "D"]],
  [["Corajoso", "D"], ["Conciliador", "S"], ["Reservado", "C"], ["Falante", "I"]],
  [["Rigoroso", "C"], ["Popular", "I"], ["Ambicioso", "D"], ["Dedicado", "S"]],
  [["Extrovertido", "I"], ["Tolerante", "S"], ["Assertivo", "D"], ["Ponderado", "C"]],
  [["Amigável", "S"], ["Desafiador", "D"], ["Minucioso", "C"], ["Influente", "I"]],
  [["Resoluto", "D"], ["Correto", "C"], ["Alegre", "I"], ["Acolhedor", "S"]],
  [["Planejador", "C"], ["Envolvente", "I"], ["Confiável", "S"], ["Vigoroso", "D"]],
  [["Motivador", "I"], ["Rápido para decidir", "D"], ["Equilibrado", "S"], ["Investigador", "C"]],
  [["Diplomático", "S"], ["Prático", "D"], ["Questionador", "C"], ["Caloroso", "I"]],
  [["Focado em resultado", "D"], ["Atento às regras", "C"], ["Gosta de gente", "I"], ["Gosta de rotina", "S"]],
  [["Fala o que pensa", "D"], ["Faz amizade fácil", "I"], ["Evita conflito", "S"], ["Confere tudo duas vezes", "C"]],
  [["Assume o comando", "D"], ["Anima o grupo", "I"], ["Ajuda os colegas", "S"], ["Segue o procedimento", "C"]],
  [["Arrisca", "D"], ["Improvisa", "I"], ["Mantém a calma", "S"], ["Planeja antes", "C"]],
];

const FATORES = {
  D: { nome: "Dominância", curto: "Faz acontecer",
       texto: "Vai direto ao ponto, decide rápido e gosta de desafio e de resultado. Rende com meta clara e autonomia; "
            + "precisa cuidar da paciência e de ouvir antes de responder." },
  I: { nome: "Influência", curto: "Conquista pessoas",
       texto: "Comunicativo, otimista e convincente; cria conexão rápido e anima quem está em volta. Rende com contato "
            + "com gente e reconhecimento; precisa cuidar da organização e de terminar o que começou." },
  S: { nome: "Estabilidade", curto: "Sustenta o time",
       texto: "Paciente, leal e constante; ouve bem, acolhe e dá ritmo ao trabalho. Rende com rotina, clareza e um time "
            + "que confia nele; precisa cuidar de mudanças bruscas e de dizer não quando é preciso." },
  C: { nome: "Conformidade", curto: "Garante a qualidade",
       texto: "Cuidadoso, analítico e organizado; confere, segue o processo e não deixa erro passar. Rende com regras "
            + "claras e tempo para fazer bem; precisa cuidar do perfeccionismo e da velocidade." },
};

// Em que a loja costuma usar cada estilo: ajuda a ler, não decide nada.
const NA_VAAPTY = {
  D: "Negociação e gestão: sustenta a conversa de valor e fecha.",
  I: "Pré-vendas e negociação: abre a conversa, traz o cliente e cria confiança na mesa.",
  S: "Pré-vendas, administrativo e pós-venda: acompanha o cliente e não deixa ninguém sem resposta.",
  C: "Administrativo e financeiro: documentação, conferência, contratos e prazos.",
};

const perguntas = () => LINHAS.map((l, i) => ({ i, palavras: l.map((p) => p[0]) }));

/**
 * respostas: [{ mais: 0..3, menos: 0..3 }, …] — uma por linha, na ordem de LINHAS.
 * Devolve null quando não está completo ou é incoerente (mais = menos).
 */
function calcular(respostas) {
  if (!Array.isArray(respostas) || respostas.length !== LINHAS.length) return null;
  const bruto = { D: 0, I: 0, S: 0, C: 0 };
  for (let i = 0; i < LINHAS.length; i++) {
    const r = respostas[i] || {};
    const m = Number(r.mais), n = Number(r.menos);
    if (!(m >= 0 && m <= 3 && n >= 0 && n <= 3) || m === n || !Number.isInteger(m) || !Number.isInteger(n)) return null;
    bruto[LINHAS[i][m][1]] += 1;
    bruto[LINHAS[i][n][1]] -= 1;
  }
  const notas = {};
  Object.keys(bruto).forEach((f) => { notas[f] = Math.round(((bruto[f] + LINHAS.length) / (2 * LINHAS.length)) * 100); });
  return { ...notas, perfil: perfilDe(notas) };
}

/* O perfil é o fator mais alto; o segundo entra junto quando está perto (até 8 pontos) e acima do meio. "DI" é quem
 * decide e convence; "SC" é quem sustenta e confere. */
function perfilDe(n) {
  const ord = ["D", "I", "S", "C"].sort((a, b) => n[b] - n[a]);
  return n[ord[1]] >= 55 && n[ord[0]] - n[ord[1]] <= 8 ? ord[0] + ord[1] : ord[0];
}

// Quanto o candidato combina com o perfil que a vaga pede ("DI"): a média das notas dele nesses fatores.
function aderencia(notas, perfilVaga) {
  const fs = String(perfilVaga || "").toUpperCase().split("").filter((f) => "DISC".indexOf(f) >= 0);
  if (!fs.length || !notas) return null;
  return Math.round(fs.reduce((s, f) => s + (Number(notas[f]) || 0), 0) / fs.length);
}

module.exports = { LINHAS, FATORES, NA_VAAPTY, perguntas, calcular, perfilDe, aderencia };
