-- =====================================================================
-- 0179 - Quem atrasou e chamado no mesmo dia, e a retomada volta
--
-- O Derek, em 25/11/2026: "a Flavia esta chamando os clientes que nao
-- vieram pra remarcar... ou voltar pra loja no mesmo dia mesmo so que
-- atrasados?". Nao estava: a retomada (0084) saia so pelo numero da
-- Prospeccao Ativa, que caiu em 29/10, e desde entao nenhum numero tinha
-- `ia_retoma` ligado - 104 "nao veio" desde 15/11 sem uma mensagem.
--
-- 1. Lembrete novo, `atrasou`: 20 minutos depois do horario, com o lead
--    ainda agendado, sem atendimento aberto hoje para o telefone e sem
--    mensagem do cliente na ultima hora: "estamos te esperando... ainda
--    consegue vir hoje?".
-- 2. A retomada do "nao veio" sai pelo NUMERO EM QUE O CLIENTE JA
--    CONVERSA (como o lembrete), se a Flavia responde nele e o numero tem
--    `ia_retoma`. Cada horario perdido uma vez (era cada lead uma vez na
--    vida). So horarios perdidos de `config_loja.ia_retoma_desde` em
--    diante: os antigos nao sao chamados sem alguem decidir.
--    Quem ja recebeu o `atrasou` so e retomado no dia seguinte.
-- 3. Os lembretes saem so por numero em que a Flavia responde: no da
--    Camila quem responde e a outra IA, que manda os lembretes dela.
-- =====================================================================

alter table config_loja add column if not exists ia_retoma_desde timestamptz not null default now();
alter table ia_retomada add column if not exists horario text;
alter table ia_retomada drop constraint if exists ia_retomada_lead_id_key;
create unique index if not exists ia_retomada_lead_horario on ia_retomada (lead_id, horario);
update wa_canal set ia_retoma = true where ia_responde and comercial and ativo;

alter table ia_lembrete drop constraint if exists ia_lembrete_tipo_check;
alter table ia_lembrete add constraint ia_lembrete_tipo_check check (tipo in ('vespera', 'dia', 'antes', 'atrasou'));

create or replace function ia_lembrete_proximo(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_ultima timestamptz;
  v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  if v_agora::time < '07:00' or v_agora::time >= '20:45' then return null; end if;
  select max(criado_em) into v_ultima from ia_lembrete;
  if v_ultima is not null and v_ultima > now() - make_interval(secs => 45 + (extract(minute from now())::int % 3) * 10) then return null; end if;

  with base as (
    select l.id, l.nome, l.telefone, l.carro, l.status, l.franquia_id, l.agendado_em, l.atendimento_id,
           (l.agendado_para at time zone 'UTC') as hora
      from lead l
     where l.status in ('agendado', 'confirmado') and l.excluido_em is null and l.agendado_para is not null
       and (l.agendado_para at time zone 'UTC') > v_agora - interval '90 minutes'
       and (l.agendado_para at time zone 'UTC')::date between v_agora::date and v_agora::date + 1
       and length(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g')) >= 10
  ), cand as (
    select b.*,
           case when b.hora::date > v_agora::date then 'vespera'
                when b.hora <= v_agora then 'atrasou'
                when b.hora - v_agora <= interval '60 minutes' then 'antes'
                else 'dia' end as tipo
      from base b
  )
  select jsonb_build_object('lead_id', c.id, 'nome', c.nome, 'telefone', cv.telefone, 'carro', c.carro,
                            'status', c.status, 'tipo', c.tipo, 'horario', to_char(c.hora, 'YYYY-MM-DD"T"HH24:MI'),
                            'canal', cv.slug, 'franquia_id', c.franquia_id)
    into v
    from cand c
    cross join lateral (
      select x.id, x.telefone, k.slug
        from wa_conversa x join wa_canal k on k.id = x.canal_id
       where k.ativo and k.comercial and k.ia_responde and k.telefone is not null and k.franquia_id = c.franquia_id
         and not x.grupo
         and exists (select 1 from wa_conversa y where y.canal_id = k.id and y.ultima_em > now() - interval '6 hours')
         and right(regexp_replace(x.telefone, '\D', '', 'g'), 8) = right(regexp_replace(c.telefone, '\D', '', 'g'), 8)
       order by x.ultima_em desc nulls last limit 1
    ) cv
   where coalesce((select cl.ia_lembrete from config_loja cl where cl.franquia_id = c.franquia_id limit 1), true)
     and (
       (c.tipo = 'vespera' and c.status = 'agendado' and v_agora >= c.hora - interval '24 hours'
          and v_agora::time >= '08:00' and (c.agendado_em is null or c.agendado_em < now() - interval '2 hours'))
       or (c.tipo = 'dia' and c.hora - v_agora <= case when c.hora::time <= '11:30' then interval '2 hours' else interval '3 hours' end
          and c.hora - v_agora >= interval '70 minutes'
          and (c.agendado_em is null or c.agendado_em < now() - interval '30 minutes'))
       or (c.tipo = 'antes' and c.hora - v_agora >= interval '25 minutes'
          and (c.agendado_em is null or c.agendado_em < now() - interval '30 minutes'))
       -- Atrasou: 20 minutos depois da hora, ninguem abriu atendimento para ele hoje e ele nao escreveu na ultima hora.
       or (c.tipo = 'atrasou' and v_agora - c.hora >= interval '20 minutes' and c.atendimento_id is null
          and not exists (select 1 from atendimento a
                           where a.data = v_agora::date and a.franquia_id = c.franquia_id
                             and right(regexp_replace(coalesce(a.cliente_telefone, ''), '\D', '', 'g'), 8) = right(regexp_replace(c.telefone, '\D', '', 'g'), 8))
          and not exists (select 1 from wa_mensagem m where m.conversa_id = cv.id and not m.eco and m.quando > now() - interval '60 minutes'))
     )
     and not exists (select 1 from ia_lembrete lb where lb.lead_id = c.id and lb.tipo = c.tipo and lb.horario = c.hora)
     and not exists (select 1 from wa_mensagem m where m.conversa_id = cv.id and m.eco and m.quando > now() - interval '30 minutes'
                      and not exists (select 1 from ia_lembrete lb2 where lb2.wa_ids ? m.wa_id))
     and not exists (
       select 1 from (select m.texto from wa_mensagem m where m.conversa_id = cv.id and not m.eco and m.quando > now() - interval '24 hours'
                       order by m.quando desc limit 1) u
        where u.texto ~* '(n.o vou|n.o consigo|n.o vai dar|n.o posso|remarc|reagend|desmarc|outro dia|cancel)')
   order by c.hora
   limit 1;
  return v;
end;
$$;
revoke all on function ia_lembrete_proximo(text) from public;
grant execute on function ia_lembrete_proximo(text) to anon, authenticated;

create or replace function ia_retomada_proximo(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_ultima timestamptz;
  v_hoje int;
  v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  if extract(isodow from v_agora) = 7 or v_agora::time < '09:00' or v_agora::time >= '18:00' then return null; end if;
  select max(criado_em), count(*) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = v_agora::date)
    into v_ultima, v_hoje from ia_retomada;
  if v_hoje >= 20 then return null; end if;
  if v_ultima is not null and v_ultima > now() - make_interval(secs => 240 + (extract(minute from now())::int % 4) * 45) then return null; end if;

  select jsonb_build_object('lead_id', l.id, 'nome', l.nome, 'telefone', cv.telefone, 'carro', l.carro,
                            'horario', f.horario, 'canal', cv.slug)
    into v
    from lead l
    cross join lateral (
      select (r->>'de') as horario, (r->>'em')::timestamptz as em
        from jsonb_array_elements(coalesce(l.remarcacoes, '[]'::jsonb)) r
       where (r->>'nao_veio') = 'true' order by (r->>'em') desc limit 1
    ) f
    cross join lateral (
      select x.id, x.telefone, k.slug
        from wa_conversa x join wa_canal k on k.id = x.canal_id
       where k.ativo and k.comercial and k.ia_responde and k.ia_retoma and k.telefone is not null and k.franquia_id = l.franquia_id
         and not x.grupo
         and exists (select 1 from wa_conversa y where y.canal_id = k.id and y.ultima_em > now() - interval '6 hours')
         and right(regexp_replace(x.telefone, '\D', '', 'g'), 8) = right(regexp_replace(l.telefone, '\D', '', 'g'), 8)
       order by x.ultima_em desc nulls last limit 1
    ) cv
   where l.status = 'nao_compareceu' and l.excluido_em is null
     and coalesce(l.fora_regiao, false) = false
     and length(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g')) >= 10
     and f.em >= now() - interval '30 days'
     and f.em >= coalesce((select cl.ia_retoma_desde from config_loja cl where cl.franquia_id = l.franquia_id limit 1), now())
     and not exists (select 1 from ia_retomada rt where rt.lead_id = l.id
                      and (rt.horario = f.horario or (rt.horario is null and rt.criado_em >= f.em)))
     and left(f.horario, 19)::timestamp < v_agora - interval '3 hours'
     -- Quem ja recebeu o "estamos te esperando" e chamado de novo so no dia seguinte.
     and (left(f.horario, 10)::date < v_agora::date
          or not exists (select 1 from ia_lembrete lb where lb.lead_id = l.id and lb.tipo = 'atrasou' and lb.horario = left(f.horario, 19)::timestamp))
     and not exists (
       select 1 from atendimento a
        where right(regexp_replace(coalesce(a.cliente_telefone, ''), '\D', '', 'g'), 8) = right(regexp_replace(l.telefone, '\D', '', 'g'), 8)
          and a.data >= left(f.horario, 10)::date)
     and not exists (
       select 1 from wa_conversa c join wa_mensagem m on m.conversa_id = c.id
        where right(regexp_replace(c.telefone, '\D', '', 'g'), 8) = right(regexp_replace(l.telefone, '\D', '', 'g'), 8)
          and ((not m.eco and m.quando > now() - interval '3 hours')
               or (m.quando > now() - interval '30 days'
                   and m.texto ~* '(j. vendi|vendi o carro|vendi ele|j. foi vendido|parab.ns pela venda|n.o tenho mais o carro)')))
   order by f.em desc
   limit 1;
  return v;
end;
$$;
revoke all on function ia_retomada_proximo(text) from public;
grant execute on function ia_retomada_proximo(text) to anon, authenticated;

drop function if exists ia_retomada_gravar(text, uuid, text, text, jsonb, jsonb, text, text);
create or replace function ia_retomada_gravar(p_segredo text, p_lead uuid, p_canal text, p_telefone text,
                                              p_mensagens jsonb, p_wa_ids jsonb, p_estado text, p_erro text, p_horario text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  insert into ia_retomada (franquia_id, lead_id, canal, telefone, mensagens, wa_ids, estado, erro, horario)
  select l.franquia_id, l.id, p_canal, p_telefone, p_mensagens, coalesce(p_wa_ids, '[]'::jsonb), p_estado, left(p_erro, 500), p_horario
    from lead l where l.id = p_lead
  on conflict (lead_id, horario) do nothing;
end;
$$;
revoke all on function ia_retomada_gravar(text, uuid, text, text, jsonb, jsonb, text, text, text) from public;
grant execute on function ia_retomada_gravar(text, uuid, text, text, jsonb, jsonb, text, text, text) to anon, authenticated;

-- A conversa so conta como retomada por 7 dias, e vale a mais recente.
create or replace function ia_retomada_da_conversa(p_segredo text, p_conversa uuid)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  select jsonb_build_object('nome', l.nome, 'carro', l.carro, 'status', l.status,
           'horario', coalesce(rt.horario, (select (r->>'de') from jsonb_array_elements(coalesce(l.remarcacoes, '[]'::jsonb)) r
                        where (r->>'nao_veio') = 'true' order by (r->>'em') desc limit 1)))
    into v
    from wa_conversa c join wa_canal ca on ca.id = c.canal_id
    join ia_retomada rt on rt.canal = ca.slug and rt.criado_em > now() - interval '7 days'
     and right(regexp_replace(rt.telefone, '\D', '', 'g'), 8) = right(regexp_replace(c.telefone, '\D', '', 'g'), 8)
    join lead l on l.id = rt.lead_id
   where c.id = p_conversa
   order by rt.criado_em desc
   limit 1;
  return v;
end;
$$;
revoke all on function ia_retomada_da_conversa(text, uuid) from public;
grant execute on function ia_retomada_da_conversa(text, uuid) to anon, authenticated;
