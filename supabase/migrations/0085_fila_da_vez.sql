-- =====================================================================
-- 0085 — A fila da vez: quem está na loja, e quem está atendendo
--
-- O Derek, em 28/10/2026: a ordem de quem atende o próximo cliente é
-- o ÍNDICE AT (conversão × SCORE × vendas × 10, a conta da planilha —
-- regras/indice-at.js), mas só entre quem está NA LOJA. *"Eles têm
-- que marcar que estão na loja de manhã."* Quem está em atendimento é
-- pulado — a não ser que estejam todos atendendo, e aí o primeiro da
-- ordem pega o segundo cliente.
--
-- Esta migração dá as duas coisas que o sistema não sabia:
--
--   1. PRESENÇA, uma linha por pessoa por dia. É de quem tem LOGIN
--      (`perfil`), porque é a própria pessoa que marca — e a vez é de
--      quem atende, que é quem tem login (0080). A meta (`negociador`)
--      entra pela ligação `perfil_id`, para achar a confiabilidade.
--      `saiu_em` existe porque ir embora às 16h tira a pessoa da fila;
--      voltar do almoço apaga o `saiu_em` em vez de criar linha nova.
--
--   2. O FIM DO ATENDIMENTO. "Em atendimento" é o atendimento de hoje,
--      dele, num status de quem ainda está na mesa — mas status
--      esquecido deixaria a pessoa pulada o dia inteiro. Então há o
--      "Terminei" (`atendimento_fim_em`), e a fila ainda solta sozinha
--      quem está ocupado há mais de três horas (decisão 67).
-- =====================================================================

create table if not exists presenca (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid not null references perfil(id) on delete cascade,
  -- O dia de Joinville, não o de Greenwich: das 21h à meia-noite o UTC
  -- já virou, e a presença de hoje cairia em amanhã (decisão 22).
  dia        date not null,
  chegou_em  timestamptz not null default now(),
  saiu_em    timestamptz,
  -- Quem marcou: a própria pessoa, ou o gerente por ela.
  marcado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists presenca_unica on presenca (perfil_id, dia);

alter table presenca enable row level security;

-- A equipe lê: a fila é de todos, e é ela que diz "a vez é do Tiago".
drop policy if exists presenca_leitura on presenca;
create policy presenca_leitura on presenca
  for select to authenticated using (e_equipe());

-- Escreve a própria presença; o gerente escreve a de qualquer um (quem
-- esqueceu de marcar e já está atendendo).
drop policy if exists presenca_escrita on presenca;
create policy presenca_escrita on presenca
  for all to authenticated
  using (perfil_id = auth.uid() or e_gerente())
  with check (perfil_id = auth.uid() or e_gerente());

alter table atendimento add column if not exists atendimento_fim_em timestamptz;
