-- =====================================================================
-- 0005 — o check list entra no registro de documentos
--
-- A 0003 criou três tipos: termo de aceite, autorização de cautelar e
-- pré-contrato. O check list do negócio — o papel que fecha o
-- atendimento e vai para o administrativo com valores e dados
-- bancários — é o quarto.
--
-- add value não roda dentro de transação em versões antigas do
-- Postgres; no Supabase atual roda normal pelo SQL Editor.
-- =====================================================================

alter type tipo_documento add value if not exists 'check_list';
