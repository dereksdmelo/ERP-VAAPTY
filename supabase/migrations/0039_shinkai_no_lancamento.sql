-- =====================================================================
-- 0039 — O Shinkai no lançamento, não só no estoque
--
-- A 0030 pendurou o resultado do envio no `estoque`, porque o botão
-- nasceu na tela de venda para lojistas. Mas o momento em que o carro
-- precisa chegar à rede é OUTRO: é o Lançamento, com o cliente sentado
-- na mesa, esperando as propostas voltarem. Ali o carro ainda não é
-- nosso — não há linha de estoque, só a ficha em avaliação.
--
-- O Derek viu em 11/09/2026: "continua aparecendo o copiar JSON do
-- Shinkai, e não enviar para o Shinkai". Ele estava no Lançamento, que
-- é exatamente onde o botão faltava.
--
-- **O Shinkai já prevê isso.** A documentação do Mateus diz que carro
-- sem valor alvo ou sem foto entra como *em avaliação* em vez de
-- *disponível* — que é precisamente o estado de um carro que foi à
-- rede para receber proposta e ainda não foi comprado. Não é desvio de
-- uso; é o uso.
--
-- As mesmas três colunas, agora no `veiculo`. Não é duplicação: o
-- carro pode ir à rede duas vezes na vida — uma para receber proposta
-- (avaliação) e outra depois de comprado (estoque) —, e são dois
-- envios com resultados diferentes que ninguém quer ver misturados.
-- =====================================================================

alter table veiculo
  add column if not exists shinkai_id     text,
  add column if not exists shinkai_status text,
  add column if not exists shinkai_em     timestamptz;

comment on column veiculo.shinkai_id is
  'Id devolvido pelo Shinkai no envio feito AINDA NA AVALIACAO, do Lancamento. O envio do carro ja comprado fica em estoque.shinkai_id.';
comment on column veiculo.shinkai_em is
  'Quando a ficha em avaliacao foi mandada a rede. Nulo e "nunca foi".';
