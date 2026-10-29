-- =====================================================================
-- 0098 — Quem agendou o cliente, e como o cliente de fluxo conheceu a loja
--
-- O Derek, em 29/10/2026: "gostaria de saber nos agendamentos, qual a
-- pré-vendas que agendou o cliente. Se foi uma IA, qual IA; se foi uma
-- pessoa, qual a pessoa". E: "se for de fluxo também temos que
-- perguntar qual origem: viu na TV? viu na fachada da loja? ouviu na
-- rádio? viu no Facebook e veio direto? pesquisou no Google? foi
-- indicação?".
--
-- **Quem agendou é carimbo do banco, não campo da tela.** Um gatilho
-- grava `agendado_por_nome` e `agendado_em` toda vez que o horário muda
-- (agendar e remarcar). Com usuário — o agendador da tela, a caixa de
-- Conversas — vale o perfil dele. Sem usuário — a ponte e o cron —,
-- `wa_lead_avanca` diz quem foi pela mensagem que confirmou: o id que a
-- Flávia recebeu ao mandar, o número de IA (Ana, Camila), ou o celular
-- do número, quando alguém digitou direto nele. É o último a marcar o
-- horário que fica; os anteriores estão em `remarcacoes`.
--
-- **A origem do fluxo é uma pergunta à parte da origem.** O cliente de
-- fluxo continua `fluxo_loja` (entrou pela porta, e é assim que o funil
-- o conta); `como_conheceu` guarda por que ele entrou.
-- =====================================================================

alter table lead
  add column if not exists agendado_por      uuid references perfil(id),
  add column if not exists agendado_por_nome text,
  add column if not exists agendado_em       timestamptz;

alter table atendimento
  add column if not exists como_conheceu text;

create or replace function lead_marca_agendou() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if new.agendado_para is not null
     and (tg_op = 'INSERT' or new.agendado_para is distinct from old.agendado_para) then
    new.agendado_em := now();
    v := nullif(current_setting('vaapty.agendou_por', true), '');
    if v is null and auth.uid() is not null then
      new.agendado_por := auth.uid();
      select nome into v from perfil where id = auth.uid();
    elsif v is not null then
      new.agendado_por := null;
    end if;
    if v is not null then new.agendado_por_nome := v; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists lead_marca_agendou on lead;
create trigger lead_marca_agendou before insert or update of agendado_para on lead
  for each row execute function lead_marca_agendou();

drop function if exists wa_lead_avanca(uuid, text, timestamptz, text);

create function wa_lead_avanca(
  p_mensagem uuid,
  p_evento   text,          -- 'respondeu' (chegou do cliente) | 'agendou' | 'nada'
  p_quando   timestamptz,   -- para 'agendou': a data e hora confirmadas
  p_origem   text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c          record;
  v_quem     text;
  v_ia       text;
  v_lead     lead%rowtype;
  v_fone     text;
  v_tem_eco  boolean;
begin
  select cv.*, ca.comercial, ca.nome as canal_nome, ca.atendente as canal_atendente,
         m.wa_id as msg_wa_id
    into c
    from wa_mensagem m
    join wa_conversa cv on cv.id = m.conversa_id
    join wa_canal ca on ca.id = cv.canal_id
   where m.id = p_mensagem;
  if not found then return null; end if;

  -- Numero de operacao nao entra no funil (0058).
  if c.comercial is false then return null; end if;

  -- O telefone do WhatsApp vem com o 55 do pais; o lead guarda sem.
  v_fone := regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g');
  if length(v_fone) > 11 and left(v_fone, 2) = '55' then
    v_fone := substring(v_fone from 3);
  end if;
  if length(v_fone) < 10 then return null; end if;

  if c.lead_id is not null then
    select * into v_lead from lead where id = c.lead_id;
  end if;
  if v_lead.id is null then
    -- Pelo telefone: o lead pode ter nascido pela tela, e criar outro
    -- partiria o historico da mesma pessoa em dois cartoes.
    select * into v_lead from lead
     where regexp_replace(telefone, '\D', '', 'g') like '%' || right(v_fone, 8)
     order by criado_em desc limit 1;
  end if;

  /* **LEAD NOVO E TODA MENSAGEM QUE CHEGA DE NUMERO DESCONHECIDO** num
   * celular comercial -- a regra e do Derek, em 05/10/2026. Por isso a
   * conversa que chega cria o lead sozinha, sem ninguem apertar nada.
   *
   * **Mensagem que SAI, nao.** Escrever para um numero que nunca
   * respondeu e prospeccao, nao lead -- e encheria o quadro de gente
   * que nunca falou com a loja. A excecao e quando a saida ja confirma
   * data e hora: ai e agendamento, e agendamento sem lead nao existe. */
  if v_lead.id is null and p_evento = 'nada' then
    return null;
  end if;

  if v_lead.id is null then
    insert into lead (nome, telefone, origem, status, observacoes)
    values (coalesce(nullif(c.nome, ''), v_fone), v_fone,
            (case when p_origem in (select unnest(enum_range(null::origem_atendimento))::text)
                  then p_origem::origem_atendimento
                  else 'outro'::origem_atendimento end), 'novo',
            'Veio do WhatsApp - ' || coalesce(c.canal_nome, ''))
    returning * into v_lead;
  end if;

  if v_lead.id is null then return null; end if;

  if c.lead_id is distinct from v_lead.id then
    update wa_conversa set lead_id = v_lead.id where id = c.id;
  end if;

  -- **Fechado nao reabre sozinho.** Quem compareceu ou foi marcado
  -- como perdido saiu da fila por decisao de gente; uma mensagem nova
  -- nao pode desfazer isso pelas costas -- e mensagem nova depois da
  -- visita e o caso comum, nao a excecao.
  if v_lead.status in ('compareceu', 'perdido') then
    return v_lead.id;
  end if;

  if p_evento = 'respondeu' then
    -- So depois de NOS falarmos: o cliente que escreve primeiro ainda
    -- e lead novo, nao lead que respondeu.
    select exists (select 1 from wa_mensagem m where m.conversa_id = c.id and m.eco)
      into v_tem_eco;
    if v_tem_eco and v_lead.status = 'novo' then
      update lead set status = 'em_contato', atualizado_em = now() where id = v_lead.id;
    end if;

  elsif p_evento = 'agendou' and p_quando is not null then
    -- Remarcacao entra aqui tambem: a data nova substitui a velha e o
    -- lead volta para AGENDADO, inclusive quem estava em REAGENDAR.
    -- A confirmacao cai porque quem confirmou quarta nao confirmou
    -- sexta (decisao 27).
    if v_lead.agendado_para is distinct from p_quando then
      /* QUEM CONFIRMOU (0098). Com usuario (a caixa de Conversas do
       * ERP), o gatilho usa o perfil dele. Sem usuario (a ponte e o
       * cron), decide a mensagem: id da Flavia -> ela; numero da IA
       * -> a IA daquele numero; o resto saiu do celular do numero. */
      if auth.uid() is null then
        select coalesce(nullif(btrim(ia_nome), ''), 'Flávia') into v_ia from config_loja where id = 1;
        if c.msg_wa_id is not null and (
             exists (select 1 from ia_resposta r where r.wa_ids ? c.msg_wa_id)
          or exists (select 1 from ia_retomada r where r.wa_ids ? c.msg_wa_id)) then
          v_quem := 'IA - ' || coalesce(v_ia, 'Flávia');
        elsif c.canal_atendente = 'ia' then
          v_quem := 'IA - ' || btrim(regexp_replace(coalesce(c.canal_nome, ''), '^\s*IA\s*[-–]?\s*', '', 'i'));
        else
          v_quem := 'Celular · ' || coalesce(c.canal_nome, 'WhatsApp');
        end if;
        perform set_config('vaapty.agendou_por', v_quem, true);
      end if;
      update lead
         set status = 'agendado',
             agendado_para = p_quando,
             confirmado_em = null, confirmado_por = null,
             remarcacoes = case
               when v_lead.agendado_para is null then v_lead.remarcacoes
               else coalesce(v_lead.remarcacoes, '[]'::jsonb) ||
                    jsonb_build_object('de', v_lead.agendado_para, 'em', now(), 'por', 'whatsapp')
             end,
             atualizado_em = now()
       where id = v_lead.id;
    end if;
  end if;

  return v_lead.id;
end;
$$;

revoke all on function wa_lead_avanca(uuid, text, timestamptz, text) from public;
grant execute on function wa_lead_avanca(uuid, text, timestamptz, text) to anon, authenticated;

-- O que já estava agendado: a última mensagem da loja na conversa que
-- cita a hora marcada é quem confirmou. Sem ela, fica em branco — a
-- tela diz "não registrado" em vez de adivinhar.
with alvo as (
  select l.id, l.agendado_para,
         (select m.wa_id || '|' || coalesce(ca.atendente, '') || '|' || coalesce(ca.nome, '')
            from wa_conversa cv
            join wa_canal ca on ca.id = cv.canal_id
            join wa_mensagem m on m.conversa_id = cv.id and m.eco
           where cv.lead_id = l.id
             and m.texto ~ ('(^|\D)0?' || extract(hour from l.agendado_para at time zone 'UTC')::int || '\s*(h|:|horas)')
           order by m.quando desc limit 1) as achado
    from lead l
   where l.agendado_para is not null and l.agendado_por_nome is null
)
update lead l set agendado_por_nome = case
    when exists (select 1 from ia_resposta r where r.wa_ids ? split_part(a.achado, '|', 1))
      or exists (select 1 from ia_retomada r where r.wa_ids ? split_part(a.achado, '|', 1))
      then 'IA - ' || coalesce((select nullif(btrim(ia_nome), '') from config_loja where id = 1), 'Flávia')
    when split_part(a.achado, '|', 2) = 'ia'
      then 'IA - ' || btrim(regexp_replace(split_part(a.achado, '|', 3), '^\s*IA\s*[-–]?\s*', '', 'i'))
    else 'Celular · ' || split_part(a.achado, '|', 3)
  end
  from alvo a
 where a.id = l.id and a.achado is not null;

-- E quem não veio: o horário saiu do lead ao marcar a falta (decisão
-- 51), mas ficou em `remarcacoes` com `nao_veio` — é por ele que se acha
-- a mensagem que confirmou.
with alvo as (
  select l.id,
         (select m.wa_id || '|' || coalesce(ca.atendente, '') || '|' || coalesce(ca.nome, '')
            from wa_conversa cv
            join wa_canal ca on ca.id = cv.canal_id
            join wa_mensagem m on m.conversa_id = cv.id and m.eco
           where cv.lead_id = l.id
             and m.texto ~ ('(^|\D)0?' || extract(hour from (r.x->>'de')::timestamptz at time zone 'UTC')::int || '\s*(h|:|horas)')
           order by m.quando desc limit 1) as achado
    from lead l
    cross join lateral (select x from jsonb_array_elements(l.remarcacoes) x
                         where (x->>'nao_veio')::boolean order by x->>'em' desc limit 1) r
   where l.agendado_por_nome is null and l.remarcacoes is not null
)
update lead l set agendado_por_nome = case
    when exists (select 1 from ia_resposta r where r.wa_ids ? split_part(a.achado, '|', 1))
      or exists (select 1 from ia_retomada r where r.wa_ids ? split_part(a.achado, '|', 1))
      then 'IA - ' || coalesce((select nullif(btrim(ia_nome), '') from config_loja where id = 1), 'Flávia')
    when split_part(a.achado, '|', 2) = 'ia'
      then 'IA - ' || btrim(regexp_replace(split_part(a.achado, '|', 3), '^\s*IA\s*[-–]?\s*', '', 'i'))
    else 'Celular · ' || split_part(a.achado, '|', 3)
  end
  from alvo a
 where a.id = l.id and a.achado is not null;
