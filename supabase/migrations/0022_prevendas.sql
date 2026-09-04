-- =====================================================================
-- 0022 — Pré-vendas: do telefone tocando ao cliente sentado na mesa
--
-- O funil da pré-venda tinha duas metades soltas. Os leads de indicação
-- (0011) eram só uma origem entre várias, e o agendamento não existia
-- em lugar nenhum — era WhatsApp e cabeça. Quando o cliente chegava, o
-- negociador redigitava nome, telefone e carro que a pré-venda já tinha
-- perguntado ao telefone.
--
-- **O lead e o agendamento são a mesma linha.** Um agendamento é um
-- lead que ganhou data e hora. Duas tabelas obrigariam a um join em
-- toda tela e a decidir, a cada remarcação, se nasce agendamento novo
-- ou se o velho muda — e nenhuma das duas respostas ajuda quem está
-- com o telefone na orelha.
--
-- O histórico de remarcação fica em `remarcacoes` (jsonb), como as
-- `revisoes` da cautelar: quantas vezes um cliente remarcou é o que
-- diz se ele vem mesmo, e some se só a última data for guardada.
-- =====================================================================

create type lead_status as enum (
  'novo',            -- entrou e ninguém falou com ele ainda
  'em_contato',      -- falou ou tentou, sem data
  'agendado',        -- tem dia e hora
  'confirmado',      -- disse que vem
  'compareceu',      -- chegou; virou atendimento
  'nao_compareceu',  -- não veio
  'perdido'          -- sem interesse
);

create table lead (
  id uuid primary key default gen_random_uuid(),

  nome     text not null,
  telefone text,
  carro    text,                       -- o que ele tem para vender
  origem   origem_atendimento not null default 'outro',

  status lead_status not null default 'novo',

  -- ---- o agendamento ----
  -- timestamptz porque a hora importa: "quinta 14h" é a informação.
  agendado_para   timestamptz,
  negociador_id   uuid references negociador(id),
  negociador_nome text,

  confirmado_em  timestamptz,
  confirmado_por uuid references perfil(id),

  -- [{ de: timestamptz, para: timestamptz, em: timestamptz, motivo: text }]
  remarcacoes jsonb not null default '[]',

  -- ---- quem trabalhou ----
  prospector_id   uuid references perfil(id),
  prospector_nome text,

  -- ---- de onde veio, para onde foi ----
  -- `set null` nos dois: o lead sobrevive ao que o originou e ao que
  -- ele virou, como a indicação da 0011.
  indicacao_id   uuid references indicacao(id) on delete set null,
  atendimento_id uuid references atendimento(id) on delete set null,

  proximo_contato date,        -- a fila de retorno de quem não agendou
  observacoes     text,

  criado_por    uuid default auth.uid(),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table lead is
  'Funil de pré-vendas. Um agendamento é um lead com agendado_para preenchido.';
comment on column lead.remarcacoes is
  'Histórico de remarcação: quantas vezes remarcou diz se o cliente vem mesmo.';

-- A agenda é lida por dia o tempo todo; o funil, por status.
create index lead_agenda_idx on lead (agendado_para)
  where status in ('agendado', 'confirmado');
create index lead_status_idx on lead (status, criado_em desc);
create index lead_retorno_idx on lead (proximo_contato)
  where status in ('novo', 'em_contato');
create index lead_telefone_idx on lead (telefone);

create trigger lead_atualizado
  before update on lead
  for each row execute function toca_atualizado_em();

-- Mesma regra da indicação: a equipe lê, cria e edita; só gerente
-- apaga. Políticas separadas por comando de propósito — um `for all`
-- daria delete a todo mundo, porque políticas permissivas se somam.
alter table lead enable row level security;

drop policy if exists lead_leitura on lead;
create policy lead_leitura on lead
  for select to authenticated using (e_equipe());

drop policy if exists lead_criar on lead;
create policy lead_criar on lead
  for insert to authenticated with check (e_equipe());

drop policy if exists lead_editar on lead;
create policy lead_editar on lead
  for update to authenticated using (e_equipe()) with check (e_equipe());

drop policy if exists lead_apagar on lead;
create policy lead_apagar on lead
  for delete to authenticated using (e_gerente());
