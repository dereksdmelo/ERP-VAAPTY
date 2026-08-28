-- =====================================================================
-- 0006 — atendimento pode não ter data
--
-- A 0004 criou `data` como not null com default current_date. Faz
-- sentido para atendimento novo: quem abre hoje, é hoje.
--
-- Só que a importação da planilha manda null quando a data está
-- quebrada — "06/052022", "18/05/0202" — e o default não salva, porque
-- ele só vale quando a coluna é OMITIDA, não quando vem null explícito.
-- Uma linha ilegível em 262 derrubava o lote inteiro.
--
-- Entre inventar um dia e aceitar linha sem data, a segunda é menos
-- pior: linha sem data simplesmente não entra em nenhum mês do funil,
-- e é isso que se quer de um registro cuja data ninguém sabe.
-- =====================================================================

alter table atendimento alter column data drop not null;
