-- =====================================================================
-- 0177 - Os lembretes do agendado: vespera e dia
--
-- A Schell, em 25/11/2026: "percebi que a Flavia nao esta fazendo
-- confirmacao de agendamento e esta tendo muita falta... tiramos a Ana e
-- nosso fluxo caiu muito". A Ana (Intermedicar) mandava o lembrete da
-- vespera e o do dia; a instrucao da Flavia diz ao cliente que eles "sao
-- automaticos" (decisao 60), e eles nunca existiram aqui.
--
-- O cron do ERP (ia/atender.js, `lembrar`) pergunta a cada volta pelo
-- proximo lembrete devido. Quem decide e esta funcao, no banco:
--   * vespera: o horario e amanha, o lead ainda nao confirmou, das 9h
--     as 19h30;
--   * dia: o horario e hoje, faltam ao menos 50 minutos, das 8h em diante;
--   * nunca para quem foi agendado ha menos de 2 horas (acabou de marcar);
--   * so pelo numero em que o cliente ja conversa (a conversa mais
--     recente com o mesmo DDD + oito ultimos, num numero comercial ativo
--     da mesma franquia) - sem conversa, nao se abre uma;
--   * nao no meio de uma conversa: nada se a loja mandou mensagem ali na
--     ultima hora;
--   * cada lembrete uma vez por horario (ia_lembrete, unico em lead +
--     tipo + horario: remarcou, vale o horario novo);
--   * um a cada ~1 minuto, para nao parecer rajada.
-- O interruptor e `config_loja.ia_lembrete` (ligado por padrao).
--
-- Os ids do que foi mandado ficam em ia_lembrete.wa_ids, e as tres
-- funcoes que separam a mensagem da Flavia da de uma PESSOA (ia_fila,
-- ia_estado_conversa, wa_lead_avanca) passam a olhar esta tabela tambem:
-- sem isso, o lembrete pareceria uma pessoa assumindo a conversa, e a
-- Flavia nao responderia o "confirmo" do cliente por 12 horas.
-- =====================================================================

alter table config_loja add column if not exists ia_lembrete boolean not null default true;

create table if not exists ia_lembrete (
  id          uuid primary key default gen_random_uuid(),
  franquia_id uuid not null default '00000000-0000-0000-0000-000000000001' references franquia(id),
  lead_id     uuid not null references lead(id) on delete cascade,
  tipo        text not null check (tipo in ('vespera', 'dia')),
  horario     timestamp not null,
  canal       text not null,
  telefone    text not null,
  mensagens   jsonb,
  wa_ids      jsonb not null default '[]'::jsonb,
  estado      text not null check (estado in ('enviada', 'falhou')),
  erro        text,
  criado_em   timestamptz not null default now(),
  unique (lead_id, tipo, horario)
);
create index if not exists ia_lembrete_quando on ia_lembrete (criado_em desc);
alter table ia_lembrete enable row level security;
drop policy if exists ia_lembrete_le on ia_lembrete;
create policy ia_lembrete_le on ia_lembrete for select to authenticated using (e_equipe());
drop policy if exists franquia_isola on ia_lembrete;
create policy franquia_isola on ia_lembrete as restrictive for all to authenticated
  using (franquia_id = (select coalesce(nullif(auth.jwt() ->> 'franquia_id', '')::uuid, minha_franquia())))
  with check (franquia_id = (select coalesce(nullif(auth.jwt() ->> 'franquia_id', '')::uuid, minha_franquia())));

create or replace function ia_lembrete_proximo(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_ultima timestamptz;
  v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  if v_agora::time < '08:00' or v_agora::time >= '20:00' then return null; end if;
  select max(criado_em) into v_ultima from ia_lembrete;
  if v_ultima is not null and v_ultima > now() - make_interval(secs => 50 + (extract(minute from now())::int % 3) * 15) then return null; end if;

  with cand as (
    select l.id, l.nome, l.telefone, l.carro, l.status, l.franquia_id,
           (l.agendado_para at time zone 'UTC') as hora,
           case when (l.agendado_para at time zone 'UTC')::date = v_agora::date then 'dia' else 'vespera' end as tipo
      from lead l
     where l.status in ('agendado', 'confirmado') and l.excluido_em is null and l.agendado_para is not null
       and (l.agendado_para at time zone 'UTC')::date between v_agora::date and v_agora::date + 1
       and length(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g')) >= 10
       and (l.agendado_em is null or l.agendado_em < now() - interval '2 hours')
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
         -- Numero vivo: recebeu mensagem nas ultimas 6 horas (o banco nao guarda se a ponte esta conectada).
         and exists (select 1 from wa_conversa y where y.canal_id = k.id and y.ultima_em > now() - interval '6 hours')
         and right(regexp_replace(x.telefone, '\D', '', 'g'), 8) = right(regexp_replace(c.telefone, '\D', '', 'g'), 8)
       order by x.ultima_em desc nulls last limit 1
    ) cv
   where coalesce((select cl.ia_lembrete from config_loja cl where cl.franquia_id = c.franquia_id limit 1), true)
     and ((c.tipo = 'dia' and c.hora - v_agora >= interval '50 minutes')
          or (c.tipo = 'vespera' and c.status = 'agendado' and v_agora::time >= '09:00' and v_agora::time < '19:30'))
     and not exists (select 1 from ia_lembrete lb where lb.lead_id = c.id and lb.tipo = c.tipo and lb.horario = c.hora)
     and not exists (select 1 from wa_mensagem m where m.conversa_id = cv.id and m.eco and m.quando > now() - interval '60 minutes')
   order by c.hora
   limit 1;
  return v;
end;
$$;
revoke all on function ia_lembrete_proximo(text) from public;
grant execute on function ia_lembrete_proximo(text) to anon, authenticated;

create or replace function ia_lembrete_gravar(p_segredo text, p_lead uuid, p_tipo text, p_horario timestamp, p_canal text,
  p_telefone text, p_mensagens jsonb, p_wa_ids jsonb, p_estado text, p_erro text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissao' using errcode = '42501'; end if;
  insert into ia_lembrete (franquia_id, lead_id, tipo, horario, canal, telefone, mensagens, wa_ids, estado, erro)
  select l.franquia_id, l.id, p_tipo, p_horario, p_canal, p_telefone, p_mensagens, coalesce(p_wa_ids, '[]'::jsonb), p_estado, p_erro
    from lead l where l.id = p_lead
  on conflict (lead_id, tipo, horario) do nothing;
end;
$$;
revoke all on function ia_lembrete_gravar(text, uuid, text, timestamp, text, text, jsonb, jsonb, text, text) from public;
grant execute on function ia_lembrete_gravar(text, uuid, text, timestamp, text, text, jsonb, jsonb, text, text) to anon, authenticated;

-- As tres funcoes que reconhecem a mensagem da Flavia passam a reconhecer
-- o lembrete. Reescritas a partir do corpo que esta no banco (decisao 79:
-- o banco pode estar mais novo que o repositorio).
do $$
declare
  f record; d text; n text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'public' and p.prokind = 'f' and p.proname in ('ia_fila', 'ia_estado_conversa', 'wa_lead_avanca')
              and pg_get_functiondef(p.oid) ~ 'ia_retomada' loop
    d := pg_get_functiondef(f.oid);
    if d ~ 'ia_lembrete' then continue; end if;
    n := replace(d, 'select 1 from ia_retomada rt where rt.wa_ids ? h.wa_id)',
                    'select 1 from ia_retomada rt where rt.wa_ids ? h.wa_id) and not exists (select 1 from ia_lembrete lb where lb.wa_ids ? h.wa_id)');
    n := replace(n, 'select 1 from ia_retomada r where r.wa_ids ? c.msg_wa_id)',
                    'select 1 from ia_retomada r where r.wa_ids ? c.msg_wa_id) or exists (select 1 from ia_lembrete lb where lb.wa_ids ? c.msg_wa_id)');
    if n = d then raise exception 'nao achei o trecho em %', f.proname; end if;
    execute n;
  end loop;
end $$;
