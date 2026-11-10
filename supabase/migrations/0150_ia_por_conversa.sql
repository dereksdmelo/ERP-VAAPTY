-- 0150 · Ligar e desligar a IA NAQUELA conversa, e ver se está ligada (10/11/2026, o Derek). Até aqui o
-- interruptor era só do número (wa_canal.ia_responde) e a Flávia saía sozinha por 12 horas quando uma pessoa
-- respondia (decisão 64) — sem a tela dizer nada disso.
--   ia_modo nulo        segue o número (o de sempre);
--   ia_modo 'desligada' a Flávia não responde esta conversa, até alguém ligar de novo;
--   ia_modo 'ligada'    responde mesmo que uma pessoa tenha escrito antes: o "assumiu a conversa" só conta
--                       depois de `ia_ligada_em`. O número continua mandando — sem a IA no número, não há IA.
alter table wa_conversa add column if not exists ia_modo text check (ia_modo in ('ligada', 'desligada'));
alter table wa_conversa add column if not exists ia_ligada_em timestamptz;

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
     and coalesce(cv.ia_modo, '') <> 'desligada'
     and cv.ultima_em >= now() - interval '12 hours'
     and not ult.eco
     and ult.quando >= greatest(ca.ia_desde, now() - interval '12 hours')
     and ult.quando <= now() - interval '40 seconds'
     and not exists (select 1 from ia_resposta r where r.mensagem_id = ult.id)
     and not exists (
       select 1 from wa_mensagem h
        where h.conversa_id = cv.id and h.eco
          and h.quando >= greatest(now() - interval '12 hours', case when cv.ia_modo = 'ligada' then cv.ia_ligada_em else '-infinity'::timestamptz end)
          and not exists (select 1 from ia_resposta r2 where r2.conversa_id = cv.id and r2.wa_ids ? h.wa_id)
          and not exists (select 1 from ia_retomada rt where rt.wa_ids ? h.wa_id))
     and (select count(*) from ia_resposta r3 where r3.conversa_id = cv.id and r3.criado_em >= now() - interval '24 hours') < 20
   order by ult.quando
   limit 5;
end;
$$;
revoke all on function ia_fila(text) from public;
grant execute on function ia_fila(text) to anon, authenticated;

-- O que a tela mostra: a IA está respondendo esta conversa? E se não, por quê. Da equipe (quem lê a conversa).
create or replace function ia_estado_conversa(p_conversa uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cv wa_conversa%rowtype; ca wa_canal%rowtype; humano timestamptz;
begin
  if not e_equipe() then raise exception 'sem acesso' using errcode = '42501'; end if;
  select * into cv from wa_conversa where id = p_conversa;
  if cv.id is null then return null; end if;
  select * into ca from wa_canal where id = cv.canal_id;
  if cv.grupo then return jsonb_build_object('estado', 'grupo'); end if;
  if not (ca.ativo and ca.ia_responde and ca.ia_desde is not null) then
    return jsonb_build_object('estado', 'numero_sem_ia', 'modo', cv.ia_modo);
  end if;
  if cv.ia_modo = 'desligada' then return jsonb_build_object('estado', 'desligada', 'modo', cv.ia_modo); end if;
  select max(h.quando) into humano from wa_mensagem h
   where h.conversa_id = cv.id and h.eco
     and h.quando >= greatest(now() - interval '12 hours', case when cv.ia_modo = 'ligada' then cv.ia_ligada_em else '-infinity'::timestamptz end)
     and not exists (select 1 from ia_resposta r2 where r2.conversa_id = cv.id and r2.wa_ids ? h.wa_id)
     and not exists (select 1 from ia_retomada rt where rt.wa_ids ? h.wa_id);
  if humano is not null then
    return jsonb_build_object('estado', 'pausada', 'modo', cv.ia_modo, 'ate', humano + interval '12 hours');
  end if;
  return jsonb_build_object('estado', 'ligada', 'modo', cv.ia_modo);
end $$;
revoke all on function ia_estado_conversa(uuid) from public, anon;
grant execute on function ia_estado_conversa(uuid) to authenticated;

insert into schema_migrations(arquivo) values ('0150_ia_por_conversa.sql') on conflict do nothing;
