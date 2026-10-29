-- =====================================================================
-- 0093 — O comunicado de venda na lista de transferências
--
-- O Derek, em 28/10/2026, na tela de Transferências: "adicionar um
-- 'comunicado venda' aqui". O comunicado de venda é o que a Vaapty faz
-- no Detran quando o lojista não transfere: tira da loja a
-- responsabilidade pelo que o carro fizer dali em diante. Ele não
-- substitui a transferência — o carro continua na lista até ser
-- transferido —, mas muda a urgência, e precisa ficar registrado com a
-- data e quem fez. Carimbado pelo servidor, como o "transferido".
-- =====================================================================

alter table estoque
  add column if not exists comunicado_em  date,
  add column if not exists comunicado_por uuid references perfil(id),
  add column if not exists comunicado_obs text;
