-- =====================================================================
-- 0037 — O resumo da pesquisa, para o gestor não ler a transcrição
--
-- O Derek olhou o painel e pediu: no lugar da conversa crua, um resumo
-- que fale da pesquisa do cliente, da negociação e do processo. Os
-- dois últimos já vinham; o primeiro não — motivo da venda, pretensão,
-- dívida no carro e decisor moram na ficha do aparelho e nunca
-- subiam.
--
-- Um jsonb e não oito colunas: é um retrato para ler, não campo para
-- consultar. Quem precisar cruzar motivo de venda com conversão vai
-- buscar no `atendimento`, que é onde o dado tem dono.
-- =====================================================================

alter table negociacao_viva
  add column if not exists pesquisa jsonb not null default '{}'::jsonb;

comment on column negociacao_viva.pesquisa is
  'Retrato da etapa P e do que o negociador anotou: motivo, pretensão, quitação, débitos, decisor, necessidade, objeção, forma de fechamento.';
