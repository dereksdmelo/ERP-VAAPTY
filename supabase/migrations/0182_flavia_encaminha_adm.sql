-- =====================================================================
-- 0182 - A Flavia passa o assunto que nao e comercial para o ADM
--
-- O Derek, em 26/11/2026: "quando outra pessoa chame que nao e comercial,
-- por exemplo, o cliente ja fechou e quer discutir um pagamento, ou uma
-- multa... ela precisa direcionar para o numero do administrativo... e
-- enviar uma mensagem para o whats do administrativo avisando do caso e
-- tambem mandar o numero do adm para o cliente entrar em contato".
--
-- `ia_adm_da_conversa`: o numero do administrativo da franquia da conversa
-- (numero de operacao com "adm" no nome, como o `mandarPeloAdm` do
-- api/checklist.js) e se o ADM ja foi avisado desta conversa nas ultimas
-- 24 h. `ia_encaminhamento` guarda cada aviso. O follow-up (0180) nao
-- insiste em conversa encaminhada.
-- =====================================================================

create table if not exists ia_encaminhamento (
  id          uuid primary key default gen_random_uuid(),
  franquia_id uuid not null default '00000000-0000-0000-0000-000000000001' references franquia(id),
  conversa_id uuid not null references wa_conversa(id) on delete cascade,
  motivo      text,
  adm_canal   text,
  adm_telefone text,
  aviso       text,
  estado      text not null check (estado in ('enviada', 'falhou')),
  erro        text,
  criado_em   timestamptz not null default now()
);
create index if not exists ia_encaminhamento_conversa on ia_encaminhamento (conversa_id, criado_em desc);
alter table ia_encaminhamento enable row level security;
drop policy if exists ia_encaminhamento_le on ia_encaminhamento;
create policy ia_encaminhamento_le on ia_encaminhamento for select to authenticated using (e_equipe());
drop policy if exists franquia_isola on ia_encaminhamento;
create policy franquia_isola on ia_encaminhamento as restrictive for all to authenticated
  using (franquia_id = (select coalesce(nullif(auth.jwt() ->> 'franquia_id', '')::uuid, minha_franquia())))
  with check (franquia_id = (select coalesce(nullif(auth.jwt() ->> 'franquia_id', '')::uuid, minha_franquia())));

create or replace function ia_adm_da_conversa(p_segredo text, p_conversa uuid)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  select jsonb_build_object('canal', k.slug, 'nome', k.nome, 'telefone', k.telefone,
           'avisado_em', (select max(e.criado_em) from ia_encaminhamento e
                           where e.conversa_id = x.id and e.estado = 'enviada' and e.criado_em > now() - interval '24 hours'))
    into v
    from wa_conversa x
    join wa_canal k on k.franquia_id = x.franquia_id
   where x.id = p_conversa and k.ativo and not k.comercial and k.uso = 'operacao' and k.telefone is not null
   order by ((k.slug || ' ' || k.nome) ~* 'adm') desc, k.slug
   limit 1;
  return v;
end;
$$;
revoke all on function ia_adm_da_conversa(text, uuid) from public;
grant execute on function ia_adm_da_conversa(text, uuid) to anon, authenticated;

create or replace function ia_encaminhamento_gravar(p_segredo text, p_conversa uuid, p_motivo text, p_canal text,
  p_telefone text, p_aviso text, p_estado text, p_erro text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  insert into ia_encaminhamento (franquia_id, conversa_id, motivo, adm_canal, adm_telefone, aviso, estado, erro)
  select x.franquia_id, x.id, left(p_motivo, 500), p_canal, p_telefone, left(p_aviso, 2000), p_estado, left(p_erro, 300)
    from wa_conversa x where x.id = p_conversa;
end;
$$;
revoke all on function ia_encaminhamento_gravar(text, uuid, text, text, text, text, text, text) from public;
grant execute on function ia_encaminhamento_gravar(text, uuid, text, text, text, text, text, text) to anon, authenticated;

-- O follow-up nao insiste em conversa que foi passada ao ADM.
do $$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'ia_followup_proximo';
  if d ~ 'ia_encaminhamento' then return; end if;
  n := replace(d, '     -- a Flavia encerrou',
                  '     and not exists (select 1 from ia_encaminhamento e where e.conversa_id = x.id and e.criado_em > now() - interval ''30 days'')
     -- a Flavia encerrou');
  if n = d then raise exception 'nao achei o trecho em ia_followup_proximo'; end if;
  execute n;
end $$;
