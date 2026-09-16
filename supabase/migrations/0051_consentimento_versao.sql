-- =====================================================================
-- 0051 — Qual redação o cliente ouviu
--
-- A `negociacao_viva` guarda desde a 0033 se a escuta foi autorizada
-- (`escuta_ok`) e quando (`escuta_em`). Faltava a pergunta que só
-- aparece quando o aceite MUDA: autorizado a quê.
--
-- Em 16/09/2026 a frase lida ao cliente passou a autorizar o gerente a
-- **acompanhar e ouvir enquanto a conversa acontece** (decisão 45).
-- Quem consentiu com a redação anterior concordou com transcrição e
-- com áudio não gravado, e não com alguém ouvindo a sala. São
-- consentimentos diferentes, e "autorizado às 14:32" não distingue um
-- do outro.
--
-- **É por isso que a coluna existe antes do recurso.** No dia em que o
-- áudio ao vivo for construído, é esta marca que diz para quais
-- atendimentos ele pode ligar — e ela não se reconstrói depois: quem
-- não perguntou na hora não sabe mais o que foi dito.
--
-- Texto e não data: é a identidade de uma redação, não um instante. E
-- nulo é a resposta certa para todo atendimento anterior a hoje — quer
-- dizer "aceite antigo", que é exatamente o que eles são.
--
-- Sem mudança de RLS: as políticas da 0033 valem para a linha inteira.
-- =====================================================================

alter table negociacao_viva add column if not exists escuta_versao text;

comment on column negociacao_viva.escuta_versao is
  'Data da redação do consentimento que o cliente ouviu (CONSENTIMENTO_VERSAO no index.html). Nulo = aceite anterior a 16/09/2026, que não autoriza escuta ao vivo.';
