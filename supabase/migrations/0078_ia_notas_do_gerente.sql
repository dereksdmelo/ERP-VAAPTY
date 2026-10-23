-- AS NOTAS DO GERENTE VOLTAM INTEIRAS A FLAVIA AO VIVO (23/10/2026)
--
-- A 0075 mandava as 8 correcoes mais recentes, pensadas como "resposta
-- aprovada" para imitar. O uso mostrou que o gerente escreve
-- ORIENTACAO ("nao precisa avisar pra cancelar c 2 hrs de
-- antecedencia"), e regra que cai da lista deixa de valer. Passam a ir
-- as 20 mais recentes -- o mesmo numero do treino (FLAVIA_EXEMPLOS no
-- api/atendimento.js). Quem mudar um muda o outro.
--
-- So o limite muda; o resto e a funcao da 0075 como estava.

create or replace function ia_contexto(p_segredo text, p_conversa uuid)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select jsonb_build_object(
    'conversa', (select jsonb_build_object('id', cv.id, 'telefone', cv.telefone, 'nome', cv.nome, 'canal', ca.slug, 'anuncio', cv.anuncio is not null)
                   from wa_conversa cv join wa_canal ca on ca.id = cv.canal_id where cv.id = p_conversa),
    'msgs', coalesce((select jsonb_agg(x order by x.quando) from (
              select m.id, m.eco, m.tipo, m.texto, m.anexo, m.leitura, m.quando
                from wa_mensagem m where m.conversa_id = p_conversa
               order by m.quando desc limit 200) x), '[]'::jsonb),
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

