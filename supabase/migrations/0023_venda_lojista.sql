-- =====================================================================
-- 0023 — Venda para lojistas: o preço pedido e o anúncio
--
-- O estoque sabia o que o carro custou e por quanto saiu. Faltava o
-- meio: por quanto ele está sendo oferecido, e se já foi anunciado.
--
-- `preco_pedido` fica no estoque e não em `veiculo.valor_por` porque
-- são coisas diferentes: `valor_por` é o preço ofertado ao lojista na
-- hora da avaliação, congelado no descritivo que foi para o grupo.
-- O preço pedido muda enquanto o carro está no pátio — abaixar preço
-- é a decisão de quem vende, e o histórico dela é o que explica a
-- margem no fim.
-- =====================================================================

alter table estoque
  add column if not exists preco_pedido  numeric(12,2),
  add column if not exists anunciado_em  timestamptz,
  -- [{ de: numeric, para: numeric, em: timestamptz }]
  add column if not exists precos jsonb not null default '[]';

comment on column estoque.preco_pedido is
  'Por quanto o carro está sendo oferecido ao lojista agora. Muda enquanto ele está no pátio.';
comment on column estoque.precos is
  'Histórico de mudança de preço: baixar preço é decisão de quem vende, e explica a margem no fim.';
comment on column estoque.anunciado_em is
  'Quando o carro foi publicado no Shinkai. Nulo é carro parado sem ninguém saber que existe.';

create index if not exists estoque_patio_idx on estoque (entrou_em)
  where situacao = 'em_estoque';
