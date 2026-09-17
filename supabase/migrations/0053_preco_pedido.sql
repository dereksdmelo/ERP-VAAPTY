-- =====================================================================
-- 0053 — A PEDIDA: o que a Vaapty pede ao lojista
--
-- A ficha do Shinkai tem, no bloco VALORES, um campo **PEDIDA**. Ele
-- estava R$ 0 em todos os carros porque nunca saiu daqui: a tela tinha
-- `pedida` no objeto da ficha desde sempre e **nunca o gravava** — sem
-- campo, sem coluna, sem entrada em `FONTE`. Morria no aparelho.
--
-- **Não é o mesmo número que `valor_por`.** O POR é o que se quer ver
-- voltar da rede, e é ele que vai ao Shinkai como `valor_investimento`
-- (conferido em 17/09/2026: aparece como "POR" no descritivo deles). A
-- PEDIDA é o que se pede ao lojista, e pode estar acima. Dois números,
-- dois campos na tela deles, dois aqui.
--
-- **O nome é o mesmo de `estoque.preco_pedido` (0019) de propósito.** É
-- a mesma pergunta em dois momentos do carro: quanto pedimos por ele.
-- No estoque o carro já é nosso; aqui ainda está em avaliação. O envio
-- ao Shinkai usa a do estoque quando existe e esta quando não —
-- mesmo par do `valor_compra`/`valor_por`.
-- =====================================================================

alter table veiculo add column if not exists preco_pedido numeric(12,2);

comment on column veiculo.preco_pedido is
  'O que a Vaapty pede ao lojista por este carro. Vai ao Shinkai como `pedida`. Diferente de `valor_por`, que é o alvo e vira o POR de lá.';
