-- 0147 · A via assinada do LOJISTA também entra na hora (10/11/2026, o Derek). Mesmo remédio da 0146: o webhook
-- chega sem login, e estas duas funções só servem ao token que o envio gravou no `estoque`. A via vai para o item
-- "Contrato Lojista" do check list (`doc:arq_contrato_lojista`) do atendimento do carro — carro importado sem
-- atendimento não tem check list, e fica sem (como antes). Uma via por documento: o nome leva o começo do token.
create or replace function lojista_por_token(tok text) returns uuid
language sql stable security definer set search_path = public as $$
  select atendimento_id from estoque where length(coalesce(tok, '')) >= 10 and lojista_zapsign_token = tok limit 1
$$;
revoke all on function lojista_por_token(text) from public;
grant execute on function lojista_por_token(text) to anon, authenticated;

-- Sem caminho, só diz se a via deste token já está guardada.
create or replace function anexar_contrato_lojista_assinado(tok text, p_caminho text, p_bytes int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare aid uuid; nome_arq text; novo uuid;
begin
  select atendimento_id into aid from estoque where length(coalesce(tok, '')) >= 10 and lojista_zapsign_token = tok limit 1;
  if aid is null then return null; end if;
  nome_arq := 'contrato-lojista-assinado-' || left(tok, 8) || '.pdf';
  select id into novo from anexo where atendimento_id = aid and nome = nome_arq limit 1;
  if novo is not null then return jsonb_build_object('id', novo, 'ja', true); end if;
  if p_caminho is null then return jsonb_build_object('id', null, 'ja', false); end if;
  if position(aid::text || '/' in p_caminho) <> 1 then return null; end if;
  insert into anexo (atendimento_id, caminho, nome, tipo, bytes, rotulo)
  values (aid, p_caminho, nome_arq, 'application/pdf', p_bytes, 'doc:arq_contrato_lojista') returning id into novo;
  return jsonb_build_object('id', novo, 'ja', false);
end $$;
revoke all on function anexar_contrato_lojista_assinado(text, text, int) from public;
grant execute on function anexar_contrato_lojista_assinado(text, text, int) to anon, authenticated;

insert into schema_migrations(arquivo) values ('0147_via_lojista_no_webhook.sql') on conflict do nothing;
