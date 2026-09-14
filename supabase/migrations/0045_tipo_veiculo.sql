-- =====================================================================
-- 0045 — Carro, moto ou caminhão
--
-- A conferência na tabela FIPE só sabia consultar carros, e a Vaapty
-- também avalia moto e caminhão. Pedido do Derek em 14/09/2026:
-- "preciso poder selecionar se é moto ou caminhão, como na tabela
-- FIPE".
--
-- **São três tabelas diferentes dentro da FIPE**, e o código do tipo é
-- o que escolhe qual delas responde. Conferido contra a fonte na mesma
-- data (referência 337): 1 devolve 107 marcas de carro, 2 devolve 103
-- de moto e 3 devolve 29 de caminhão e ônibus; o 4 responde
-- `nadaencontrado`.
--
-- **E os códigos de marca NÃO são compartilhados entre elas.** "59" é
-- VW nos carros e outra coisa nas motos. Por isso o tipo precisa ficar
-- gravado junto dos três códigos da 0043: sem ele, um dia alguém
-- reconsulta a ficha com os códigos certos na tabela errada e traz o
-- valor de outro veículo.
--
-- O destino imediato é o Shinkai, que pede `tipo_veiculo` e recebia
-- "carros" fixo (decisão 36) — moto entrava lá como carro.
-- =====================================================================

alter table veiculo add column if not exists tipo_veiculo smallint not null default 1;

alter table veiculo add constraint veiculo_tipo_valido
  check (tipo_veiculo in (1, 2, 3));

comment on column veiculo.tipo_veiculo is
  'Tipo na tabela FIPE: 1 carro, 2 moto, 3 caminhao. Decide em qual das tres tabelas os codigos da 0043 valem.';
