-- 0148 · Uma conversa por número, com ou sem o nono dígito (10/11/2026, o Derek: "depois que a gente chama o
-- cliente no sistema, fica duas conversas com o mesmo número, como se fosse duas conversas diferentes, mas no
-- celular é uma conversa só"). A "Nova conversa" grava o telefone como foi digitado — 55 47 9 9653-3758, treze
-- dígitos —, e o WhatsApp devolve a resposta do cliente pelo número dele, muitas vezes sem o 9 (doze). Para o
-- banco eram dois números. A chave do funil já era essa (DDD + os oito últimos, `chaveFone`, decisão 49): agora a
-- mensagem que chega cai na conversa que já existe no mesmo número com essa chave.
create or replace function wa_chave_fone(t text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(t, ''), '\D', '', 'g')) >= 12
    then substr(regexp_replace(t, '\D', '', 'g'), 3, 2) || right(regexp_replace(t, '\D', '', 'g'), 8) end
$$;

create or replace function wa_receber(p_canal text, p_telefone text, p_nome text, p_wa_id text, p_eco boolean,
  p_tipo text, p_texto text, p_anexo jsonb, p_quando timestamptz, p_anuncio jsonb, p_segredo text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare tel text := p_telefone; ja text;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if wa_chave_fone(p_telefone) is not null then
    select c.telefone into ja from wa_conversa c join wa_canal k on k.id = c.canal_id
     where k.slug = p_canal and not coalesce(c.grupo, false) and c.telefone <> p_telefone
       and wa_chave_fone(c.telefone) = wa_chave_fone(p_telefone)
       and not exists (select 1 from wa_conversa c2 where c2.canal_id = c.canal_id and c2.telefone = p_telefone)
     order by c.ultima_em desc nulls last limit 1;
    if ja is not null then tel := ja; end if;
  end if;
  return wa_receber(p_canal, tel, p_nome, p_wa_id, p_eco, p_tipo, p_texto, p_anexo, p_quando, p_anuncio);
end $$;

-- Juntar duas conversas do mesmo número: as mensagens e o que pende delas vão para a que fica, que herda o que
-- só a outra sabia (lead, atendimento, nome, datas), e a outra sai.
create or replace function wa_juntar_conversas(p_fica uuid, p_sai uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s wa_conversa%rowtype;
begin
  select * into s from wa_conversa where id = p_sai;
  if s.id is null or p_fica = p_sai then return; end if;
  delete from wa_mensagem m where m.conversa_id = p_sai and m.wa_id is not null
     and exists (select 1 from wa_mensagem x where x.conversa_id = p_fica and x.wa_id = m.wa_id);
  update wa_mensagem set conversa_id = p_fica where conversa_id = p_sai;
  update ia_resposta set conversa_id = p_fica where conversa_id = p_sai;
  update ia_treino set conversa_id = p_fica where conversa_id = p_sai;
  update wa_conversa f set
    nome = coalesce(nullif(f.nome, ''), s.nome),
    lead_id = coalesce(f.lead_id, s.lead_id),
    atendimento_id = coalesce(f.atendimento_id, s.atendimento_id),
    anuncio = coalesce(f.anuncio, s.anuncio),
    primeira_em = least(f.primeira_em, s.primeira_em),
    ultima_em = greatest(f.ultima_em, s.ultima_em),
    ultima_de_fora = greatest(f.ultima_de_fora, s.ultima_de_fora),
    respondida_em = greatest(f.respondida_em, s.respondida_em),
    lida_em = greatest(f.lida_em, s.lida_em)
   where f.id = p_fica;
  delete from wa_conversa where id = p_sai;
end $$;
revoke all on function wa_juntar_conversas(uuid, uuid) from public, anon, authenticated;

-- As que já estão duplicadas: fica a do número que o WhatsApp usa (a que tem mensagem do cliente; empate, a mais
-- antiga), e a outra é juntada nela.
do $$
declare r record; fica uuid;
begin
  for r in
    select c.canal_id, wa_chave_fone(c.telefone) k from wa_conversa c
     where not coalesce(c.grupo, false) and wa_chave_fone(c.telefone) is not null
     group by 1, 2 having count(*) > 1
  loop
    select c.id into fica from wa_conversa c
     where c.canal_id = r.canal_id and wa_chave_fone(c.telefone) = r.k and not coalesce(c.grupo, false)
     order by exists (select 1 from wa_mensagem m where m.conversa_id = c.id and not m.eco) desc, c.primeira_em asc limit 1;
    perform wa_juntar_conversas(fica, c.id) from wa_conversa c
     where c.canal_id = r.canal_id and wa_chave_fone(c.telefone) = r.k and not coalesce(c.grupo, false) and c.id <> fica;
  end loop;
end $$;

insert into schema_migrations(arquivo) values ('0148_conversa_mesmo_numero.sql') on conflict do nothing;
