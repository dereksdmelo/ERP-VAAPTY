-- =====================================================================
-- 0031 — A meta da pré-venda é outra cadeia
--
-- O cadastro dava a todo mundo os mesmos três campos do negociador —
-- atendimentos × conversão × ticket — e na pré-venda isso produzia
-- "R$ 0 · 30 carros", que não é meta de ninguém: quem prospecta não
-- vende carro, traz gente para a loja.
--
-- A cadeia dela, pelas palavras do Derek (09/09/2026):
--
--     prospecções × conv. agendamento × conv. comparecimento
--         = clientes trazidos à loja
--
-- Mesma ideia da 0018: o resultado é consequência, não entrada. O que
-- se digita é o que a pessoa controla — quantas prospecções ela faz, e
-- quanto ela converte em cada degrau. `meta_agendamentos` fica no meio
-- porque é o número que a pré-venda persegue no dia, e
-- `meta_comparecimentos` é a meta de verdade: cliente na loja.
--
-- Os dois são **derivados no servidor**, como `meta_valor` e
-- `meta_volume`. Quem escrever direto neles cria duas verdades para a
-- mesma meta.
-- =====================================================================

alter table negociador
  add column if not exists meta_prospeccoes         int          not null default 0,
  add column if not exists meta_conv_agendamento    numeric(5,2) not null default 0,
  add column if not exists meta_conv_comparecimento numeric(5,2) not null default 0,
  add column if not exists meta_agendamentos        int          not null default 0,
  add column if not exists meta_comparecimentos     int          not null default 0;

comment on column negociador.meta_prospeccoes is
  'Prospecções realizadas no mês. Entrada da meta da pré-venda.';
comment on column negociador.meta_conv_agendamento is
  'Conversão alvo de lead em agendamento, em pontos percentuais (25 = 25%).';
comment on column negociador.meta_conv_comparecimento is
  'Conversão alvo de agendamento em comparecimento, em pontos percentuais.';
comment on column negociador.meta_agendamentos is
  'DERIVADO: round(meta_prospeccoes * meta_conv_agendamento/100).';
comment on column negociador.meta_comparecimentos is
  'DERIVADO: round(meta_agendamentos * meta_conv_comparecimento/100). É a meta que importa — cliente trazido à loja.';
