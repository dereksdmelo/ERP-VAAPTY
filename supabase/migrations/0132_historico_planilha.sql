-- 0132 — O histórico da planilha "Controle Financeiro Completo" (08/11/2026, o Derek: "faça os dados do
-- ANO baterem com esses aqui, sagradinho, até SET 2026"). Até setembro de 2026 o Ano lê ESTES números,
-- mês a mês, mapeados para os grupos do plano de contas (0129); de outubro em diante, o sistema.
-- grupo: receita | 2..8 (grupos do plano) | veiculos | retirada (por sócio) | acumulado | conferencia.
-- Em 2025, de julho a dezembro, a planilha lançou a distribuição aos sócios como despesa ("Pró-Labore
-- … distribuição"); aqui ela é RETIRADA — o resultado do mês sobe e a retirada sobe igual, e o acumulado
-- é o mesmo da planilha.
create table if not exists fin_historico (
  competencia date not null, grupo text not null, linha text not null, valor numeric(14,2) not null,
  primary key (competencia, grupo, linha)
);
alter table fin_historico enable row level security;
drop policy if exists fin_historico_acesso on fin_historico;
create policy fin_historico_acesso on fin_historico for all to authenticated using (e_financeiro()) with check (e_financeiro());
-- Os VALORES (814, de jan/2025 a set/2026) foram carregados direto no banco a partir da planilha em
-- 08/11/2026 e NÃO ficam no repositório: são números financeiros da empresa. Para recarregar, refaça a
-- leitura da planilha (abas FLUXO DE CAIXA 2025 e 2026) — o mapeamento linha → grupo está descrito no
-- CLAUDE.md, decisão do Ano.
insert into schema_migrations(arquivo) values ('0132_historico_planilha.sql') on conflict do nothing;
