-- =====================================================================
-- 0049 — A data do próximo contato no lead de indicação
--
-- A fila de indicações dizia quem ligar e não dizia QUANDO voltar. O
-- lead que não deu em nada na primeira ligação some da cabeça de quem
-- ligou — e some da fila também, porque "novo" e "em contato" são
-- estados sem prazo.
--
-- Pedido do Derek em 15/09/2026: data de próximo contato e observações,
-- e **a data leva o lead para a agenda do dia**, para lembrar de fazer.
--
-- `observacoes` já existia na 0011, sem tela. Ganha uma agora.
--
-- **O lead NÃO é copiado para a `agenda` (0046).** Ele entra na linha
-- do dia na hora de desenhar, como o atendimento — é a mesma regra da
-- decisão 41, e pelo mesmo motivo: copiar criaria uma segunda verdade
-- que envelhece quando o status do lead muda.
-- =====================================================================

alter table indicacao add column if not exists proximo_contato date;

comment on column indicacao.proximo_contato is
  'Quando voltar a ligar. Leva o lead para a agenda do dia, sem virar linha na tabela agenda.';

-- "O que eu tenho para ligar hoje" é a única pergunta nova aqui, e ela
-- só olha quem ainda está vivo na fila.
create index if not exists indicacao_proximo_idx
  on indicacao (proximo_contato)
  where proximo_contato is not null and status in ('novo', 'em_contato', 'agendado');
