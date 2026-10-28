-- =====================================================================
-- 0087 — A Flávia lê o cliente em TODOS os números da loja
--
-- O Derek, 28/10/2026: "importante a flavia se contextualizar por todas
-- as conversas inclusive com os outros numeros". O mesmo cliente fala
-- com a TV, com a Ana, com a Camila e com a prospecção, e cada número é
-- uma conversa separada (wa_conversa por canal). A Flávia só lia a
-- conversa em que ia responder — e a retomada, que escreve pela
-- prospecção para quem foi agendado pela Ana, começava sem saber nada.
--
-- `outras`: as mensagens das OUTRAS conversas do mesmo telefone (DDD +
-- oito últimos, a chave do funil), dos últimos 60 dias, as 80 mais
-- recentes, com o nome do número. Inclui o administrativo: se o cliente
-- falou lá, é o mesmo cliente.
--
-- Só acrescenta a chave `outras`; o resto é a função da 0078 como estava.
-- =====================================================================

create or replace function ia_contexto(p_segredo text, p_conversa uuid)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare v jsonb; v_fone text;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select right(regexp_replace(coalesce(cv.telefone, ''), '\D', '', 'g'), 8) into v_fone
    from wa_conversa cv where cv.id = p_conversa;
  select jsonb_build_object(
    'conversa', (select jsonb_build_object('id', cv.id, 'telefone', cv.telefone, 'nome', cv.nome, 'canal', ca.slug, 'anuncio', cv.anuncio is not null)
                   from wa_conversa cv join wa_canal ca on ca.id = cv.canal_id where cv.id = p_conversa),
    'msgs', coalesce((select jsonb_agg(x order by x.quando) from (
              select m.id, m.eco, m.tipo, m.texto, m.anexo, m.leitura, m.quando
                from wa_mensagem m where m.conversa_id = p_conversa
               order by m.quando desc limit 200) x), '[]'::jsonb),
    'outras', case when length(coalesce(v_fone, '')) < 8 then '[]'::jsonb else coalesce((select jsonb_agg(x order by x.quando) from (
              select m.id, m.eco, m.tipo, m.texto, m.anexo, m.leitura, m.quando, ca.nome as numero
                from wa_conversa c join wa_canal ca on ca.id = c.canal_id
                join wa_mensagem m on m.conversa_id = c.id
               where c.id <> p_conversa
                 and right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 8) = v_fone
                 and m.quando > now() - interval '60 days'
                 and m.tipo <> 'reacao'
               order by m.quando desc limit 80) x), '[]'::jsonb) end,
    'config', (select to_jsonb(c) from config_loja c where c.id = 1),
    'ocupados', coalesce((select jsonb_agg(l.agendado_para) from lead l
                  where l.status in ('agendado', 'confirmado') and l.excluido_em is null
                    and l.agendado_para >= (now() at time zone 'America/Sao_Paulo')::date), '[]'::jsonb),
    'exemplos', coalesce((select jsonb_agg(jsonb_build_object('cliente', t.cliente, 'correcao', t.correcao))
                  from (select cliente, correcao from ia_treino where correcao is not null
                         order by avaliado_em desc nulls last limit 20) t), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function ia_contexto(text, uuid) from public;
grant execute on function ia_contexto(text, uuid) to anon, authenticated;
