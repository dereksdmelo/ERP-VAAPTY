-- 0136 · A agenda da TV com o estado de cada horário (08/11/2026, o Derek: "queria que aparecesse
-- todos os agendamentos, nem que diminuísse um pouco… e as corzinhas da agenda também: confirmado,
-- cancelado, veio, fechado, remarcado").
--
-- Os mesmos estados da Agenda da pré-venda (`ESTADO_AGENDA`): agendado, confirmou, passou da hora
-- ("veio?"), veio, fechou (o atendimento fechou), não veio, remarcou (o horário antigo, que fica em
-- `remarcacoes`) e cancelou (lead perdido com hora marcada). Continua sem o nome do cliente.
create or replace function tv_agenda(p_token text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  cfg painel_tv;
  agora timestamp := (now() at time zone 'America/Sao_Paulo');
  hoje date := agora::date;
  seg date := case when extract(isodow from hoje) = 7 then hoje + 1 else hoje - ((extract(isodow from hoje)::int) - 1) end;
  v jsonb;
begin
  select * into cfg from painel_tv where id = 1;
  if cfg.token is null or p_token is null or length(p_token) < 20 or cfg.token <> p_token then
    raise exception 'link da tela inválido' using errcode = '42501';
  end if;
  with atuais as (
    select (l.agendado_para at time zone 'UTC') as quando, coalesce(nullif(l.carro, ''), '') as carro,
           coalesce(l.agendado_por_nome, '') as agendou,
           case
             when l.status = 'perdido' then 'cancelou'
             when a.status = 'fechado' then 'fechou'
             when l.status = 'compareceu' or l.atendimento_id is not null then 'veio'
             when l.status = 'nao_compareceu' then 'naoVeio'
             when (l.agendado_para at time zone 'UTC') < agora then 'passou'
             when l.status = 'confirmado' then 'confirmado'
             else 'agendado' end as estado
      from lead l
      left join atendimento a on a.id = l.atendimento_id
     where l.agendado_para is not null and l.excluido_em is null
       and l.status in ('agendado', 'confirmado', 'compareceu', 'nao_compareceu', 'perdido')
       and (l.agendado_para at time zone 'UTC')::date between seg and seg + 5),
  antigos as (
    -- O horário que saiu da agenda: o que faltou ou foi trocado por outro. Fica no lugar dele.
    select ((r->>'de')::timestamptz at time zone 'UTC') as quando, coalesce(nullif(l.carro, ''), '') as carro,
           coalesce(l.agendado_por_nome, '') as agendou,
           case when (r->>'nao_veio')::boolean is true
                 and not (l.agendado_para is not null and l.agendado_para > (r->>'de')::timestamptz) then 'naoVeio'
                else 'remarcou' end as estado
      from lead l, jsonb_array_elements(case when jsonb_typeof(l.remarcacoes) = 'array' then l.remarcacoes else '[]'::jsonb end) r
     where l.excluido_em is null and r ? 'de'
       and ((r->>'de')::timestamptz at time zone 'UTC')::date between seg and seg + 5
       and not (l.agendado_para is not null and l.agendado_para = (r->>'de')::timestamptz)),
  tudo as (select * from atuais union all select * from antigos)
  select jsonb_build_object('hoje', hoje, 'segunda', seg,
    'itens', coalesce(jsonb_agg(jsonb_build_object(
        'dia', t.quando::date, 'hora', to_char(t.quando, 'HH24:MI'),
        'carro', t.carro, 'estado', t.estado, 'agendou', t.agendou)
      order by t.quando), '[]'::jsonb))
    into v from tudo t;
  return v;
end;
$$;
revoke all on function tv_agenda(text) from public;
grant execute on function tv_agenda(text) to anon, authenticated;
