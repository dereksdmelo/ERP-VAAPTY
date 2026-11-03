-- =====================================================================
-- 0100 — DUT: entregue por onde, e a observação que o lojista não vê
--
-- A Schell (financeiro/adm), em 03/11/2026: "referente aos DUT,
-- precisávamos separar o que foi enviado por correio, o que foi enviado
-- pelo whats e o que vai ser retirado em loja… fica tudo misturado. E
-- também não tem como observações internas: às vezes precisa segurar o
-- preenchimento, colocamos no 'falta algo', mas tem observações internas
-- que o cliente não precisa saber."
--
-- **A entrega ganha o terceiro caminho.** `envio` continua sendo o
-- correio (é o que o formulário oferece, com endereço e rastreio);
-- `whatsapp` é o documento mandado pela conversa. Quem decide é o adm,
-- no cartão.
--
-- **`obs_interna` é da equipe.** O "falta algo" (`pendencia`) aparece ao
-- lojista na consulta do protocolo e vai na mensagem automática; esta
-- coluna não entra em `dut_estado()` nem em mensagem nenhuma — mesma
-- separação do `internas` da ficha (decisão 2).
-- =====================================================================

alter type dut_entrega add value if not exists 'whatsapp';
alter table dut_pedido add column if not exists obs_interna text;
