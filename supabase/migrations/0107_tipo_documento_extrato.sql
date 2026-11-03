-- =====================================================================
-- 0107 — O extrato de ofertas nunca coube no registro de documentos
--
-- 03/11/2026, na tela do Edson: "invalid input value for enum
-- tipo_documento: extrato_ofertas". A tela grava cada extrato impresso
-- em `documento` (decisão 15) desde a decisão 16, e o enum da 0003 nunca
-- ganhou o valor: todo extrato ficava "fora do banco", sem protocolo no
-- registro — e o erro só passou a aparecer quando a tela começou a
-- mostrá-lo. Os três que a tela usa e o enum não tinha.
--
-- `add value` não pode ser usado na mesma transação em que é criado
-- (decisão 19): rodar sozinho, sem nada depois.
-- =====================================================================

alter type tipo_documento add value if not exists 'extrato_ofertas';
alter type tipo_documento add value if not exists 'extrato_revisao';
alter type tipo_documento add value if not exists 'contrato_final';
