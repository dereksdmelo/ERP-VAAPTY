-- 0183 — Duas observações no carro do estoque (27/11/2026, o Derek: "uma que aparece em vermelho do lado do nome do
-- carro, por exemplo 'Precisa transferir', e outra interna que fica dentro, aí tem VER OBS").
-- `aviso`: curto, em vermelho ao lado do carro na lista do Estoque e no alto da ficha.
-- `obs_interna`: texto livre, só dentro da ficha, atrás do "Ver obs".
-- `observacoes` (0019) continua sendo o que a indicação e a multa escrevem; não se mistura.
alter table public.estoque add column if not exists aviso text;
alter table public.estoque add column if not exists obs_interna text;
