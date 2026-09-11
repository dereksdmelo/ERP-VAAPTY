-- =====================================================================
-- 0034 — O e-mail do login, visível na tela de acessos
--
-- "ANDRÉ B…" e "Amanda …" não dizem quem é quando há dois André. O que
-- identifica a conta é o e-mail com que a pessoa entra — e ele vivia
-- só em `auth.users`, que o PostgREST não expõe.
--
-- **Coluna em `perfil`, e não leitura de `auth.users` pela chave de
-- serviço.** A chave já teve que aparecer num segundo arquivo pela
-- 0032, e o teste que ficou anotado lá é: existe caminho pelo token do
-- usuário? Então não use a chave. Aqui existe — basta o gatilho copiar
-- o e-mail no cadastro, e aí a RLS de `perfil` (0004) passa a governar
-- quem vê, como governa o resto.
-- =====================================================================

alter table perfil add column if not exists email text;

comment on column perfil.email is
  'Cópia do e-mail de auth.users, gravada no cadastro. É o que identifica a conta na tela de acessos.';

-- Quem já existe: uma vez, agora.
update perfil p
   set email = u.email
  from auth.users u
 where u.id = p.id and p.email is distinct from u.email;

-- E daqui para frente, junto com o perfil.
create or replace function ao_criar_usuario()
returns trigger as $$
begin
  insert into perfil (id, nome, papel, ativo, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    'negociador',
    false,
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Trocar o e-mail no Supabase precisa refletir aqui, senão a tela passa
-- a mostrar um endereço que não entra mais.
create or replace function ao_mudar_email()
returns trigger as $$
begin
  if new.email is distinct from old.email then
    update perfil set email = new.email where id = new.id;
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists usuario_email_mudou on auth.users;
create trigger usuario_email_mudou
  after update on auth.users
  for each row execute function ao_mudar_email();
