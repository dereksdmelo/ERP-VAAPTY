-- =====================================================================
-- 0123 — A agenda da semana na tela da sala (08/11/2026)
--
-- O Derek: "opção de marcar agenda da semana também na tela". Função à
-- parte da `tv_painel` (0121), pela mesma chave: os agendamentos de
-- segunda a sábado desta semana — dia, hora, carro, estado e quem agendou.
-- O NOME do cliente não vai: a TV fica na sala e a promessa da tela é
-- "nenhum dado de cliente".
-- =====================================================================

create or replace function tv_agenda(p_token text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  cfg painel_tv;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  -- No domingo a loja está fechada: a semana que importa é a que começa amanhã.
  seg date := case when extract(isodow from hoje) = 7 then hoje + 1 else hoje - ((extract(isodow from hoje)::int) - 1) end;
  v jsonb;
begin
  select * into cfg from painel_tv where id = 1;
  if cfg.token is null or p_token is null or length(p_token) < 20 or cfg.token <> p_token then
    raise exception 'link da tela inválido' using errcode = '42501';
  end if;
  select jsonb_build_object('hoje', hoje, 'segunda', seg,
    'itens', coalesce(jsonb_agg(jsonb_build_object(
        'dia', (l.agendado_para at time zone 'UTC')::date,
        'hora', to_char(l.agendado_para at time zone 'UTC', 'HH24:MI'),
        'carro', coalesce(nullif(l.carro, ''), ''),
        'status', l.status,
        'origem', l.origem,
        'agendou', coalesce(l.agendado_por_nome, ''))
      order by l.agendado_para), '[]'::jsonb))
    into v
    from lead l
   where l.agendado_para is not null and l.excluido_em is null
     and l.status in ('agendado', 'confirmado', 'compareceu', 'nao_compareceu')
     and (l.agendado_para at time zone 'UTC')::date between seg and seg + 5;
  return v;
end;
$$;
revoke all on function tv_agenda(text) from public;
grant execute on function tv_agenda(text) to anon, authenticated;
