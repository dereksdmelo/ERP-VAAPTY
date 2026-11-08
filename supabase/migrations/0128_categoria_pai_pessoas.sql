-- 0128 — Categoria-mãe "Pessoas" (08/11/2026, o Derek)
-- O plano de contas era uma lista solta. `pai_id` agrupa: Pessoas > Prestação de Serviço,
-- Comissão, Bonificação, Vale, Rescisão, Provisões, INSS, IRRF. A mãe só agrupa: o DRE soma
-- as filhas, e o lançamento continua indo na subcategoria.
alter table fin_categoria add column if not exists pai_id uuid references fin_categoria(id) on delete set null;
insert into fin_categoria (nome, grupo, no_dre, ordem, ativa, pede_funcionario, tipo_custo)
select 'Pessoas', 'despesa', true, 30, true, false, 'fixa' where not exists (select 1 from fin_categoria where nome = 'Pessoas');
insert into fin_categoria (nome, grupo, no_dre, ordem, ativa, pede_funcionario, tipo_custo)
select 'Provisões', 'despesa', true, 31, true, true, 'fixa' where not exists (select 1 from fin_categoria where nome = 'Provisões');
update fin_categoria set pai_id = (select id from fin_categoria where nome = 'Pessoas')
 where nome in ('Prestação de Serviço','Comissão','Bonificação','Vale','Rescisão','Provisões','INSS','IRRF') and grupo = 'despesa';
insert into schema_migrations(arquivo) values ('0128_categoria_pai_pessoas.sql') on conflict do nothing;
