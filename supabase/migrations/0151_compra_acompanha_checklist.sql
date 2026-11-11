-- 0151 · A compra no estoque acompanha o check list corrigido depois (11/11/2026, o Derek: o IWG8C85 entrou com
-- R$ 30.000 ao cliente, o desconto foi dado no check list — 29.869,84 — e o financeiro e o estoque continuavam
-- com 30.000). Enquanto o cliente não foi pago e ninguém digitou a compra no estoque, `puxarDoChecklist` a
-- atualiza; `compra_manual` marca a compra digitada no estoque, que passa a valer por cima.
alter table estoque add column if not exists compra_manual boolean not null default false;

insert into schema_migrations(arquivo) values ('0151_compra_acompanha_checklist.sql') on conflict do nothing;
