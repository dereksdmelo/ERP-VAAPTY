-- =====================================================================
-- 0111 — Uma linha do banco que paga VÁRIOS títulos
--
-- 05/11/2026, o Derek: "o banco, por alguma razão, em alguns lançamentos
-- manda um título só com a somatória de vários lançamentos… aí eu
-- preciso manualmente dividir que título é qual". Ex.: "BOLETOS
-- RECEBIDOS 30/10" com a soma dos boletos do dia. O casamento automático
-- (0025) é por valor exato, então a linha somada não baixa título nenhum
-- e os títulos ficam abertos com o dinheiro já no banco.
--
-- Dividir: cada título escolhido vira efetivado na conta e na data da
-- linha do banco (`extrato_id` aponta para ela), o que sobrar vira uma
-- linha "resto" (origem 'divisao'), e a linha do banco fica `cancelado`
-- com `dividido_em` — NÃO é apagada: a chave do extrato continua nela e
-- barra a mesma linha de entrar de novo na próxima importação.
-- =====================================================================

alter table fin_lancamento
  add column if not exists extrato_id  uuid references fin_lancamento(id) on delete set null,
  add column if not exists dividido_em timestamptz;
create index if not exists fin_lancamento_extrato on fin_lancamento (extrato_id) where extrato_id is not null;
