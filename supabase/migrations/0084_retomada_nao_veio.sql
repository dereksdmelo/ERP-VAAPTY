-- =====================================================================
-- 0084 — A Flávia procura quem não veio
--
-- O Derek, em 28/10/2026, depois de ver 67 "não veio" e só dois
-- remarcados: *"podemos fazer um teste com a Flávia, fazendo ela
-- contatar todos os 'não veio' pelo número da prospecção ativa,
-- tentando conversar com eles pra eles reagendarem"*, com a abertura
-- dele: "Oii fulano, tudo bem? Aqui é a Flávia da Vaapty. Você tinha um
-- horário agendado com a gente às xx horas. Aconteceu alguma coisa que
-- você não conseguiu vir? Está tudo bem?".
--
-- É a primeira vez que a Flávia escreve PRIMEIRO. Mensagem que sai sem
-- o cliente ter escrito é o que o WhatsApp mais pune num número ligado
-- por QR, então o ritmo é de gente e tem teto: uma a cada 4 a 7 minutos,
-- só de segunda a sábado das 9h às 18h, no máximo 20 por dia, e cada
-- lead UMA vez só (`ia_retomada.lead_id` único).
--
-- Quem é procurado: lead em "não veio" (horário perdido guardado nos
-- últimos 30 dias, 23/10 em diante, e passado há 3 horas), com telefone,
-- sem atendimento aberto depois (aí ele veio), fora da região não
-- marcado, sem conversa ATIVA em outro número nas últimas 24 horas (a
-- Ana ou a Camila podem estar no meio da mesma retomada) e sem ter dito
-- que já vendeu.
-- =====================================================================

alter table wa_canal add column if not exists ia_retoma boolean not null default false;

create table if not exists ia_retomada (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null unique references lead(id) on delete cascade,
  canal       text not null,
  telefone    text not null,
  mensagens   jsonb,
  wa_ids      jsonb not null default '[]'::jsonb,
  estado      text not null check (estado in ('enviada', 'falhou')),
  erro        text,
  criado_em   timestamptz not null default now()
);
create index if not exists ia_retomada_quando on ia_retomada (criado_em desc);
alter table ia_retomada enable row level security;
drop policy if exists ia_retomada_le on ia_retomada;
create policy ia_retomada_le on ia_retomada for select to authenticated using (e_equipe());

/* O próximo a procurar, ou nada. As travas de ritmo moram aqui, no
 * banco, e não no cron: duas voltas do cron que se cruzem leem a mesma
 * regra. Devolve a abertura já com o que ela precisa dizer. */
create or replace function ia_retomada_proximo(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_canal text;
  v_ultima timestamptz;
  v_hoje int;
  v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select slug into v_canal from wa_canal where ia_retoma and ativo and telefone is not null order by slug limit 1;
  if v_canal is null then return null; end if;
  -- Segunda a sábado, 9h às 18h, em Joinville.
  if extract(isodow from v_agora) = 7 or v_agora::time < '09:00' or v_agora::time >= '18:00' then return null; end if;
  select max(criado_em), count(*) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = v_agora::date)
    into v_ultima, v_hoje from ia_retomada;
  if v_hoje >= 20 then return null; end if;
  -- 4 minutos e um pedaço que muda a cada volta: intervalo de gente.
  if v_ultima is not null and v_ultima > now() - make_interval(secs => 240 + (extract(minute from now())::int % 4) * 45) then return null; end if;

  select jsonb_build_object('lead_id', l.id, 'nome', l.nome, 'telefone', l.telefone, 'carro', l.carro,
                            'horario', f.horario, 'canal', v_canal)
    into v
    from lead l
    cross join lateral (
      select (r->>'de') as horario, (r->>'em')::timestamptz as em
        from jsonb_array_elements(coalesce(l.remarcacoes, '[]'::jsonb)) r
       where (r->>'nao_veio') = 'true' order by (r->>'em') desc limit 1
    ) f
   where l.status = 'nao_compareceu' and l.excluido_em is null
     and coalesce(l.fora_regiao, false) = false
     and length(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g')) >= 10
     and f.em >= now() - interval '30 days'
     and not exists (select 1 from ia_retomada rt where rt.lead_id = l.id)
     -- Atrasado ainda pode chegar: só depois de 3 horas do horário.
     and left(f.horario, 19)::timestamp < v_agora - interval '3 hours'
     -- Quem teve atendimento aberto no dia do horário ou depois VEIO —
     -- foi marcado "não veio" por engano (o Mauro, 28/10, estava a
     -- caminho). Perguntar "o que aconteceu?" a quem veio é o pior erro.
     and not exists (
       select 1 from atendimento a
        where right(regexp_replace(coalesce(a.cliente_telefone, ''), '\D', '', 'g'), 8) = right(regexp_replace(l.telefone, '\D', '', 'g'), 8)
          and a.data >= left(f.horario, 10)::date)
     and not exists (
       select 1 from wa_conversa c join wa_mensagem m on m.conversa_id = c.id
        where right(regexp_replace(c.telefone, '\D', '', 'g'), 8) = right(regexp_replace(l.telefone, '\D', '', 'g'), 8)
          and ((not m.eco and m.quando > now() - interval '24 hours')
               or (m.quando > now() - interval '30 days'
                   and m.texto ~* '(j[aá] vendi|vendi o carro|vendi ele|j[aá] foi vendido|parab[eé]ns pela venda|n[aã]o tenho mais o carro)')))
   order by f.em desc
   limit 1;
  return v;
end;
$$;
revoke all on function ia_retomada_proximo(text) from public;
grant execute on function ia_retomada_proximo(text) to anon, authenticated;

create or replace function ia_retomada_gravar(p_segredo text, p_lead uuid, p_canal text, p_telefone text,
                                              p_mensagens jsonb, p_wa_ids jsonb, p_estado text, p_erro text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into ia_retomada (lead_id, canal, telefone, mensagens, wa_ids, estado, erro)
  values (p_lead, p_canal, p_telefone, p_mensagens, coalesce(p_wa_ids, '[]'::jsonb), p_estado, left(p_erro, 500))
  on conflict (lead_id) do nothing;
end;
$$;
revoke all on function ia_retomada_gravar(text, uuid, text, text, jsonb, jsonb, text, text) from public;
grant execute on function ia_retomada_gravar(text, uuid, text, text, jsonb, jsonb, text, text) to anon, authenticated;

-- A conversa da retomada, para a Flávia saber o que está retomando.
create or replace function ia_retomada_da_conversa(p_segredo text, p_conversa uuid)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_build_object('nome', l.nome, 'carro', l.carro, 'status', l.status,
           'horario', (select (r->>'de') from jsonb_array_elements(coalesce(l.remarcacoes, '[]'::jsonb)) r
                        where (r->>'nao_veio') = 'true' order by (r->>'em') desc limit 1))
    into v
    from wa_conversa c join wa_canal ca on ca.id = c.canal_id
    join ia_retomada rt on rt.canal = ca.slug
     and right(regexp_replace(rt.telefone, '\D', '', 'g'), 8) = right(regexp_replace(c.telefone, '\D', '', 'g'), 8)
    join lead l on l.id = rt.lead_id
   where c.id = p_conversa
   limit 1;
  return v;
end;
$$;
revoke all on function ia_retomada_da_conversa(text, uuid) from public;
grant execute on function ia_retomada_da_conversa(text, uuid) to anon, authenticated;

-- A FILA da 0075, com a retomada contada como mensagem da Flávia.
create or replace function ia_fila(p_segredo text)
returns table (conversa_id uuid, mensagem_id uuid, canal text, telefone text)
language plpgsql security definer set search_path = public stable as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
  select cv.id, ult.id, ca.slug, cv.telefone
    from wa_conversa cv
    join wa_canal ca on ca.id = cv.canal_id
    cross join lateral (
      select m.id, m.eco, m.quando from wa_mensagem m
       where m.conversa_id = cv.id and m.tipo <> 'reacao'
       order by m.quando desc limit 1
    ) ult
   where ca.ativo and ca.ia_responde and ca.ia_desde is not null
     and cv.ultima_em >= now() - interval '12 hours'
     and not ult.eco
     and ult.quando >= greatest(ca.ia_desde, now() - interval '12 hours')
     and ult.quando <= now() - interval '40 seconds'
     and not exists (select 1 from ia_resposta r where r.mensagem_id = ult.id)
     and not exists (
       select 1 from wa_mensagem h
        where h.conversa_id = cv.id and h.eco and h.quando >= now() - interval '12 hours'
          and not exists (select 1 from ia_resposta r2 where r2.conversa_id = cv.id and r2.wa_ids ? h.wa_id)
          -- A primeira mensagem da retomada (0084) também é da Flávia, não
          -- de uma pessoa: sem isto, a resposta do cliente nunca seria
          -- respondida, porque a conversa pareceria assumida.
          and not exists (select 1 from ia_retomada rt where rt.wa_ids ? h.wa_id))
     and (select count(*) from ia_resposta r3 where r3.conversa_id = cv.id and r3.criado_em >= now() - interval '24 hours') < 20
   order by ult.quando
   limit 5;
end;
$$;
revoke all on function ia_fila(text) from public;
grant execute on function ia_fila(text) to anon, authenticated;