-- =====================================================================
-- 0118 — A previsão de rentabilidade (07/11/2026)
--
-- O Derek: "ter uma opção de previsão de rentabilidade onde colocamos
-- valores prováveis de venda nos carros que estão em estoque pra
-- determinar a possível rentabilidade vendendo todos, ou só alguns…
-- às vezes já vendemos um e queremos saber quanto vai dar, mas não tem
-- contrato ainda".
--
-- `venda_prevista` é o valor provável; `venda_prevista_nota` diz de onde
-- ele vem ("vendido ao Fulano, falta contrato"). Não é venda: não muda a
-- situação do carro, não entra na Rentabilidade do mês nem no DRE — só
-- na tela da previsão. Fica no banco (e não no aparelho) porque quem
-- monta a previsão e quem a lê são pessoas diferentes.
-- =====================================================================

alter table estoque
  add column if not exists venda_prevista      numeric(12,2),
  add column if not exists venda_prevista_nota text;
