-- =====================================================================
-- 0180 - O follow-up de quem parou de responder
--
-- O Derek, em 26/11/2026: "quero saber o follow up, quando o cliente para
-- de responder, como a IA continua insistindo na conversa". Nao insistia:
-- a Flavia so falava quando o cliente escrevia (fora lembrete e retomada).
-- No numero da Ana saiam 600-650 follow-ups por semana; desde 23/11, quando
-- a Flavia assumiu, nenhum - e havia 255 conversas paradas com a loja
-- falando por ultimo.
--
-- O ritmo, medido nas conversas da Ana de 20/10 a 20/11:
--   1o follow-up: mediana 6 h depois da ultima mensagem da loja (p25 4 h);
--   2o, 3o, 4o: 24 h depois do anterior;
--   o cliente voltou em 30% das conversas que chegaram ao 2o e ao 3o,
--   e em 20% das que chegaram ao 4o e 5o.
--   A Ana mandava as 5h e 6h da manha; aqui so das 8h30 as 18h30.
--
-- Aqui: 1o 4 h depois, os seguintes 22 h depois do anterior, ate
-- `config_loja.ia_followup_max` (3, o que a base da Flavia ja previa),
-- segunda a sabado, das 8h30 as 18h30. O texto quem escreve e a propria
-- Flavia, lendo a conversa (ia/atender.js, `insistir`).
--
-- Quem NAO recebe: lead agendado, confirmado, que veio, que faltou (esse e
-- da retomada), perdido, excluido ou fora da regiao; quem teve atendimento
-- nos ultimos 30 dias; quem disse que ja vendeu, que nao quer ou pediu para
-- parar; conversa encerrada pela Flavia; conversa com a IA desligada; e
-- conversa em que uma pessoa da loja escreveu nas ultimas 12 horas.
-- =====================================================================

alter table config_loja add column if not exists ia_followup boolean not null default true;
alter table config_loja add column if not exists ia_followup_max int not null default 3;

create table if not exists ia_followup (
  id          uuid primary key default gen_random_uuid(),
  franquia_id uuid not null default '00000000-0000-0000-0000-000000000001' references franquia(id),
  conversa_id uuid not null references wa_conversa(id) on delete cascade,
  n           int not null,
  canal       text not null,
  telefone    text not null,
  mensagens   jsonb,
  wa_ids      jsonb not null default '[]'::jsonb,
  estado      text not null check (estado in ('enviada', 'falhou')),
  erro        text,
  criado_em   timestamptz not null default now()
);
create index if not exists ia_followup_conversa on ia_followup (conversa_id, criado_em desc);
create index if not exists ia_followup_quando on ia_followup (criado_em desc);
alter table ia_followup enable row level security;
drop policy if exists ia_followup_le on ia_followup;
create policy ia_followup_le on ia_followup for select to authenticated using (e_equipe());
drop policy if exists franquia_isola on ia_followup;
create policy franquia_isola on ia_followup as restrictive for all to authenticated
  using (franquia_id = (select coalesce(nullif(auth.jwt() ->> 'franquia_id', '')::uuid, minha_franquia())))
  with check (franquia_id = (select coalesce(nullif(auth.jwt() ->> 'franquia_id', '')::uuid, minha_franquia())));

-- Os ids que a Flavia mandou, de qualquer origem.
create or replace function ia_e_da_flavia(p_wa_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ia_resposta r where r.wa_ids ? p_wa_id)
      or exists (select 1 from ia_retomada r where r.wa_ids ? p_wa_id)
      or exists (select 1 from ia_lembrete r where r.wa_ids ? p_wa_id)
      or exists (select 1 from ia_followup r where r.wa_ids ? p_wa_id);
$$;
revoke all on function ia_e_da_flavia(text) from public;

create or replace function ia_followup_proximo(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_ultima timestamptz;
  v_hoje int;
  v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  if extract(isodow from v_agora) = 7 or v_agora::time < '08:30' or v_agora::time >= '18:30' then return null; end if;
  select max(criado_em), count(*) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = v_agora::date)
    into v_ultima, v_hoje from ia_followup;
  if v_hoje >= 80 then return null; end if;
  if v_ultima is not null and v_ultima > now() - make_interval(secs => 60 + (extract(minute from now())::int % 4) * 20) then return null; end if;

  select jsonb_build_object('conversa_id', x.id, 'canal', k.slug, 'telefone', x.telefone, 'nome', x.nome,
                            'n', f.n + 1, 'max', coalesce(cl.ia_followup_max, 3),
                            'desde', to_char(ult.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'))
    into v
    from wa_conversa x
    join wa_canal k on k.id = x.canal_id
    left join lateral (select c.ia_followup, c.ia_followup_max from config_loja c where c.franquia_id = x.franquia_id limit 1) cl on true
    cross join lateral (
      select m.eco, m.quando from wa_mensagem m
       where m.conversa_id = x.id and m.tipo <> 'reacao'
       order by m.quando desc limit 1
    ) ult
    cross join lateral (
      select count(*)::int as n from ia_followup fu
       where fu.conversa_id = x.id and fu.estado = 'enviada' and fu.criado_em > coalesce(x.ultima_de_fora, '-infinity')
    ) f
   where k.ativo and k.comercial and k.ia_responde and k.ia_desde is not null and k.telefone is not null
     and not x.grupo
     and coalesce(x.ia_modo, '') <> 'desligada'
     and coalesce(cl.ia_followup, true)
     and exists (select 1 from wa_conversa y where y.canal_id = k.id and y.ultima_em > now() - interval '6 hours')
     -- o cliente falou, a loja respondeu por ultimo, e ele sumiu ha pouco (ate 7 dias)
     and x.ultima_de_fora is not null and x.ultima_de_fora > now() - interval '7 days'
     and ult.eco
     and f.n < coalesce(cl.ia_followup_max, 3)
     and ult.quando <= now() - case when f.n = 0 then interval '4 hours' else interval '22 hours' end
     and length(regexp_replace(coalesce(x.telefone, ''), '\D', '', 'g')) between 10 and 13
     -- falhou ha pouco: nao tenta de novo em laco
     and not exists (select 1 from ia_followup fu where fu.conversa_id = x.id and fu.estado = 'falhou' and fu.criado_em > now() - interval '3 hours')
     -- uma pessoa da loja escreveu nas ultimas 12 horas: a conversa e dela
     and not exists (select 1 from wa_mensagem h where h.conversa_id = x.id and h.eco
                      and h.quando > greatest(now() - interval '12 hours', case when x.ia_modo = 'ligada' then x.ia_ligada_em else '-infinity'::timestamptz end)
                      and not ia_e_da_flavia(h.wa_id))
     -- a Flavia encerrou (ja vendeu, nao quer, pediu para parar)
     and not exists (select 1 from ia_resposta r where r.conversa_id = x.id and r.encerrar and r.criado_em > now() - interval '60 days')
     -- o cliente disse que nao quer, que ja vendeu ou pediu para parar, nesta conversa
     and not exists (select 1 from wa_mensagem m where m.conversa_id = x.id and not m.eco and m.quando > now() - interval '30 days'
                      and m.texto ~* '(j. vend|vendi o|vendido|n.o tenho (mais )?interesse|sem interesse|n.o quero|desist|para de mand|pare de|n.o me mand|n.o mande|bloque|me tir|me remov|n.o preciso mais)')
     -- lead que ja tem destino (agendado, veio, faltou, perdido) ou que nao e para chamar
     and not exists (select 1 from lead l
                      where l.franquia_id = x.franquia_id
                        and right(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g'), 8) = right(regexp_replace(x.telefone, '\D', '', 'g'), 8)
                        and (l.status in ('agendado', 'confirmado', 'compareceu', 'nao_compareceu', 'perdido')
                             or l.excluido_em is not null or coalesce(l.fora_regiao, false)))
     -- esteve na loja
     and not exists (select 1 from atendimento a
                      where a.franquia_id = x.franquia_id and a.criado_em > now() - interval '30 days'
                        and right(regexp_replace(coalesce(a.cliente_telefone, ''), '\D', '', 'g'), 8) = right(regexp_replace(x.telefone, '\D', '', 'g'), 8))
     -- lembrete ou retomada para o mesmo telefone ha pouco: um fluxo de cada vez
     and not exists (select 1 from ia_lembrete lb where lb.criado_em > now() - interval '20 hours'
                      and right(regexp_replace(lb.telefone, '\D', '', 'g'), 8) = right(regexp_replace(x.telefone, '\D', '', 'g'), 8))
     and not exists (select 1 from ia_retomada rt where rt.criado_em > now() - interval '20 hours'
                      and right(regexp_replace(rt.telefone, '\D', '', 'g'), 8) = right(regexp_replace(x.telefone, '\D', '', 'g'), 8))
   order by f.n, x.ultima_de_fora desc
   limit 1;
  return v;
end;
$$;
revoke all on function ia_followup_proximo(text) from public;
grant execute on function ia_followup_proximo(text) to anon, authenticated;

create or replace function ia_followup_gravar(p_segredo text, p_conversa uuid, p_n int, p_canal text, p_telefone text,
  p_mensagens jsonb, p_wa_ids jsonb, p_estado text, p_erro text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  insert into ia_followup (franquia_id, conversa_id, n, canal, telefone, mensagens, wa_ids, estado, erro)
  select x.franquia_id, x.id, p_n, p_canal, p_telefone, p_mensagens, coalesce(p_wa_ids, '[]'::jsonb), p_estado, p_erro
    from wa_conversa x where x.id = p_conversa;
end;
$$;
revoke all on function ia_followup_gravar(text, uuid, int, text, text, jsonb, jsonb, text, text) from public;
grant execute on function ia_followup_gravar(text, uuid, int, text, text, jsonb, jsonb, text, text) to anon, authenticated;

-- As funcoes que reconhecem a mensagem da Flavia (a fila, o estado da
-- conversa e o "agendado por") passam a reconhecer o follow-up - sem isso
-- ele pareceria uma pessoa assumindo e a Flavia nao responderia quando o
-- cliente voltasse. Reescritas a partir do corpo que esta no banco, como
-- na 0177.
do $$
declare
  f record; d text; n text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prokind = 'f' and p.proname in ('ia_fila', 'ia_estado_conversa', 'wa_lead_avanca')
              and pg_get_functiondef(p.oid) ~ 'ia_lembrete lb where lb.wa_ids' loop
    d := pg_get_functiondef(f.oid);
    if d ~ 'ia_followup' then continue; end if;
    n := replace(d, 'select 1 from ia_lembrete lb where lb.wa_ids ? h.wa_id)',
                    'select 1 from ia_lembrete lb where lb.wa_ids ? h.wa_id) and not exists (select 1 from ia_followup fu where fu.wa_ids ? h.wa_id)');
    n := replace(n, 'select 1 from ia_lembrete lb where lb.wa_ids ? c.msg_wa_id)',
                    'select 1 from ia_lembrete lb where lb.wa_ids ? c.msg_wa_id) or exists (select 1 from ia_followup fu where fu.wa_ids ? c.msg_wa_id)');
    if n = d then raise exception 'nao achei o trecho em %', f.proname; end if;
    execute n;
  end loop;
end $$;
