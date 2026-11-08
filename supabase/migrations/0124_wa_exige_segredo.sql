-- =====================================================================
-- 0124 — As funções do WhatsApp passam a exigir o segredo (08/11/2026)
--
-- A varredura achou sete funções `security definer` do WhatsApp
-- executáveis pela chave anônima, que é pública por desenho
-- (`?recurso=config`): wa_receber, wa_receber_grupo, wa_estado,
-- wa_numero, wa_canal_grupos, wa_canais_para_acordar e wa_lead_avanca.
-- Quem tivesse a chave injetava mensagem "do cliente", lead e
-- agendamento falso, e fazia a Flávia responder pelo número da loja.
-- As funções da IA e do cache de placa já exigiam o IA_SEGREDO; estas
-- ficaram sem a mesma trava.
--
-- Cada uma ganha uma SOBRECARGA com o mesmo nome e `p_segredo` ao final,
-- que confere `ia_chave_ok()` e chama a original. A original fica no
-- banco, mas sem permissão para anon e authenticated: só a cobertura
-- (security definer) e as outras funções do banco chegam nela.
--
-- ORDEM DE PUBLICAÇÃO (sem janela de falha): 1) esta migração só com os
-- passos 1 e 2; 2) publicar o código que manda `p_segredo`; 3) rodar o
-- passo 3 (revoke), que tranca as originais.
-- =====================================================================

-- passo 1: as coberturas
create or replace function wa_receber(p_canal text, p_telefone text, p_nome text, p_wa_id text, p_eco boolean,
  p_tipo text, p_texto text, p_anexo jsonb, p_quando timestamptz, p_anuncio jsonb, p_segredo text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return wa_receber(p_canal, p_telefone, p_nome, p_wa_id, p_eco, p_tipo, p_texto, p_anexo, p_quando, p_anuncio);
end $$;

create or replace function wa_receber_grupo(p_canal text, p_grupo text, p_nome text, p_autor text, p_wa_id text,
  p_eco boolean, p_tipo text, p_texto text, p_anexo jsonb, p_quando timestamptz, p_segredo text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return wa_receber_grupo(p_canal, p_grupo, p_nome, p_autor, p_wa_id, p_eco, p_tipo, p_texto, p_anexo, p_quando);
end $$;

create or replace function wa_estado(p_canal text, p_telefone text, p_wa_id text, p_estado text, p_segredo text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return wa_estado(p_canal, p_telefone, p_wa_id, p_estado);
end $$;

create or replace function wa_numero(p_canal text, p_telefone text, p_segredo text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return wa_numero(p_canal, p_telefone);
end $$;

create or replace function wa_canal_grupos(p_canal text, p_segredo text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return wa_canal_grupos(p_canal);
end $$;

create or replace function wa_canais_para_acordar(p_segredo text)
returns setof text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query select * from wa_canais_para_acordar();
end $$;

create or replace function wa_lead_avanca(p_mensagem uuid, p_evento text, p_quando timestamptz, p_origem text, p_segredo text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return wa_lead_avanca(p_mensagem, p_evento, p_quando, p_origem);
end $$;

-- as coberturas: só quem chama com segredo (a função confere)
revoke all on function wa_receber(text,text,text,text,boolean,text,text,jsonb,timestamptz,jsonb,text) from public;
revoke all on function wa_receber_grupo(text,text,text,text,text,boolean,text,text,jsonb,timestamptz,text) from public;
revoke all on function wa_estado(text,text,text,text,text) from public;
revoke all on function wa_numero(text,text,text) from public;
revoke all on function wa_canal_grupos(text,text) from public;
revoke all on function wa_canais_para_acordar(text) from public;
revoke all on function wa_lead_avanca(uuid,text,timestamptz,text,text) from public;
grant execute on function wa_receber(text,text,text,text,boolean,text,text,jsonb,timestamptz,jsonb,text) to anon, authenticated;
grant execute on function wa_receber_grupo(text,text,text,text,text,boolean,text,text,jsonb,timestamptz,text) to anon, authenticated;
grant execute on function wa_estado(text,text,text,text,text) to anon, authenticated;
grant execute on function wa_numero(text,text,text) to anon, authenticated;
grant execute on function wa_canal_grupos(text,text) to anon, authenticated;
grant execute on function wa_canais_para_acordar(text) to anon, authenticated;
grant execute on function wa_lead_avanca(uuid,text,timestamptz,text,text) to anon, authenticated;

-- passo 3 (SÓ DEPOIS de o código com p_segredo estar no ar): tranca as originais
-- revoke all on function wa_receber(text,text,text,text,boolean,text,text,jsonb,timestamptz,jsonb) from public, anon, authenticated;
-- revoke all on function wa_receber_grupo(text,text,text,text,text,boolean,text,text,jsonb,timestamptz) from public, anon, authenticated;
-- revoke all on function wa_estado(text,text,text,text) from public, anon, authenticated;
-- revoke all on function wa_numero(text,text) from public, anon, authenticated;
-- revoke all on function wa_canal_grupos(text) from public, anon, authenticated;
-- revoke all on function wa_canais_para_acordar() from public, anon, authenticated;
-- revoke all on function wa_lead_avanca(uuid,text,timestamptz,text) from public, anon, authenticated;
