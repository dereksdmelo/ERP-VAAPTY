-- 0169 · Cada franquia vê só a própria — a 0167 de volta, sem o que a deixava lenta (23/11/2026, decisão 79).
--
-- O ensaio achou a causa dos 1,7 s a mais nas Pendências: os índices `<tabela>_franquia_idx` da 0166. Com uma
-- franquia só, a coluna tem um valor e o índice não separa nada, mas a regra nova o oferecia ao planejador, que o
-- escolhia no lugar dos índices bons. Ensaio (gerente, mínimo de 3 voltas, desfeito no fim):
--   fin_pendencias sem regra 592 ms · regra nas 7 tabelas do financeiro 2.486 ms · regra sem os índices 603 ms.
-- E com a regra em TODAS as tabelas e sem os índices: Pendências 578→607, DRE do mês 45→46, lista de atendimentos
-- 27→26, estoque com custos 118→72, leads por etapa 87→73, mensagens de 30 dias 1.485→1.500, atendimentos com lead
-- 81→80 (ms, antes→depois). Quando houver várias franquias, o índice volta COMPOSTO onde a consulta pedir.
--
-- A regra é uma política RESTRITIVA por tabela (o Postgres a junta com E às de sempre), só para `authenticated`:
-- a franquia vem do login (0168), e o `perfil` só é lido para o token emitido antes do gancho. Quem não tem perfil
-- (o lojista do Shinkai, no futuro) não tem franquia e não vê nada. A chave anônima, a chave de serviço e as funções
-- security definer não passam por aqui — essas precisam filtrar sozinhas, e é a etapa seguinte.

set lock_timeout = '3s';
set statement_timeout = '60s';

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
    execute format('drop index if exists public.%I', left(t, 45) || '_franquia_idx');
    execute format('drop policy if exists franquia_isola on public.%I', t);
    execute format('create policy franquia_isola on public.%I as restrictive for all to authenticated '
                   'using (franquia_id = (select coalesce(nullif(auth.jwt() ->> ''franquia_id'', '''')::uuid, minha_franquia()))) '
                   'with check (franquia_id = (select coalesce(nullif(auth.jwt() ->> ''franquia_id'', '''')::uuid, minha_franquia())))', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0169_franquia_separa.sql') on conflict do nothing;
