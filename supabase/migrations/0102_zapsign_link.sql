-- =====================================================================
-- 0102 — O link do ZapSign fica guardado, e o formato em que foi
--
-- A Schell, em 03/11/2026: "a cliente falou que não achou o link, o
-- Marcos foi lá e reenviou novamente sozinho… ele cria outro documento
-- no ZapSign toda vez que coloca para enviar… no pré ele aparece o link
-- para reenvio, no contrato não aparece o link para copiar". O envio só
-- guardava o token; o link aparecia uma vez, na mensagem da tela, e
-- sumia — reenviar era o único jeito de achar de novo.
--
-- `contrato_zapsign_formato` diz se foi PDF (formatado, com a assinatura
-- no lugar) ou texto simples (a versão antiga, ou o PDF que falhou no
-- aparelho). Sem isso, "não resolveu" não diz qual dos dois chegou lá.
-- =====================================================================

alter table atendimento
  add column if not exists contrato_zapsign_link    text,
  add column if not exists contrato_zapsign_formato text;
