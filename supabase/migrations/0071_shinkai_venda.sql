-- =====================================================================
-- 0071 — A venda confirmada aqui sai como vendida no Shinkai
--
-- O Mateus entregou em 20/10/2026 o `POST /api/public/venda`: a mesma
-- chave da entrada de veículos, por placa, com comprador e valor — e o
-- cancelamento devolve o carro para a negociação. Até aqui a venda
-- confirmada no estoque ficava só aqui, e o carro continuava sendo
-- oferecido à rede até alguém marcar no painel deles.
--
-- O que se guarda é o ÚLTIMO resultado, como o `shinkai_*` da 0030
-- (decisão 36): o que o Shinkai fez (`acao`), por qual caminho o
-- comprador casou (`origem`: proposta do CRM, lojista da base ou por
-- fora) e os avisos. Sem isso, "já está vendido lá?" seria adivinhação,
-- e o aviso de "comprador não encontrado" sumiria ao recarregar a tela.
-- =====================================================================

alter table estoque add column if not exists shinkai_venda_acao text;
alter table estoque add column if not exists shinkai_venda_origem text;
alter table estoque add column if not exists shinkai_venda_avisos jsonb;
alter table estoque add column if not exists shinkai_venda_em timestamptz;
