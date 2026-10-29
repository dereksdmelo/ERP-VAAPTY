-- =====================================================================
-- 0096 — Contas fixas: geradas todo mês, e na projeção do DRE
--
-- O Derek, em 28/10/2026: "aba pra contas fixas, para que eu possa gerar
-- todos os meses (tem contas fixas que são 100% fixas e outras são fixas
-- porque tem todo mês mas variam de acordo com o consumo, preciso compor
-- elas pra poder considerar numa projeção de DRE)".
--
-- **A conta fixa é o cadastro; o mês é um título** (`fin_lancamento`
-- aberto, decisão 26), gerado por um gesto e amarrado à conta por
-- `conta_fixa_id`. Um título por conta por competência (índice único):
-- gerar duas vezes não duplica.
--
-- **"Varia com o consumo" usa a média dos últimos três meses pagos**
-- dela, e o valor digitado aqui só enquanto não há histórico. O título
-- nasce com a estimativa e se ajusta quando a conta chega — a luz de
-- outubro não é a de setembro, e o DRE projetado precisa de um número
-- antes de ela chegar.
-- =====================================================================

create table if not exists fin_conta_fixa (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  categoria_id   uuid references fin_categoria(id),
  conta_id       uuid references fin_conta(id),
  favorecido     text,
  tipo           text not null default 'fixa' check (tipo in ('fixa', 'variavel')),
  valor          numeric(14,2) not null default 0,
  dia_vencimento int not null default 10 check (dia_vencimento between 1 and 31),
  ativo          boolean not null default true,
  observacao     text,
  criado_em      timestamptz not null default now()
);
alter table fin_conta_fixa enable row level security;
drop policy if exists fin_conta_fixa_acesso on fin_conta_fixa;
create policy fin_conta_fixa_acesso on fin_conta_fixa for all to authenticated using (e_financeiro()) with check (e_financeiro());

alter table fin_lancamento add column if not exists conta_fixa_id uuid references fin_conta_fixa(id) on delete set null;
create unique index if not exists fin_lancamento_conta_fixa_mes on fin_lancamento (conta_fixa_id, competencia)
  where conta_fixa_id is not null and situacao <> 'cancelado';
