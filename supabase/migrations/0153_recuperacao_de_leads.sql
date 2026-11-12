-- 0153 · A recuperação de leads antigos pelos negociadores (12/11/2026, o Derek: "uma ferramenta para os
-- negociadores fazerem recuperação de leads antigos que não foram trazidos à loja… listas de ações para eles
-- ligarem dos celulares deles, fazer anotações e tentarem agendar… o gestor designe tais leads de tal período em
-- tal fase para tal negociador… dividir igualmente ou mais pra um do que pra outros").
--
-- O lead ganha um RESPONSÁVEL PELA RECUPERAÇÃO — o login do negociador — e a hora em que foi designado. É uma
-- marca no lead, não uma cópia: agendar, ligar e anotar continuam sendo o lead de sempre (a agenda, o quadro e as
-- Ações da pré-venda veem igual). O lote guarda o que o gestor escolheu, para saber depois de onde veio cada lista.
create table if not exists recuperacao_lote (
  id         uuid primary key default gen_random_uuid(),
  criado_em  timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  descricao  text,
  filtro     jsonb not null default '{}'::jsonb,
  divisao    jsonb not null default '[]'::jsonb,
  total      int not null default 0
);
alter table recuperacao_lote enable row level security;
drop policy if exists recuperacao_lote_le on recuperacao_lote;
create policy recuperacao_lote_le on recuperacao_lote for select to authenticated using (e_equipe());
drop policy if exists recuperacao_lote_gere on recuperacao_lote;
create policy recuperacao_lote_gere on recuperacao_lote for all to authenticated using (e_gerente()) with check (e_gerente());

alter table lead add column if not exists recuperador_id uuid references perfil(id) on delete set null;
alter table lead add column if not exists recuperador_nome text;
alter table lead add column if not exists recuperacao_em timestamptz;
alter table lead add column if not exists recuperacao_lote uuid references recuperacao_lote(id) on delete set null;
create index if not exists lead_recuperador on lead (recuperador_id) where recuperador_id is not null;

insert into schema_migrations(arquivo) values ('0153_recuperacao_de_leads.sql') on conflict do nothing;
