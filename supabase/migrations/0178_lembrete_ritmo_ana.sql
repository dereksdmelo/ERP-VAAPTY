-- =====================================================================
-- 0178 - Os lembretes no ritmo da Ana
--
-- O Derek, em 25/11/2026: "observe os padroes que estavam tendo nas
-- conversas com a Ana e aplique no atendimento e confirmacao da Flavia".
-- Lido no numero da Ana, de 01 a 23/11/2026 (3.147 mensagens dela):
--   * "Aguardo confirmacao ... amanha" sai 24 horas antes do horario
--     (as 13h da vespera para quem vem as 13h); quem marcou com menos de
--     24 h recebe umas 2 h depois de marcar (78 vezes);
--   * "Aguardo confirmacao ... hoje" sai 2 h antes do horario da manha
--     (7h para quem vem as 9h) e 3 h antes do da tarde (10h para as 13h)
--     (90 vezes);
--   * "Passando pra lembrar ... daqui a pouquinho" sai 48 a 60 minutos
--     antes (97 vezes).
-- Os agendados pela Ana vieram 98 de 196 vezes (50%); pela Camila, 47 de
-- 115 (41%).
--
-- Muda o `ia_lembrete_proximo` da 0177: tres tipos (vespera, dia, antes),
-- nesses momentos; nao manda quando o cliente acabou de dizer que nao vem
-- ou quer remarcar; a "loja falando ali" nao conta os proprios lembretes.
-- =====================================================================

alter table ia_lembrete drop constraint if exists ia_lembrete_tipo_check;
alter table ia_lembrete add constraint ia_lembrete_tipo_check check (tipo in ('vespera', 'dia', 'antes'));

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
    select l.id, l.nome, l.telefone, l.carro, l.status, l.franquia_id, l.agendado_em,
           (l.agendado_para at time zone 'UTC') as hora
      from lead l
     where l.status in ('agendado', 'confirmado') and l.excluido_em is null and l.agendado_para is not null
       and (l.agendado_para at time zone 'UTC') > v_agora
       and (l.agendado_para at time zone 'UTC')::date between v_agora::date and v_agora::date + 1
       and length(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g')) >= 10
  ), cand as (
    select b.*,
           case when b.hora::date > v_agora::date then 'vespera'
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
       where k.ativo and k.comercial and k.telefone is not null and k.franquia_id = c.franquia_id
         and not x.grupo
         and exists (select 1 from wa_conversa y where y.canal_id = k.id and y.ultima_em > now() - interval '6 hours')
         and right(regexp_replace(x.telefone, '\D', '', 'g'), 8) = right(regexp_replace(c.telefone, '\D', '', 'g'), 8)
       order by x.ultima_em desc nulls last limit 1
    ) cv
   where coalesce((select cl.ia_lembrete from config_loja cl where cl.franquia_id = c.franquia_id limit 1), true)
     and (
       -- Vespera: 24 h antes, ou 2 h depois de marcar; ainda nao confirmado; ate 20h45.
       (c.tipo = 'vespera' and c.status = 'agendado' and v_agora >= c.hora - interval '24 hours'
          and v_agora::time >= '08:00' and (c.agendado_em is null or c.agendado_em < now() - interval '2 hours'))
       -- Dia: 2 h antes ate 11h30, 3 h antes depois disso; com ao menos 70 minutos de folga.
       or (c.tipo = 'dia' and c.hora - v_agora <= case when c.hora::time <= '11:30' then interval '2 hours' else interval '3 hours' end
          and c.hora - v_agora >= interval '70 minutes'
          and (c.agendado_em is null or c.agendado_em < now() - interval '30 minutes'))
       -- Pouco antes: de 60 a 25 minutos antes.
       or (c.tipo = 'antes' and c.hora - v_agora >= interval '25 minutes'
          and (c.agendado_em is null or c.agendado_em < now() - interval '30 minutes'))
     )
     and not exists (select 1 from ia_lembrete lb where lb.lead_id = c.id and lb.tipo = c.tipo and lb.horario = c.hora)
     -- Ninguem da loja falando ali na ultima meia hora (os lembretes nao contam).
     and not exists (select 1 from wa_mensagem m where m.conversa_id = cv.id and m.eco and m.quando > now() - interval '30 minutes'
                      and not exists (select 1 from ia_lembrete lb2 where lb2.wa_ids ? m.wa_id))
     -- O cliente acabou de dizer que nao vem ou quer remarcar: a fila da Flavia cuida, sem lembrete por cima.
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
