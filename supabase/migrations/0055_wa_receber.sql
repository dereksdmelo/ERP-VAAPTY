-- COMO A PONTE ESCREVE SEM A CHAVE DE SERVIÇO (01/10/2026)
--
-- A ponte do WhatsApp é servidor falando com servidor: não há usuário,
-- então não há token para a RLS julgar. O caminho óbvio seria a
-- `SUPABASE_SERVICE_KEY` -- e seria o TERCEIRO uso dela, contra a
-- decisão 9, que a confina ao Storage (api/foto.js) e à troca de senha
-- (api/perfil.js). O teste de lá é claro: existe outro caminho? Então
-- não use a chave.
--
-- Existe, e é o mesmo da decisão 42 (o assinador público): uma função
-- `security definer` ESTREITA, que só sabe fazer uma coisa. Se o
-- segredo da ponte vazar, o estrago é escrever conversa -- não ler a
-- tabela `atendimento` inteira, com CPF e telefone de cliente.
--
-- **Quem trocar isto pela chave de serviço está desfazendo a decisão
-- 9 e a 42 de uma vez.**

create or replace function wa_receber(
  p_canal     text,
  p_telefone  text,
  p_nome      text,
  p_wa_id     text,
  p_eco       boolean,
  p_tipo      text,
  p_texto     text,
  p_anexo     jsonb,
  p_quando    timestamptz,
  p_anuncio   jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_canal    uuid;
  v_conversa uuid;
  v_msg      uuid;
begin
  select id into v_canal from wa_canal where slug = p_canal and ativo;
  if v_canal is null then
    raise exception 'canal desconhecido: %', p_canal using errcode = 'P0002';
  end if;
  if coalesce(p_telefone, '') = '' or coalesce(p_wa_id, '') = '' then
    raise exception 'faltou telefone ou id da mensagem' using errcode = 'P0001';
  end if;
  if p_tipo not in ('texto','midia','botao','reacao') then
    raise exception 'tipo inválido: %', p_tipo using errcode = 'P0001';
  end if;

  -- A conversa nasce no primeiro "oi" e não some mais.
  insert into wa_conversa (canal_id, telefone, nome, anuncio, primeira_em, ultima_em)
  values (v_canal, p_telefone, nullif(p_nome, ''), p_anuncio, coalesce(p_quando, now()), coalesce(p_quando, now()))
  on conflict (canal_id, telefone) do update
    -- O nome do perfil muda; guardamos o mais recente que não seja
    -- vazio. O anúncio, não: ele é de ONDE a conversa veio, e só a
    -- primeira mensagem sabe disso.
    set nome    = coalesce(nullif(excluded.nome, ''), wa_conversa.nome),
        anuncio = coalesce(wa_conversa.anuncio, excluded.anuncio)
  returning id into v_conversa;

  insert into wa_mensagem (conversa_id, wa_id, eco, tipo, texto, anexo, quando)
  values (v_conversa, p_wa_id, coalesce(p_eco, false), p_tipo, nullif(p_texto, ''), p_anexo, coalesce(p_quando, now()))
  -- A ponte reentrega a mesma mensagem quando o container reinicia.
  on conflict (conversa_id, wa_id) do nothing
  returning id into v_msg;

  -- `ultima_de_fora` e `respondida_em` são o relógio da fila "quem
  -- está esperando resposta agora" -- a tela de todo dia do SDR. Sem
  -- elas, saber há quanto tempo o cliente espera viraria uma varredura
  -- nas mensagens a cada carregamento.
  update wa_conversa set
    ultima_em      = greatest(ultima_em, coalesce(p_quando, now())),
    ultima_de_fora = case when coalesce(p_eco, false) then ultima_de_fora
                          else greatest(coalesce(ultima_de_fora, 'epoch'::timestamptz), coalesce(p_quando, now())) end,
    respondida_em  = case when coalesce(p_eco, false) then greatest(coalesce(respondida_em, 'epoch'::timestamptz), coalesce(p_quando, now()))
                          else respondida_em end
  where id = v_conversa;

  return v_msg;   -- nulo quando a mensagem já existia
end;
$$;

-- Marca entregue/lida. Separada porque chega por outra rota da ponte e
-- em outro momento -- e porque uma função que faz duas coisas vira a
-- porta larga que esta migration existe para evitar.
create or replace function wa_estado(p_canal text, p_telefone text, p_wa_id text, p_estado text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_n int;
begin
  if p_estado not in ('delivered','read') then return false; end if;
  update wa_mensagem m set estado = p_estado
  from wa_conversa c join wa_canal k on k.id = c.canal_id
  where m.conversa_id = c.id and m.wa_id = p_wa_id
    and k.slug = p_canal and c.telefone = p_telefone;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- `anon` NÃO entra aqui: quem chama é o Worker do ERP, autenticado
-- pelo segredo da ponte, usando a chave anônima apenas como passagem.
revoke all on function wa_receber(text,text,text,text,boolean,text,text,jsonb,timestamptz,jsonb) from public;
revoke all on function wa_estado(text,text,text,text) from public;
grant execute on function wa_receber(text,text,text,text,boolean,text,text,jsonb,timestamptz,jsonb) to anon, authenticated;
grant execute on function wa_estado(text,text,text,text) to anon, authenticated;
