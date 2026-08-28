-- =====================================================================
-- 0009 — os status que a casa usa de verdade
--
-- A 0004 tinha cinco status que eu deduzi da planilha de 2022:
-- aberto, aguardando_propostas, em_negociacao, fechado, perdido.
-- A lista real são quinze, e várias descrevem coisas que os cinco não
-- distinguiam — "vendeu fora" não é a mesma perda que "restrição", e
-- "perseguir" pede ação enquanto "vai voltar" pede espera.
--
-- Os cinco antigos ficam: enum não perde valor sem recriar a coluna, e
-- os 262 atendimentos importados já estão gravados com eles.
-- ATENDIMENTO IMPORTADO CONTINUA COMO 'aberto' — a reimportação com o
-- mapa de status certo é o que corrige aquilo.
-- =====================================================================

alter type status_atendimento add value if not exists 'cliente_na_loja';
alter type status_atendimento add value if not exists 'aguardando';
alter type status_atendimento add value if not exists 'baixar_expectativa';
alter type status_atendimento add value if not exists 'vai_voltar';
alter type status_atendimento add value if not exists 'consignado';
alter type status_atendimento add value if not exists 'vendeu_fora';
alter type status_atendimento add value if not exists 'perseguir';
alter type status_atendimento add value if not exists 'nao_avaliou';
alter type status_atendimento add value if not exists 'nao_lancado';
alter type status_atendimento add value if not exists 'falta_proposta';
alter type status_atendimento add value if not exists 'quitacao_futura';
alter type status_atendimento add value if not exists 'rescisao';
alter type status_atendimento add value if not exists 'restricao';
