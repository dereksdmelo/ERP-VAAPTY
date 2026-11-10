-- 0146 · A via assinada entra sozinha, na hora (10/11/2026, o Derek: "o contrato que o cliente assina no ZapSign não
-- tá ficando salvo o PDF no sistema pra conferência do adm"). Ela só era guardada quando alguém abria o
-- atendimento depois da assinatura (o Jackson assinou às 16:51, o PDF entrou às 17:56), e o adm conferia antes —
-- e anexava à mão. E o contrato REENVIADO nunca guardava a via nova: a marca era "já tem um Contrato assinado".
--
-- O webhook chega sem login (decisão 21). Estas duas funções são o mesmo remédio da marcar_contrato_assinado
-- (0015): estreitas, e só para o token que o envio gravou. A primeira diz de que atendimento é o token (o caminho
-- do arquivo começa por ele); a segunda grava a linha do anexo, uma por token — o nome do arquivo leva o começo
-- do token, e é isso que deixa a via de um reenvio entrar ao lado da antiga.
create or replace function contrato_por_token(tok text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from atendimento where length(coalesce(tok, '')) >= 10 and contrato_zapsign_token = tok limit 1
$$;
revoke all on function contrato_por_token(text) from public;
grant execute on function contrato_por_token(text) to anon, authenticated;

-- Sem caminho, só diz se a via deste token já está guardada ({ja: true}) — o webhook pergunta antes de subir.
drop function if exists anexar_contrato_assinado(text, text, int);
create or replace function anexar_contrato_assinado(tok text, p_caminho text, p_bytes int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare aid uuid; nome_arq text; novo uuid;
begin
  select id into aid from atendimento where length(coalesce(tok, '')) >= 10 and contrato_zapsign_token = tok limit 1;
  if aid is null then return null; end if;
  nome_arq := 'contrato-assinado-' || left(tok, 8) || '.pdf';
  select id into novo from anexo where atendimento_id = aid and nome = nome_arq limit 1;
  if novo is not null then return jsonb_build_object('id', novo, 'ja', true); end if;
  if p_caminho is null then return jsonb_build_object('id', null, 'ja', false); end if;
  if position(aid::text || '/' in p_caminho) <> 1 then return null; end if;
  insert into anexo (atendimento_id, caminho, nome, tipo, bytes, rotulo)
  values (aid, p_caminho, nome_arq, 'application/pdf', p_bytes, 'Contrato assinado') returning id into novo;
  return jsonb_build_object('id', novo, 'ja', false);
end $$;
revoke all on function anexar_contrato_assinado(text, text, int) from public;
grant execute on function anexar_contrato_assinado(text, text, int) to anon, authenticated;

insert into schema_migrations(arquivo) values ('0146_via_assinada_no_webhook.sql') on conflict do nothing;
