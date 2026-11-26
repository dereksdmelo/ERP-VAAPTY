-- =====================================================================
-- 0181 - O follow-up comeca mais cedo: 20 min e 2 h
--
-- O Derek, em 26/11/2026, no mesmo dia da 0180: "o primeiro follow up, ao
-- inves de 4-6 hrs depois, pode ter dois adicionais antes: 20 minutos
-- depois e 2 horas depois". O ritmo, contado de quando a loja falou e o
-- cliente parou: 20 min, 2 h, 5 h, e dali em diante de 22 em 22 h, ate
-- `ia_followup_max` (agora 5). Cada um espera tambem um minimo desde o
-- anterior (20 min, 1h30, 3 h, 22 h), para que o silencio que comecou de
-- noite nao vire tres mensagens seguidas de manha. Teto do dia: 150.
-- =====================================================================

alter table config_loja alter column ia_followup_max set default 5;
update config_loja set ia_followup_max = 5 where ia_followup_max = 3;

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
  if v_hoje >= 150 then return null; end if;
  if v_ultima is not null and v_ultima > now() - make_interval(secs => 60 + (extract(minute from now())::int % 4) * 20) then return null; end if;

  select jsonb_build_object('conversa_id', x.id, 'canal', k.slug, 'telefone', x.telefone, 'nome', x.nome,
                            'n', f.n + 1, 'max', coalesce(cl.ia_followup_max, 5),
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
      select min(m.quando) as quando from wa_mensagem m
       where m.conversa_id = x.id and m.eco and m.quando > coalesce(x.ultima_de_fora, '-infinity')
    ) ini
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
     and f.n < coalesce(cl.ia_followup_max, 5)
     -- o ritmo: 20 min, 2 h e 5 h depois de a loja falar; dali em diante de 22 em 22 h
     and now() - ini.quando >= case f.n when 0 then interval '20 minutes' when 1 then interval '2 hours' when 2 then interval '5 hours' else interval '0' end
     and ult.quando <= now() - case f.n when 0 then interval '20 minutes' when 1 then interval '90 minutes' when 2 then interval '3 hours' else interval '22 hours' end
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

