-- =====================================================================
-- 0094 — Arquivamento: a última etapa da esteira do negócio fechado
--
-- O Derek, em 28/10/2026: "depois de pagamento a realizar, o card vai
-- para a aba de arquivamento, ali o adm termina de adicionar todos os
-- comprovantes e arquiva. Essa aba se divide entre os que já estão
-- devidamente arquivados e os que estão em processo de arquivamento".
--
-- Como as outras etapas (0089), não é coluna de etapa: pago e não
-- arquivado é "arquivar"; com `arquivado_em`, "arquivado". Os
-- comprovantes são os itens do grupo Arquivamento do check list de
-- documentações (0091), que o gerente edita.
-- =====================================================================

alter table checklist
  add column if not exists arquivado_em  timestamptz,
  add column if not exists arquivado_por uuid references perfil(id);
