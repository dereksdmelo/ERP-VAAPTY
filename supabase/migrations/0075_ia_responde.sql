-- =====================================================================
-- 0075 — A Flávia responde de verdade, começando pelo número da TV
--
-- O Derek, em 22/10/2026: *"estamos sem pré-vendas na empresa, pelo
-- menos tem alguém respondendo lá"* — e escolheu a resposta automática
-- direto, sem a fase de rascunho aprovado.
--
-- Quem responde é o cron do Worker do ERP, a cada minuto (decisão 64):
-- ele pergunta quais conversas esperam resposta, redige com a mesma
-- Flávia do treino (ia/flavia.js), manda pela ponte e grava o que
-- mandou. O cron não tem usuário, então não tem token para a RLS — e a
-- chave de serviço continua confinada (decisão 9). As funções abaixo
-- são estreitas e exigem um segredo do servidor, guardado aqui só como
-- hash: quem tiver a chave anônima (que é pública) e não tiver o
-- segredo não lê conversa nenhuma.
-- =====================================================================

-- O interruptor é por número, e é do gerente (RLS `wa_canal_gere`).
-- `ia_desde` é quando foi ligado: a Flávia só responde o que chegou
-- DEPOIS — ligar não pode disparar resposta para a fila de dias atrás.
alter table wa_canal add column if not exists ia_responde boolean not null default false;
alter table wa_canal add column if not exists ia_desde timestamptz;

-- Uma linha por mensagem do cliente respondida. O `unique` em
-- `mensagem_id` é a trava contra responder duas vezes a mesma coisa:
-- duas voltas do cron que se cruzem disputam a mesma linha, e só uma
-- entra.
create table if not exists ia_resposta (
  id           uuid primary key default gen_random_uuid(),
  conversa_id  uuid not null references wa_conversa(id) on delete cascade,
  mensagem_id  uuid not null unique references wa_mensagem(id) on delete cascade,
  estado       text not null default 'redigindo'
               check (estado in ('redigindo', 'enviada', 'falhou')),
  mensagens    jsonb,
  agendar      text,
  encerrar     boolean,
  -- Os ids que o WhatsApp deu ao que a Flávia mandou. É por eles que se
  -- separa a mensagem dela da mensagem de uma PESSOA da loja na mesma
  -- conversa — e pessoa respondendo é o sinal para a Flávia sair.
  wa_ids       jsonb not null default '[]'::jsonb,
  erro         text,
  modelo       text,
  uso          jsonb,
  criado_em    timestamptz not null default now(),
  enviado_em   timestamptz
);
create index if not exists ia_resposta_conversa on ia_resposta (conversa_id, criado_em desc);

alter table ia_resposta enable row level security;
drop policy if exists ia_resposta_leitura on ia_resposta;
create policy ia_resposta_leitura on ia_resposta for select using (e_equipe());

-- O segredo do servidor, só o hash. Sem política nenhuma: pela API,
-- ninguém lê nem escreve.
create table if not exists servidor_chave (
  nome text primary key,
  hash text not null
);
alter table servidor_chave enable row level security;

create or replace function ia_chave_ok(p_segredo text) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from servidor_chave
                  where nome = 'ia' and hash = encode(sha256(convert_to(coalesce(p_segredo, ''), 'UTF8')), 'hex'));
$$;
revoke all on function ia_chave_ok(text) from public;

/* A FILA: conversas de número com a Flávia ligada cuja ÚLTIMA mensagem
 * é do cliente e ninguém respondeu.
 *
 *  - 40 segundos de silêncio antes: o cliente manda "boa tarde" e "quero
 *    vender meu Gol" em duas mensagens, e é depois da segunda que se
 *    responde (o mesmo ponto do treino, decisão 60).
 *  - Só o que chegou depois de ligar, e nas últimas 12 horas: a ponte
 *    que ficou parada e voltou (21/10) não pode virar uma rajada de
 *    respostas para conversas de dias atrás.
 *  - PESSOA DA LOJA RESPONDEU nas últimas 12 horas → a Flávia sai da
 *    conversa. Mensagem que sai e não é dela é gente atendendo, e duas
 *    vozes respondendo o mesmo cliente é pior que nenhuma.
 *  - No máximo 20 respostas por conversa em 24 horas: teto contra laço
 *    e contra conversa que virou bate-papo. */
create or replace function ia_fila(p_segredo text)
returns table (conversa_id uuid, mensagem_id uuid, canal text, telefone text)
language plpgsql security definer set search_path = public stable as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
  select cv.id, ult.id, ca.slug, cv.telefone
    from wa_conversa cv
    join wa_canal ca on ca.id = cv.canal_id
    cross join lateral (
      select m.id, m.eco, m.quando from wa_mensagem m
       where m.conversa_id = cv.id and m.tipo <> 'reacao'
       order by m.quando desc limit 1
    ) ult
   where ca.ativo and ca.ia_responde and ca.ia_desde is not null
     and cv.ultima_em >= now() - interval '12 hours'
     and not ult.eco
     and ult.quando >= greatest(ca.ia_desde, now() - interval '12 hours')
     and ult.quando <= now() - interval '40 seconds'
     and not exists (select 1 from ia_resposta r where r.mensagem_id = ult.id)
     and not exists (
       select 1 from wa_mensagem h
        where h.conversa_id = cv.id and h.eco and h.quando >= now() - interval '12 hours'
          and not exists (select 1 from ia_resposta r2 where r2.conversa_id = cv.id and r2.wa_ids ? h.wa_id))
     and (select count(*) from ia_resposta r3 where r3.conversa_id = cv.id and r3.criado_em >= now() - interval '24 hours') < 20
   order by ult.quando
   limit 5;
end;
$$;
revoke all on function ia_fila(text) from public;
grant execute on function ia_fila(text) to anon, authenticated;

/* O que a Flávia precisa para redigir: a conversa, a configuração da
 * loja, os horários já ocupados e as correções do gerente. */
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
                         order by avaliado_em desc nulls last limit 8) t), '[]'::jsonb)
  ) into v;
  return v;
end;
$$;
revoke all on function ia_contexto(text, uuid) from public;
grant execute on function ia_contexto(text, uuid) to anon, authenticated;

-- Reservar ANTES de redigir: devolve o id, ou nulo se outra volta já
-- pegou esta mensagem.
create or replace function ia_reservar(p_segredo text, p_conversa uuid, p_mensagem uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into ia_resposta (conversa_id, mensagem_id) values (p_conversa, p_mensagem)
  on conflict (mensagem_id) do nothing
  returning id into v;
  return v;
end;
$$;
revoke all on function ia_reservar(text, uuid, uuid) from public;
grant execute on function ia_reservar(text, uuid, uuid) to anon, authenticated;

create or replace function ia_concluir(p_segredo text, p_id uuid, p_estado text, p_mensagens jsonb,
                                       p_agendar text, p_encerrar boolean, p_wa_ids jsonb,
                                       p_erro text, p_modelo text, p_uso jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update ia_resposta
     set estado = p_estado, mensagens = p_mensagens, agendar = nullif(p_agendar, ''),
         encerrar = p_encerrar, wa_ids = coalesce(p_wa_ids, '[]'::jsonb), erro = left(p_erro, 500),
         modelo = p_modelo, uso = p_uso,
         enviado_em = case when p_estado = 'enviada' then now() else enviado_em end
   where id = p_id;
end;
$$;
revoke all on function ia_concluir(text, uuid, text, jsonb, text, boolean, jsonb, text, text, jsonb) from public;
grant execute on function ia_concluir(text, uuid, text, jsonb, text, boolean, jsonb, text, text, jsonb) to anon, authenticated;
