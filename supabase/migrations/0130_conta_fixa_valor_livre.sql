-- 0130 — Conta fixa paga uma vez por mês a um favorecido, de qualquer valor (08/11/2026)
-- O cartório (William Garcia de Souza) é pago uma vez por mês, em valor que muda (0,4% do
-- faturamento): o reconhecimento por valor (até 25%) nunca o liga ao título. Com esta marca, o
-- extrato liga o PIX ao título dessa conta fixa pelo NOME do favorecido, sem olhar o valor.
-- Vale só para a conta marcada; se houver mais de um pagamento no mês, o segundo não é ligado.
alter table fin_conta_fixa add column if not exists valor_livre boolean not null default false;
insert into schema_migrations(arquivo) values ('0130_conta_fixa_valor_livre.sql') on conflict do nothing;
