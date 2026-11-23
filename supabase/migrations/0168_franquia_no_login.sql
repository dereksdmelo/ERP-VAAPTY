-- 0168 · A franquia vai dentro do login (23/11/2026, decisão 79, depois da 0167 desfeita).
--
-- A 0167 travou as Pendências porque `minha_franquia()` consultava `perfil` a cada linha, dentro das subconsultas
-- correlacionadas da `fin_pendencias`. Aqui a franquia passa a viajar no próprio token: o Supabase chama
-- `custom_access_token_hook` toda vez que emite ou renova um login, e ela acrescenta `franquia_id` às claims. A
-- regra por franquia (0169) lê `auth.jwt()`, que é só ler um parâmetro da sessão — nada de tabela.
--
-- ESTA MIGRAÇÃO NÃO SEPARA NADA. Ela só põe a franquia no login. Depois de rodar, é preciso LIGAR o gancho no painel:
-- Authentication → Hooks → Customize Access Token (JWT) Claims → Postgres → public.custom_access_token_hook.
-- O token dura uma hora: a 0169 só entra quando todo login vivo já tiver passado pelo gancho.
--
-- Quem não tem perfil (o lojista do Shinkai, no futuro) recebe o login sem `franquia_id`, e a 0169 não lhe mostra
-- nada. O gancho NUNCA derruba o login: erro aqui seria ninguém conseguir entrar.

-- O gancho, no molde da documentação do Supabase: função comum, executada pelo `supabase_auth_admin`.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := coalesce(event->'claims', '{}'::jsonb);
  fr uuid;
begin
  begin
    select p.franquia_id into fr from public.perfil p where p.id = (event->>'user_id')::uuid;
  exception when others then
    fr := null;
  end;
  if fr is not null then
    claims := jsonb_set(claims, '{franquia_id}', to_jsonb(fr::text));
  else
    claims := claims - 'franquia_id';
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- O gancho lê `perfil`, que tem RLS: o `supabase_auth_admin` precisa de leitura e de uma política só dele.
grant select on public.perfil to supabase_auth_admin;
drop policy if exists perfil_auth_le on public.perfil;
create policy perfil_auth_le on public.perfil for select to supabase_auth_admin using (true);

-- `minha_franquia()` passa a ler o login primeiro; o perfil fica só para o token emitido antes do gancho.
create or replace function minha_franquia()
returns uuid as $$
  select coalesce(
    nullif(auth.jwt() ->> 'franquia_id', '')::uuid,
    (select franquia_id from perfil where id = auth.uid()));
$$ language sql stable security definer set search_path = public, pg_temp;

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0168_franquia_no_login.sql') on conflict do nothing;
