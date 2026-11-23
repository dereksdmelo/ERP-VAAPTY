-- 0166 · A franquia em todas as tabelas (23/11/2026, o Derek: um banco só para a rede Shinkai, com o banco do
-- Shinkai migrando para cá). PRIMEIRO PASSO, e só aditivo: nada muda para Joinville.
--
--   * `franquia` nasce com uma linha só, a Vaapty Joinville, de id fixo (FRANQUIA_JOINVILLE).
--   * TODA tabela do schema public ganha `franquia_id`, NOT NULL, com padrão = Joinville e chave para `franquia`.
--     O padrão é o que mantém o sistema de hoje funcionando sem tocar em código: todo insert que não diz a
--     franquia (tela, servidor, funções security definer, cron) cai em Joinville, que é a verdade hoje.
--   * `minha_franquia()` diz a franquia de quem está logado (pelo perfil). Ainda não é usada em regra nenhuma.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ, de propósito: não muda RLS. Enquanto só existe uma franquia, filtrar por ela não
-- muda nada, e mexer nas regras de 81 tabelas é a etapa que pede teste com uma segunda franquia fictícia antes.
-- Também não mexe em índice único (numeração por ano, config_loja id=1): isso vem junto com as regras.
--
-- Adicionar coluna com padrão constante não reescreve a tabela (Postgres 11+); a chave estrangeira confere as
-- linhas uma vez. lock_timeout curto: se uma tabela estiver ocupada, a migração falha inteira em vez de segurar a
-- loja esperando — é só rodar de novo.

set lock_timeout = '5s';

create table if not exists franquia (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  slug       text not null unique,
  ativa      boolean not null default true,
  criado_em  timestamptz not null default now()
);

insert into franquia (id, nome, slug)
values ('00000000-0000-0000-0000-000000000001', 'Vaapty Joinville', 'joinville')
on conflict (id) do nothing;

alter table franquia enable row level security;
drop policy if exists franquia_le on franquia;
create policy franquia_le on franquia for select to authenticated using (e_equipe());
-- Sem política de escrita: franquia nova nasce por migração (ou pela futura tela da rede), nunca pela API.

do $$
declare t text;
begin
  for t in
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'franquia'
     order by table_name
  loop
    execute format(
      'alter table public.%I add column if not exists franquia_id uuid not null '
      'default ''00000000-0000-0000-0000-000000000001'' references franquia(id)', t);
    execute format('create index if not exists %I on public.%I (franquia_id)', left(t, 45) || '_franquia_idx', t);
  end loop;
end $$;

-- A franquia de quem chama. Nula para quem não tem perfil (o cron, a ponte, e no futuro o lojista do Shinkai).
create or replace function minha_franquia()
returns uuid as $$
  select franquia_id from perfil where id = auth.uid();
$$ language sql stable security definer set search_path = public, pg_temp;

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0166_franquia.sql') on conflict do nothing;
