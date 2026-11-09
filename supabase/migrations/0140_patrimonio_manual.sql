-- 0140 — O que o balanço não sabe sozinho (09/11/2026, o Derek: "faz o cadastro manual de imobilizado
-- e empréstimos"). O balanço patrimonial (decisão 75) é montado de contas, títulos e estoque; móveis,
-- equipamentos e o saldo de um empréstimo não estão em lugar nenhum. Cada item é uma linha:
--   lado ativo:   imobilizado (com depreciação opcional pela vida útil) ou outro ativo
--   lado passivo: empréstimo ou outra obrigação (o saldo devedor de hoje)
-- Desativar tira do balanço sem apagar (vendeu o equipamento, quitou o empréstimo).
create table if not exists fin_patrimonio (
  id uuid primary key default gen_random_uuid(),
  lado text not null check (lado in ('ativo', 'passivo')),
  tipo text not null check (tipo in ('imobilizado', 'outro_ativo', 'emprestimo', 'outro_passivo')),
  nome text not null,
  valor_original numeric(14,2) not null default 0,   -- custo de aquisição, ou valor contratado
  valor_atual numeric(14,2),                         -- digitado: saldo devedor / valor de hoje
  data date,                                         -- aquisição ou contratação
  vida_util_meses int check (vida_util_meses > 0),   -- imobilizado: deprecia em linha reta até zero
  credor text,                                       -- empréstimo: banco ou pessoa
  parcela_valor numeric(14,2),
  parcelas_restantes int,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check ((lado = 'ativo' and tipo in ('imobilizado', 'outro_ativo')) or (lado = 'passivo' and tipo in ('emprestimo', 'outro_passivo')))
);
alter table fin_patrimonio enable row level security;
drop policy if exists fin_patrimonio_acesso on fin_patrimonio;
create policy fin_patrimonio_acesso on fin_patrimonio for all to authenticated using (e_financeiro()) with check (e_financeiro());
insert into schema_migrations(arquivo) values ('0140_patrimonio_manual.sql') on conflict do nothing;
