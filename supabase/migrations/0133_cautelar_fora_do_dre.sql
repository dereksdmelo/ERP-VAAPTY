-- 0133 — A cautelar da negociação sai do DRE (08/11/2026, o Derek: "a cautelar é um custo de negociação…
-- já está prevista na planilha da rentabilidade e descontada na rentabilidade líquida; colocar novamente
-- vai duplicar. Só lançamos as cautelares que acabaram virando custo").
-- A conta "Cautelar" (com a fatura mensal da TMH e o que o cliente paga) vira "9.09 Cautelar das
-- negociações", fora do DRE. A cautelar que o cliente não pagou e não está em negociação vai na nova
-- "2.03 Cautelar que virou custo", dentro do DRE.
update fin_categoria set nome = 'Cautelar das negociações', codigo = '9.09', ordem = 9090, no_dre = false, tipo_custo = 'fora',
  pai_id = (select id from fin_categoria where codigo = '9' and pai_id is null limit 1)
 where nome = 'Cautelar';
insert into fin_categoria (nome, grupo, no_dre, ordem, ativa, pede_funcionario, tipo_custo, codigo, pai_id)
select 'Cautelar que virou custo', 'despesa', true, 2030, true, false, 'variavel', '2.03', (select id from fin_categoria where codigo = '2' and pai_id is null limit 1)
 where not exists (select 1 from fin_categoria where nome = 'Cautelar que virou custo');
insert into schema_migrations(arquivo) values ('0133_cautelar_fora_do_dre.sql') on conflict do nothing;
