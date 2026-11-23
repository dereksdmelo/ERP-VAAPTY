-- 0172 · O que o servidor grava sem login herda a franquia do registro pai (23/11/2026, decisão 79).
--
-- A ponte do WhatsApp, a IA, o cron e as páginas públicas (assinatura, DUT) gravam pela chave anônima, por funções
-- security definer, ou pela chave de serviço: não há login, então o padrão da coluna (0166) caía sempre em Joinville.
-- Com a segunda franquia, a conversa de um número dela nasceria em Joinville.
--
-- O remédio é um gatilho só, `herdar_franquia`, criado em toda tabela que tem chave estrangeira para outra tabela
-- com franquia: SEM LOGIN, a linha nova pega a franquia do primeiro pai preenchido (a ordem deixa `perfil` por
-- último), e a franquia fica guardada na transação (`app.franquia`) para o que for gravado depois sem pai — o lead
-- que a `wa_receber` cria depois de gravar a mensagem nasce na franquia do número. COM LOGIN, o gatilho não faz nada:
-- vale a franquia do login, e a regra da 0169 recusa outra.
--
-- `minha_franquia()` só lê `app.franquia` quando não há login, para ninguém logado trocar de franquia por ela.
-- E a pessoa criada pelo gerente nasce na franquia dele (`app_metadata.franquia_id`, que só a chave de serviço grava).

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function minha_franquia()
returns uuid as $$
  select coalesce(
    nullif(auth.jwt() ->> 'franquia_id', '')::uuid,
    (select franquia_id from perfil where id = auth.uid()),
    case when auth.uid() is null then nullif(current_setting('app.franquia', true), '')::uuid end);
$$ language sql stable security definer set search_path = public, pg_temp;

create or replace function herdar_franquia()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  i  int := 0;
  fr uuid;
begin
  if auth.uid() is not null then
    return new;
  end if;
  while i + 2 < tg_nargs loop
    execute format('select franquia_id from public.%I where %I = ($1).%I', tg_argv[i + 1], tg_argv[i + 2], tg_argv[i])
      into fr using new;
    if fr is not null then
      new.franquia_id := fr;
      perform set_config('app.franquia', fr::text, true);
      return new;
    end if;
    i := i + 3;
  end loop;
  return new;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    with fr as (
      select table_name t from information_schema.columns
       where table_schema = 'public' and column_name = 'franquia_id'
         and table_name in (select table_name from information_schema.tables
                             where table_schema = 'public' and table_type = 'BASE TABLE')
    ),
    fk as (
      select c.conrelid::regclass::text filho, a.attname col, c.confrelid::regclass::text pai, b.attname paicol
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute b on b.attrelid = c.confrelid and b.attnum = c.confkey[1]
       where c.contype = 'f' and array_length(c.conkey, 1) = 1
         and c.connamespace = 'public'::regnamespace and a.attname <> 'franquia_id'
    )
    select filho,
           string_agg(format('%L, %L, %L', col, pai, paicol), ', ' order by (pai = 'perfil'), (filho = pai), col) args
      from fk
     where filho in (select t from fr) and pai in (select t from fr)
     group by filho
  loop
    execute format('drop trigger if exists herdar_franquia on public.%I', r.filho);
    execute format('create trigger herdar_franquia before insert on public.%I for each row execute function herdar_franquia(%s)',
                   r.filho, r.args);
  end loop;
end $$;

create or replace function public.ao_criar_usuario()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
 insert into perfil (id, nome, papel, ativo, email, franquia_id)
 values (
 new.id,
 coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
 'negociador',
 false,
 new.email,
 coalesce(nullif(new.raw_app_meta_data->>'franquia_id', '')::uuid, '00000000-0000-0000-0000-000000000001'::uuid)
 )
 on conflict (id) do nothing;
 return new;
end;
$function$;

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0172_franquia_herdada.sql') on conflict do nothing;
