-- =====================================================================
-- 0027 — O check list de documentações, a folha que fica no envelope
--
-- É a folha que o Derek fotografou: depois que o carro fecha, o
-- administrativo confere 36 itens, e cada um recebe três vistos —
-- administrativo, gerência e financeiro. Alguns itens só se resolvem
-- em sites de fora (Detran, PRF, PGFN, ConsultCenter).
--
-- **Uma linha por item, não um blob.** São 36 itens × 3 vistos; num
-- jsonb, "quem marcou dívida ativa e quando" viraria arqueologia, e
-- "quais carros estão parados esperando o dossiê" seria impossível de
-- consultar. Linha por item também deixa o histórico de graça.
--
-- **O visto é boolean NULO, não falso.** No papel são duas caixinhas,
-- Sim e Não: "não respondido" e "Não" são estados diferentes, e tratar
-- os dois como false esconderia o que ainda falta conferir.
-- =====================================================================

create table checklist_doc (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references atendimento(id) on delete cascade,

  -- O código do item. A lista mora no código, não no banco: ela muda
  -- quando a casa muda o processo, e migração para acrescentar linha de
  -- conferência seria atrito à toa.
  item text not null,

  adm         boolean,
  adm_por     uuid references perfil(id),
  adm_em      timestamptz,
  gerencia     boolean,
  gerencia_por uuid references perfil(id),
  gerencia_em  timestamptz,
  financeiro     boolean,
  financeiro_por uuid references perfil(id),
  financeiro_em  timestamptz,

  observacao text,
  atualizado_em timestamptz not null default now(),

  unique (atendimento_id, item)
);

create index checklist_doc_at_idx on checklist_doc (atendimento_id);
-- A fila do administrativo pergunta "o que falta": item sem visto.
create index checklist_doc_pendente_idx on checklist_doc (item) where adm is null;

alter table checklist_doc enable row level security;

-- Mesma regra do checklist da 0008: a equipe lê e escreve, e quem pode
-- dar o visto é conferido no servidor, não aqui — a RLS não sabe
-- separar coluna.
create policy checklist_doc_leitura on checklist_doc
  for select to authenticated using (e_equipe());
create policy checklist_doc_escreve on checklist_doc
  for insert to authenticated with check (e_equipe());
create policy checklist_doc_edita on checklist_doc
  for update to authenticated using (e_equipe()) with check (e_equipe());
create policy checklist_doc_apaga on checklist_doc
  for delete to authenticated using (e_gerente());
