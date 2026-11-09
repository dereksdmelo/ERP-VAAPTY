-- 0141 — Compra provisoria (09/11/2026, o Derek). O carro que entra no estoque sem o "liquido ao
-- cliente" do check list pega o valor fechado da negociacao, e fica marcado: a gestao e o negociador
-- veem o alerta ate o check list ser preenchido, e entao o valor certo entra no lugar e a marca sai.
alter table estoque add column if not exists compra_provisoria boolean not null default false;
insert into schema_migrations(arquivo) values ('0141_compra_provisoria.sql') on conflict do nothing;
