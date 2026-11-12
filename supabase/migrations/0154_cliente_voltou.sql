-- 0154 · O cliente que VOLTA à loja (12/11/2026: um cliente já atendido no mês voltou, o Carlos o atendia no
-- atendimento antigo e a fila o dava como livre — "cliente em loja" só olhava atendimento com a data de hoje).
-- "O cliente voltou à loja" reabre o atendimento que já existe e grava a hora da volta; a fila e a marca de
-- "em loja" leem `voltou_em` de hoje como cliente na mesa.
alter table atendimento add column if not exists voltou_em timestamptz;

insert into schema_migrations(arquivo) values ('0154_cliente_voltou.sql') on conflict do nothing;
