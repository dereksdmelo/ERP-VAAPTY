-- O TREINO DA FLAVIA (18/10/2026)
--
-- O Derek: *"vou usar as duas IA pra servir de base pro aprendizado da
-- nossa propria"*. A Flavia nao manda nada a ninguem ainda -- a ponte
-- so escuta (decisao 48). O que da para fazer desde ja e o REPLAY: em
-- cada ponto de uma conversa real em que o cliente escreveu, a Flavia
-- redige o que responderia, e o gerente compara com o que a Ana ou a
-- Camila responderam de verdade.
--
-- **Uma linha por ponto da conversa, nao por clique.** O ponto e a
-- ultima mensagem do cliente antes da resposta (`mensagem_id`), e o
-- indice unico faz "refazer" substituir o rascunho em vez de empilhar:
-- tres rascunhos para a mesma pergunta obrigariam a decidir qual foi
-- avaliado.
--
-- **Refazer apaga a avaliacao junto.** A nota e a correcao julgaram
-- AQUELE texto; ficar com elas em cima de um texto novo seria uma
-- avaliacao que ninguem fez. Quem faz isso e o servidor, no upsert.
--
-- **A correcao e o que ensina.** E o texto que o gerente escreveria
-- no lugar -- e o servidor a devolve a Flavia como exemplo nas
-- proximas respostas. Nota sem correcao mede; correcao muda o
-- comportamento. Por isso as duas sao colunas separadas.
--
-- **So o gerente.** Treinar a IA e decidir como a loja fala com o
-- cliente, e a conversa original tem nome e telefone de quem escreveu.

create table if not exists ia_treino (
  id           uuid primary key default gen_random_uuid(),
  conversa_id  uuid not null references wa_conversa(id) on delete cascade,
  mensagem_id  uuid not null references wa_mensagem(id) on delete cascade,
  -- O que o cliente tinha acabado de escrever. Repetido aqui porque a
  -- correcao vira exemplo para a Flavia, e exemplo sem a pergunta nao
  -- ensina nada.
  cliente      text,
  -- O que a Ana ou a Camila responderam de fato, congelado: a conversa
  -- original nao muda, mas a comparacao precisa estar inteira na linha
  -- quando ela virar exemplo.
  original     text,
  -- O que a Flavia responderia: uma ou mais mensagens, como no
  -- WhatsApp, e o agendamento que ela marcaria, se marcasse.
  proposta     jsonb not null,
  modelo       text,
  uso          jsonb,
  nota         text check (nota in ('flavia', 'original', 'empate', 'ruim')),
  correcao     text,
  avaliado_por uuid references perfil(id),
  avaliado_em  timestamptz,
  criado_por   uuid references perfil(id),
  criado_em    timestamptz not null default now(),
  unique (mensagem_id)
);

create index if not exists ia_treino_conversa on ia_treino (conversa_id);
-- As correcoes viram exemplo: a consulta e "as mais recentes com
-- correcao", feita a cada rascunho novo.
create index if not exists ia_treino_correcao on ia_treino (avaliado_em desc)
  where correcao is not null;

comment on table ia_treino is
  'Replay da Flavia sobre conversas reais da Ana e da Camila: o rascunho, a nota e a correcao do gerente.';

alter table ia_treino enable row level security;

drop policy if exists ia_treino_gerente on ia_treino;
create policy ia_treino_gerente on ia_treino
  for all to authenticated using (e_gerente()) with check (e_gerente());
