-- 0013 — a parte do dashboard que o sistema não tem como saber
--
-- A aba FLUXO X CONVERSÃO tem quatro faixas por negociador. Três o
-- servidor calcula sozinho a partir dos atendimentos: meta e realizado,
-- meta semanal, fluxo/vendas/conversão.
--
-- A quarta, CONFIABILIDADE, é observação de gestor: falta, atraso,
-- perdeu atendimento, prospectou, pediu avaliação no Google, ficou além
-- do horário, gravou vídeo, avaliação errada, postura. Nada disso
-- aparece no banco de dados de atendimento, e inventar seria pior que
-- deixar em branco. Então é digitado, uma linha por negociador por mês.
--
-- `indice_at` também entra aqui: é ajuste de gestão sobre o volume, não
-- contagem de atendimento.

create table if not exists desempenho (
  id             uuid primary key default gen_random_uuid(),
  negociador_id  uuid not null references negociador(id) on delete cascade,

  -- Primeiro dia do mês. Guardar como date em vez de texto deixa o
  -- filtro por período ser o mesmo do resto do sistema.
  competencia    date not null,

  faltas             numeric(6,2) not null default 0,
  atrasos            numeric(6,2) not null default 0,
  perdeu_atendimento numeric(6,2) not null default 0,
  prospectou         numeric(6,2) not null default 0,
  avaliacao_google   numeric(6,2) not null default 0,
  ficou_mais         numeric(6,2) not null default 0,
  gravou_video       numeric(6,2) not null default 0,
  avaliacao_errada   numeric(6,2) not null default 0,
  postura            numeric(6,2) not null default 100,
  indice_at          numeric(8,2) not null default 0,

  atualizado_em  timestamptz not null default now()
);

-- Uma linha por negociador por mês. O unique é o que deixa a gravação
-- ser upsert em vez de virar histórico duplicado a cada digitação.
create unique index if not exists desempenho_unico
  on desempenho (negociador_id, competencia);

alter table desempenho enable row level security;

-- A equipe lê — o negociador precisa ver o próprio número. Só gerente
-- escreve: é avaliação de gestão, não autoavaliação.
drop policy if exists desempenho_leitura on desempenho;
create policy desempenho_leitura on desempenho
  for select to authenticated using (e_equipe());

drop policy if exists desempenho_gerente on desempenho;
create policy desempenho_gerente on desempenho
  for all to authenticated using (e_gerente()) with check (e_gerente());
