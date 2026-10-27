-- =====================================================================
-- 0081 — O combinado de remuneração, na ficha do colaborador
--
-- O Derek, em 27/10/2026: anotar na ficha o formato do combinado de
-- cada um — fixo, variável fixo, variável por faixa, das vendas
-- próprias, das vendas da loja, bônus de conversão, de rentabilidade,
-- de ticket médio e por faixa de lucro da loja — e ver no DRE quanto
-- cada um ganharia com o resultado do mês até ali.
--
-- **jsonb, uma lista de peças** (`regras/remuneracao.js`): cada combinado
-- é diferente, e coluna por peça seria um esquema novo a cada conversa
-- de salário. A RLS é a da 0079 (`e_financeiro()`): salário de colega
-- não é coisa que a equipe lê.
-- =====================================================================

alter table colaborador add column if not exists remuneracao jsonb not null default '{}'::jsonb;
