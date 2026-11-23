-- 0167 · Cada franquia vê só a própria (23/11/2026, decisão 79, segundo passo).
--
-- !!! RODADA E DESFEITA NO MESMO DIA — NÃO RODAR COMO ESTÁ !!!
-- O ensaio (gerente, negociador, conta sem perfil, segunda franquia) passou, mas no ar as Pendências do
-- financeiro (`fin_pendencias`, security invoker, subconsultas pesadas) estouraram o statement timeout. As
-- políticas `franquia_isola` foram removidas uns 4 minutos depois; o padrão da coluna (coalesce(minha_franquia(),
-- Joinville)) ficou, e é inofensivo. A linha desta migração ficou em schema_migrations. Antes de pôr de volta:
-- medir `fin_pendencias` como gerente com a política, e baratear `minha_franquia()` (ler a franquia do JWT por um
-- Custom Access Token Hook, ou guardá-la na transação) — hoje ela consulta `perfil` e, dentro de subconsulta
-- correlacionada, roda por linha.
--
-- UMA política RESTRITIVA por tabela, em vez de reescrever as centenas de políticas que existem. O Postgres junta
-- política restritiva com E: a linha precisa passar nas regras de sempre (dono, gerente, financeiro…) E ser da
-- franquia de quem está logado. Nenhuma regra antiga muda, e tabela nova só precisa da mesma linha de política.
--
--   * vale só para `authenticated` (quem tem login). A chave anônima não lê tabela nenhuma direto (só funções
--     estreitas), e as funções security definer e a chave de serviço passam por cima da RLS — essas precisam
--     filtrar a franquia sozinhas, e é a etapa seguinte.
--   * quem não tem perfil (o lojista do Shinkai, quando vier) tem `minha_franquia()` nula e não vê NADA.
--   * `(select minha_franquia())` roda uma vez por consulta, não uma vez por linha.
--   * o padrão da coluna passa a ser a franquia de quem grava; sem login (cron, ponte), continua Joinville.
--
-- Com uma franquia só, nada muda para ninguém: todo perfil e toda linha estão em Joinville.

set lock_timeout = '5s';

do $$
declare t text;
begin
  for t in
    select table_name from information_schema.columns
     where table_schema = 'public' and column_name = 'franquia_id'
       and table_name in (select table_name from information_schema.tables
                           where table_schema = 'public' and table_type = 'BASE TABLE')
     order by table_name
  loop
    execute format('alter table public.%I alter column franquia_id set default '
                   'coalesce(minha_franquia(), ''00000000-0000-0000-0000-000000000001''::uuid)', t);
    execute format('drop policy if exists franquia_isola on public.%I', t);
    execute format('create policy franquia_isola on public.%I as restrictive for all to authenticated '
                   'using (franquia_id = (select minha_franquia())) '
                   'with check (franquia_id = (select minha_franquia()))', t);
  end loop;
end $$;

-- A própria franquia: cada um lê só a sua.
drop policy if exists franquia_le on franquia;
create policy franquia_le on franquia for select to authenticated using (id = (select minha_franquia()));

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0167_franquia_isola.sql') on conflict do nothing;
