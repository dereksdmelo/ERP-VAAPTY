-- 0127 — O vale vira título (08/11/2026)
-- O vale da aba Folha era só um registro que descontava do líquido: não era saída
-- no banco, não conciliava e o DRE não o via. Agora cada vale novo cria junto um título
-- a pagar (com a pessoa e a categoria da folha), ligado por esta coluna; a Conciliação
-- liga o título ao PIX como a qualquer outro.
alter table fin_vale add column if not exists lancamento_id uuid references fin_lancamento(id) on delete set null;
create index if not exists fin_vale_lancamento_idx on fin_vale (lancamento_id);
insert into schema_migrations(arquivo) values ('0127_vale_vira_titulo.sql') on conflict do nothing;
