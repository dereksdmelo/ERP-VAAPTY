-- =====================================================================
-- 0030 — O carro enviado ao Shinkai
--
-- Até aqui "levar para o Shinkai" era copiar um JSON e colar no painel.
-- Agora existe API (POST /api/public/veiculo), e o envio precisa deixar
-- rastro: sem ele, ninguém sabe se o carro já está lá, e reenviar vira
-- adivinhação.
--
-- Reenviar a mesma placa **atualiza** o carro do lado deles, não cria
-- outro — então o botão pode ser apertado de novo a cada edição, e o
-- que se guarda aqui é o último resultado, não uma fila de eventos.
-- =====================================================================

alter table estoque
  add column if not exists shinkai_id     text,
  add column if not exists shinkai_status text,
  add column if not exists shinkai_em     timestamptz;

comment on column estoque.shinkai_id is
  'id do veículo no Shinkai, devolvido pelo POST. Prova de que o carro está lá.';
comment on column estoque.shinkai_status is
  'Como o carro entrou lá: disponivel (tem foto e valor alvo) ou avaliacao (falta um dos dois).';
