-- =====================================================================
-- 0076 — A IA lê a conversa do agendado: qual é o carro, e se confirmou
--
-- O Derek, em 23/10/2026, olhando a agenda com "sem carro" em quase
-- todo cartão: *"a IA não está reconhecendo o carro, precisa reconhecer
-- pra colocar automático na agenda… também precisa reconhecer
-- automático se já confirmou ou não"*.
--
-- O carro e a confirmação estão na conversa — a Ana, a Camila e a
-- Flávia perguntam o modelo, e o cliente responde ao lembrete da
-- véspera —, mas o leitor de agendamento da 0059 só procura DATA e
-- HORA, e por expressão. Modelo de carro em texto livre ("um gol
-- bola 2010 prata", "tenho uma Saveiro") e "pode deixar, tô indo" não
-- se pegam por expressão sem errar para os dois lados.
--
-- O cron do ERP (decisão 65) relê, a cada cinco minutos, só o lead
-- agendado cuja conversa teve mensagem DEPOIS da última leitura
-- (`ia_lido_em`): conversa parada não paga leitura de novo.
--
-- Mesmas funções estreitas da 0075, com o `IA_SEGREDO`.
-- =====================================================================

alter table lead add column if not exists ia_lido_em timestamptz;

/* Os leads a ler, já com a conversa. Agendado ou confirmado, de uma
 * semana para trás em diante (é a semana que a agenda mostra), com
 * carro vazio OU ainda sem confirmação — e com mensagem nova desde a
 * última leitura. A conversa é a ligada ao lead ou, sem ligação, a do
 * mesmo telefone (DDD + oito últimos, a chave da decisão 49). */
create or replace function ia_leads_para_ler(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v from (
    select l.id as lead_id, l.status, l.carro, l.agendado_para, cv.id as conversa_id,
           (select jsonb_agg(m order by m.quando) from (
              select mm.eco, mm.tipo, mm.texto, mm.anexo, mm.leitura, mm.quando
                from wa_mensagem mm where mm.conversa_id = cv.id
               order by mm.quando desc limit 60) m) as msgs
      from lead l
      cross join lateral (
        select c.id, c.ultima_em from wa_conversa c
         where c.lead_id = l.id
            or (length(regexp_replace(coalesce(l.telefone, ''), '[^0-9]', '', 'g')) >= 10
                and right(regexp_replace(c.telefone, '[^0-9]', '', 'g'), 8) = right(regexp_replace(l.telefone, '[^0-9]', '', 'g'), 8))
         order by (c.lead_id = l.id) desc, c.ultima_em desc
         limit 1
      ) cv
     where l.status in ('agendado', 'confirmado') and l.excluido_em is null
       and l.agendado_para >= (now() at time zone 'America/Sao_Paulo') - interval '7 days'
       and (coalesce(l.carro, '') = '' or l.status = 'agendado')
       and cv.ultima_em > coalesce(l.ia_lido_em, '-infinity'::timestamptz)
     order by l.agendado_para
     limit 25
  ) x;
  return v;
end;
$$;
revoke all on function ia_leads_para_ler(text) from public;
grant execute on function ia_leads_para_ler(text) to anon, authenticated;

/* O que a leitura achou. O carro só entra onde estava VAZIO: o que
 * alguém digitou no lead não é trocado por palpite de modelo. A
 * confirmação só sobe agendado → confirmado, nunca desce, e só para
 * horário que ainda não passou (12 horas de folga): "confirmado" num
 * agendamento de ontem não diz nada a ninguém. `confirmado_por` fica
 * nulo — é o jeito de saber depois que foi a leitura, e não uma pessoa. */
create or replace function ia_lead_gravar(p_segredo text, p_lead uuid, p_carro text, p_confirmou boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update lead
     set carro = case when coalesce(carro, '') = '' and coalesce(btrim(p_carro), '') <> '' then left(btrim(p_carro), 60) else carro end,
         status = case when p_confirmou and status = 'agendado'
                        and agendado_para >= (now() at time zone 'America/Sao_Paulo') - interval '12 hours'
                       then 'confirmado' else status end,
         confirmado_em = case when p_confirmou and status = 'agendado'
                        and agendado_para >= (now() at time zone 'America/Sao_Paulo') - interval '12 hours'
                       then now() else confirmado_em end,
         ia_lido_em = now(),
         atualizado_em = now()
   where id = p_lead;
end;
$$;
revoke all on function ia_lead_gravar(text, uuid, text, boolean) from public;
grant execute on function ia_lead_gravar(text, uuid, text, boolean) to anon, authenticated;
