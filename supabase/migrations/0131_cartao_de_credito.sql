-- 0131 — O cartão de crédito como conta (08/11/2026, o Derek)
-- O cartão é uma conta onde as compras são lançadas uma a uma (cada uma com categoria, fornecedor e
-- competência — é o que o DRE soma). A fatura é o total de um ciclo; pagá-la é uma TRANSFERÊNCIA da
-- conta principal para o cartão (fora do DRE), e o saldo do cartão volta a zero.
do $$ declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'fin_conta'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%dinheiro%' loop
    execute format('alter table fin_conta drop constraint %I', c.conname);
  end loop;
end $$;
alter table fin_conta add constraint fin_conta_tipo_check check (tipo in ('banco', 'dinheiro', 'cartao'));
alter table fin_conta add column if not exists dia_fechamento int check (dia_fechamento between 1 and 31);
alter table fin_conta add column if not exists dia_vencimento int check (dia_vencimento between 1 and 31);
alter table fin_conta add column if not exists limite numeric(14,2);
alter table fin_conta add column if not exists conta_pagadora_id uuid references fin_conta(id) on delete set null;

create table if not exists fin_fatura (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references fin_conta(id) on delete cascade,
  ref text not null check (ref ~ '^[0-9]{4}-[0-9]{2}$'),      -- o mês do fechamento da fatura
  pago_em date, valor_pago numeric(14,2), grupo_id uuid,
  criado_em timestamptz not null default now(),
  unique (conta_id, ref)
);
alter table fin_fatura enable row level security;
drop policy if exists fin_fatura_acesso on fin_fatura;
create policy fin_fatura_acesso on fin_fatura for all to authenticated using (e_financeiro()) with check (e_financeiro());
insert into schema_migrations(arquivo) values ('0131_cartao_de_credito.sql') on conflict do nothing;
