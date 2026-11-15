-- 0157 · A previsão do mês pela operação (14/11/2026, o Derek: "a previsão de rentabilidade do mês considerando
-- a previsão de 3 métricas: o ticket médio previsto, a quantidade de carros em loja prevista e a conversão
-- prevista… estime a rentabilidade da loja para mostrar aos gestores"). Ficam na linha do mês da meta da loja
-- (0018): clientes em loja previstos, conversão prevista (fração: 0.22 = 22%) e ticket médio previsto (R$ por
-- carro). Rentabilidade prevista = clientes × conversão × ticket. Vazias, a tela sugere a média dos 3 meses.
alter table meta_loja add column if not exists prev_clientes int;
alter table meta_loja add column if not exists prev_conversao numeric(6,4);
alter table meta_loja add column if not exists prev_ticket numeric(12,2);

insert into schema_migrations(arquivo) values ('0157_previsao_operacao.sql') on conflict do nothing;
