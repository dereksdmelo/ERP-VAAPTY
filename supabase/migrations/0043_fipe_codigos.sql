-- =====================================================================
-- 0043 — Os três códigos da FIPE
--
-- O Mateus respondeu em 11/09/2026 o que faltava para os seletores da
-- ficha do Shinkai preencherem: **são os códigos, não os nomes.**
--
--   fipe_marca_codigo   "59"       VW
--   fipe_modelo_codigo  "8068"     Polo Comfort. 200 TSI 1.0 Flex 12V Aut.
--   fipe_ano_codigo     "2019-5"   ano + combustível
--
-- **Os três juntos, ou nenhum** — é regra da API deles: mandar um ou
-- dois deixa os seletores vazios do mesmo jeito.
--
-- Nós já tínhamos os três na mão e os jogávamos fora. `ConferirFipe`
-- escolhe marca, ano e modelo à mão contra a tabela oficial, e esses
-- são exatamente os parâmetros da consulta; o que faltava era coluna.
--
-- **Os códigos batem entre as duas fontes, e isso foi conferido, não
-- suposto.** O CRM deles consulta a parallelum; nós consultamos a FIPE
-- oficial (`veiculos.fipe.org.br`). Em 11/09/2026 comparei marca a
-- marca e modelo a modelo: Ford 22, Land Rover 33, VW 59 nas duas, e o
-- modelo 8068 é "Polo Comfort. 200 TSI 1.0 Flex 12V Aut." nas duas.
-- A parallelum espelha a mesma tabela. **Quem trocar a fonte de uma das
-- pontas confere assim de novo** — código de modelo trocado põe outro
-- carro na ficha do lojista.
--
-- `fipe_codigo` (o "005477-1") continua existindo e é outra coisa: é o
-- código do veículo na tabela, que preenche o campo de referência e
-- não move seletor nenhum.
-- =====================================================================

alter table veiculo
  add column if not exists fipe_marca_codigo  text,
  add column if not exists fipe_modelo_codigo text,
  add column if not exists fipe_ano_codigo    text;

comment on column veiculo.fipe_ano_codigo is
  'Ano + combustivel no formato da FIPE: "2019-5" e 2019 flex. Nunca so o ano.';
comment on column veiculo.fipe_modelo_codigo is
  'Codigo do modelo na tabela FIPE. Vale nos dois espelhos (oficial e parallelum), conferido em 11/09/2026.';
