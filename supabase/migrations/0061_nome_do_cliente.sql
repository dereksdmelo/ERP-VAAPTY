-- O NOME QUE ENTRAVA ERA O NOSSO (05/10/2026)
--
-- O Derek viu o quadro com sete cartoes chamados "Vaapty Joinville" e
-- perguntou por que. Porque era o nosso nome, nao o do cliente.
--
-- **O `pushName` da mensagem que SAI e o nome do NOSSO perfil.** A
-- ponte manda o `pushName` de toda mensagem, e a `wa_receber` guardava
-- "o mais recente que nao for vazio" -- entao bastava a IA responder
-- para o nome do cliente virar "Vaapty Joinville". Em conversa que a
-- loja comecou (prospeccao ativa), o nome do cliente nunca chegou a
-- existir.
--
-- Eram 213 conversas assim, mais 25 com "Administrativo Vaapty
-- Joinville", e cada lead criado delas nasceu com o nome errado.
--
-- **A correcao e no banco, nao so na ponte**: a ponte pode ser
-- republicada sem a correcao, e o erro volta calado. Aqui ele nao
-- entra, venha de onde vier.

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
  v_nome     text;
begin
  select id into v_canal from wa_canal where slug = p_canal and ativo;
  if v_canal is null then
    raise exception 'canal desconhecido: %', p_canal using errcode = 'P0002';
  end if;
  if coalesce(p_telefone, '') = '' or coalesce(p_wa_id, '') = '' then
    raise exception 'faltou telefone ou id da mensagem' using errcode = 'P0001';
  end if;
  if p_tipo not in ('texto','midia','botao','reacao') then
    raise exception 'tipo invalido: %', p_tipo using errcode = 'P0001';
  end if;

  -- **SO A MENSAGEM QUE CHEGA TRAZ O NOME DO CLIENTE.** Na que sai, o
  -- `pushName` e o nosso.
  v_nome := case when coalesce(p_eco, false) then null else nullif(p_nome, '') end;

  insert into wa_conversa (canal_id, telefone, nome, anuncio, primeira_em, ultima_em)
  values (v_canal, p_telefone, v_nome, p_anuncio, coalesce(p_quando, now()), coalesce(p_quando, now()))
  on conflict (canal_id, telefone) do update
    set nome    = coalesce(excluded.nome, wa_conversa.nome),
        anuncio = coalesce(wa_conversa.anuncio, excluded.anuncio)
  returning id into v_conversa;

  insert into wa_mensagem (conversa_id, wa_id, eco, tipo, texto, anexo, quando)
  values (v_conversa, p_wa_id, coalesce(p_eco, false), p_tipo, nullif(p_texto, ''), p_anexo, coalesce(p_quando, now()))
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

-- ---------------------------------------------------------------
-- O CONSERTO DO QUE JA ESTA GRAVADO.
--
-- Primeiro tira o nome errado. Depois tenta recuperar o certo de onde
-- ele ficou: **o texto da propria IA**, que trata o cliente pelo nome
-- ("Oi Josiela, tudo bem?"). So aceita palavra com inicial maiuscula,
-- entao "Oi, tudo bem" nao vira o nome "tudo"; e so preenche onde o
-- nome esta vazio, nunca por cima de um nome de verdade.

update wa_conversa
   set nome = null
 where nome is not null
   and nome ilike '%vaapty%';

with achado as (
  select distinct on (m.conversa_id)
         m.conversa_id,
         (regexp_match(m.texto,
            '^\s*(?:Oi|Ol[aá]|Bom dia|Boa tarde|Boa noite)[, ]+([A-ZÀ-Ú][a-zà-ú]{2,15}(?: [A-ZÀ-Ú][a-zà-ú]{2,15})?)'))[1] as nome
    from wa_mensagem m
    join wa_conversa c on c.id = m.conversa_id
   where c.nome is null and m.eco
     and m.texto ~ '^\s*(?:Oi|Ol[aá]|Bom dia|Boa tarde|Boa noite)[, ]+[A-ZÀ-Ú]'
   order by m.conversa_id, m.quando asc
)
update wa_conversa c
   set nome = a.nome
  from achado a
 where c.id = a.conversa_id
   and a.nome is not null
   and c.nome is null;

-- E o lead que nasceu com o nome errado passa a chamar-se como a
-- conversa: o recuperado quando houve, o telefone quando nao.
update lead l
   set nome = coalesce(c.nome, l.telefone)
  from wa_conversa c
 where c.lead_id = l.id
   and l.nome ilike '%vaapty%';
