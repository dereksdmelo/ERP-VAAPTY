-- =====================================================================
-- 0025 — Contas a pagar e a receber: o título antes do banco
--
-- Até aqui `fin_lancamento` só sabia de dinheiro que JÁ saiu ou entrou:
-- toda linha vinha do extrato. O que a empresa deve na semana que vem
-- não existia em lugar nenhum — e é justamente isso que se olha para
-- saber se dá para pagar a folha.
--
-- **Um título e o movimento do banco são a MESMA linha.** O título
-- nasce `aberto`, com vencimento e sem conta; quando o extrato traz o
-- pagamento, a mesma linha vira `efetivado` e ganha a conta, a data
-- real e a chave do banco. Duas linhas — uma prevista e outra
-- realizada — obrigariam a decidir qual das duas o DRE conta, e a
-- resposta erra metade das vezes.
--
-- `revisar` é o que a conciliação automática deixa para trás: casei
-- este movimento com aquele título por valor e data, confira. Sem esse
-- sinalizador, o acerto automático vira acerto invisível.
-- =====================================================================

create type fin_situacao as enum (
  'aberto',      -- título: ainda não passou no banco
  'efetivado',   -- saiu/entrou de verdade
  'cancelado'    -- não vai acontecer
);

alter table fin_lancamento
  add column if not exists situacao   fin_situacao not null default 'efetivado',
  add column if not exists vencimento date,
  add column if not exists favorecido text,
  add column if not exists revisar    boolean not null default false,
  add column if not exists observacao text;

-- Título em aberto não tem banco ainda. Tudo que já existe é extrato,
-- então continua com conta — só o novo pode nascer sem.
alter table fin_lancamento alter column conta_id drop not null;

comment on column fin_lancamento.situacao is
  'aberto = título (contas a pagar/receber); efetivado = passou no banco.';
comment on column fin_lancamento.revisar is
  'A conciliação automática casou isto sozinha. Fica aceso até alguém conferir.';
comment on column fin_lancamento.favorecido is
  'Quem recebe (a pagar) ou quem paga (a receber). O nome que se procura na lista.';

-- A fila de contas a pagar é lida por vencimento o tempo todo.
create index if not exists fin_lanc_aberto_idx on fin_lancamento (vencimento)
  where situacao = 'aberto';
-- O casamento automático procura por valor entre os títulos abertos.
create index if not exists fin_lanc_casar_idx on fin_lancamento (situacao, debito, credito)
  where situacao = 'aberto';
