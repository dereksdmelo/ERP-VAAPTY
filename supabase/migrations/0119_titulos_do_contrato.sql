-- =====================================================================
-- 0119 — Os títulos da compra e da venda (07/11/2026)
--
-- O Derek: "todas as transações de compra e venda devem gerar títulos
-- financeiros de cada um dos itens financeiros adicionados nos
-- contratos. Os mesmos devem ser identificados um a um no extrato
-- depois, na conciliação."
--
-- `item_contrato` diz de que item do contrato o título nasceu:
--   compra:cliente      o valor líquido ao cliente
--   custo:<id>          cada linha de custo do carro (quitação, débitos,
--                       cautelar, outros) — a mesma `estoque_custo`
--   venda:lojista       o que o lojista paga
-- Um por carro por item, enquanto não cancelado: é o que impede gerar
-- de novo. Quando o título é ligado à linha do banco, a linha herda o
-- item (o título fica cancelado), e o índice continua valendo para ela.
-- =====================================================================

alter table fin_lancamento add column if not exists item_contrato text;
create unique index if not exists fin_lancamento_item_contrato
  on fin_lancamento (estoque_id, item_contrato)
  where item_contrato is not null and situacao <> 'cancelado';
