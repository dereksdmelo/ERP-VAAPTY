-- =====================================================================
-- 0104 — Os grupos do WhatsApp do adm
--
-- O Derek, em 03/11/2026: "preciso que o whats do ADM tenha acesso aos
-- grupos pra mandar comprovantes, CRLV, tudo que é importante nos grupos
-- sem esquecer, e também poder acessar, baixar informações, ouvir
-- áudios, vídeos, documentos".
--
-- A ponte descartava toda mensagem de grupo. **Só número de operação
-- recebe grupo** (`comercial = false`, 0058): é lá que estão os grupos de
-- lojista, cartório e despachante. Os números comerciais e os das IAs
-- continuam sem grupo — encheriam a caixa da pré-venda e nunca viram
-- lead.
--
-- A conversa de grupo é a mesma `wa_conversa`, com o id do grupo
-- (`…@g.us`) no lugar do telefone e o nome do grupo no `nome`; cada
-- mensagem leva quem escreveu (`autor`). Escrita pela ponte, sem
-- usuário, por funções estreitas como a `wa_receber` (0055).
-- =====================================================================

alter table wa_conversa add column if not exists grupo boolean not null default false;
alter table wa_mensagem add column if not exists autor text;

-- A ponte pergunta ao ligar se aquele número recebe grupo.
create or replace function wa_canal_grupos(p_canal text) returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce((select comercial = false from wa_canal where slug = p_canal and ativo), false);
$$;
revoke all on function wa_canal_grupos(text) from public;
grant execute on function wa_canal_grupos(text) to anon, authenticated;

create or replace function wa_receber_grupo(
  p_canal text, p_grupo text, p_nome text, p_autor text, p_wa_id text, p_eco boolean,
  p_tipo text, p_texto text, p_anexo jsonb, p_quando timestamptz
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_canal uuid; v_conversa uuid; v_msg uuid;
begin
  select id into v_canal from wa_canal where slug = p_canal and ativo and comercial = false;
  if v_canal is null then raise exception 'canal sem grupos: %', p_canal using errcode = 'P0002'; end if;
  if coalesce(p_grupo, '') !~ '^[0-9-]+@g\.us$' or coalesce(p_wa_id, '') = '' then
    raise exception 'grupo ou id inválido' using errcode = 'P0001';
  end if;
  if p_tipo not in ('texto','midia','botao','reacao') then raise exception 'tipo invalido: %', p_tipo using errcode = 'P0001'; end if;

  insert into wa_conversa (canal_id, telefone, nome, grupo, primeira_em, ultima_em)
  values (v_canal, p_grupo, nullif(p_nome, ''), true, coalesce(p_quando, now()), coalesce(p_quando, now()))
  on conflict (canal_id, telefone) do update
    set nome = coalesce(nullif(excluded.nome, ''), wa_conversa.nome), grupo = true
  returning id into v_conversa;

  insert into wa_mensagem (conversa_id, wa_id, eco, tipo, texto, anexo, quando, autor)
  values (v_conversa, p_wa_id, coalesce(p_eco, false), p_tipo, nullif(p_texto, ''), p_anexo, coalesce(p_quando, now()), nullif(p_autor, ''))
  on conflict (conversa_id, wa_id) do nothing
  returning id into v_msg;

  update wa_conversa set
    ultima_em      = greatest(ultima_em, coalesce(p_quando, now())),
    ultima_de_fora = case when coalesce(p_eco, false) then ultima_de_fora
                          else greatest(coalesce(ultima_de_fora, 'epoch'::timestamptz), coalesce(p_quando, now())) end,
    respondida_em  = case when coalesce(p_eco, false) then greatest(coalesce(respondida_em, 'epoch'::timestamptz), coalesce(p_quando, now()))
                          else respondida_em end
  where id = v_conversa;
  return v_msg;
end;
$$;
revoke all on function wa_receber_grupo(text, text, text, text, text, boolean, text, text, jsonb, timestamptz) from public;
grant execute on function wa_receber_grupo(text, text, text, text, text, boolean, text, text, jsonb, timestamptz) to anon, authenticated;
