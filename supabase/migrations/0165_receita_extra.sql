-- 0165 · A receita extra do carro (23/11/2026, pedido da Amanda pelo suporte, aprovado pelo Derek): o que se cobra
-- do lojista além do carro (as etiquetas) soma na rentabilidade sem entrar no contrato do cliente. Ela mora entre os
-- custos do carro com valor NEGATIVO (toda soma de custo já a desconta) e vira um título a receber (`receita:<id>`).
alter type custo_tipo add value if not exists 'receita_extra';
notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0165_receita_extra.sql') on conflict do nothing;
