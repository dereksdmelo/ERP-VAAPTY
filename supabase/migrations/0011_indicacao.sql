-- 0011 — leads de indicação
--
-- A etapa E já pedia as indicações, mas elas morriam no localStorage do
-- aparelho: o negociador anotava cinco nomes e ninguém nunca ligava para
-- eles. Cada linha aqui é um lead que a pré-venda pode trabalhar.
--
-- Os cinco campos são os que o Derek pediu: quem foi indicado, o
-- telefone dele, quem conseguiu a indicação, quem indicou e o telefone
-- de quem indicou.
--
-- `atendimento_id` é `set null` e não `cascade` de propósito: se um dia
-- o atendimento de origem sumir, o lead continua valendo. Por isso o
-- nome do negociador e o do cliente ficam gravados aqui em texto, e não
-- só por referência — o lead precisa se explicar sozinho.

create table if not exists indicacao (
  id                uuid primary key default gen_random_uuid(),
  atendimento_id    uuid references atendimento(id) on delete set null,

  nome              text not null,
  telefone          text,

  negociador_nome   text,
  cliente_nome      text,
  cliente_telefone  text,

  status            text not null default 'novo',
  observacoes       text,

  criado_por        uuid default auth.uid(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

-- Texto com check em vez de enum: a lista de status de lead ainda vai
-- mudar algumas vezes, e mexer em enum no Postgres custa migração.
alter table indicacao drop constraint if exists indicacao_status_ok;
alter table indicacao add constraint indicacao_status_ok
  check (status in ('novo','em_contato','agendado','virou_atendimento','sem_interesse'));

create index if not exists indicacao_status_idx on indicacao (status, criado_em desc);
create index if not exists indicacao_atendimento_idx on indicacao (atendimento_id);

-- Mesma regra do atendimento: a equipe lê, cria e edita; só gerente
-- apaga. As políticas são separadas por comando de propósito — um
-- `for all` daria delete a todo mundo, porque políticas permissivas se
-- somam em vez de se restringir.
alter table indicacao enable row level security;

drop policy if exists indicacao_leitura on indicacao;
create policy indicacao_leitura on indicacao
  for select to authenticated using (e_equipe());

drop policy if exists indicacao_criar on indicacao;
create policy indicacao_criar on indicacao
  for insert to authenticated with check (e_equipe());

drop policy if exists indicacao_editar on indicacao;
create policy indicacao_editar on indicacao
  for update to authenticated using (e_equipe()) with check (e_equipe());

drop policy if exists indicacao_apagar on indicacao;
create policy indicacao_apagar on indicacao
  for delete to authenticated using (e_gerente());
