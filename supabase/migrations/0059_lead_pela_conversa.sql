-- A CONVERSA MOVE O LEAD SOZINHA (05/10/2026)
--
-- O Derek descreveu o ciclo inteiro olhando as mensagens que a Ana e a
-- Camila mandam:
--
--   * o lead NOVO vira AGENDAR na primeira resposta do cliente depois
--     da nossa primeira mensagem;
--   * vira AGENDADO quando a IA confirma uma data e uma hora -- cada
--     uma escreve de um jeito, mas sempre confirma as duas coisas;
--   * no dia marcado alguem aperta "veio" ou "nao veio", e nao veio
--     volta para REAGENDAR;
--   * "ja vendeu" continua manual, porque o sistema nao tem como saber.
--
-- **Quem move e o evento, nao o estado.** A ponte so sabe dizer o que
-- aconteceu (chegou mensagem, saiu mensagem com data); e esta funcao
-- que decide se isso muda alguma coisa. Calcular do outro lado faria a
-- regra viver em dois lugares.
--
-- **Security definer pelo mesmo motivo de sempre:** quem chama e a
-- ponte, que nao tem usuario (decisoes 9 e 48). A funcao so sabe mexer
-- em lead a partir de uma conversa -- se o segredo da ponte vazar, o
-- estrago e mover lead, nao ler a tabela `atendimento`.

-- Recebe o id da MENSAGEM, que e o que `wa_receber` devolve, e acha a
-- conversa a partir dela. Passar o id da conversa obrigaria a ponte a
-- fazer uma consulta so para isso.
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
  v_lead     lead%rowtype;
  v_fone     text;
  v_tem_eco  boolean;
begin
  select cv.*, ca.comercial, ca.nome as canal_nome
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
