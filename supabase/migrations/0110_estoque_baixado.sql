-- =====================================================================
-- 0110 — "Baixado": o carro que saiu antes de o sistema registrar
--
-- O Derek, em 04/11/2026: "o problema é ficar marcando como vendido os
-- carros um por um, tem muitos do passado e não temos tempo pra isso… e
-- não vai contar pra rentabilidade desse mês… só vamos começar a contar
-- a rentabilidade desse mês o que estava de fato em estoque e foi vendido
-- esse mês e o que foi uma nova negociação".
--
-- Marcar como VENDIDO pede comprador e valor, e sem a data da venda o
-- carro cai na rentabilidade do mês em que entrou — que, para o que
-- entrou hoje pela fila amarela, é este mês. Apagar some com o
-- histórico. "Baixado" é a terceira coisa: saiu do pátio, sem venda
-- registrada, e não conta em lugar nenhum (rentabilidade, recebimentos,
-- transferências, meta) — que só olham `vendido`. Volta para o pátio
-- com um clique, se alguém baixou errado.
-- =====================================================================

alter type estoque_situacao add value if not exists 'baixado';
-- (rodar sozinho; depois:)
alter table estoque add column if not exists baixado_em timestamptz;
