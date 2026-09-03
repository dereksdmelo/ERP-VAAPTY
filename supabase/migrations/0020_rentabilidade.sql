-- =====================================================================
-- 0020 — Rentabilidade: o que a planilha CONTROLE DE VEÍCULOS sabe e o
-- estoque ainda não sabia
--
-- A planilha de rentabilidade do Derek (03/09/2026) fecha a conta por
-- carro vendido:
--
--   bruta   = venda − valor cliente − débitos − quitação − deduções
--   líquida = bruta − cautelar − comissão externa
--
-- Isso é exatamente `venda − custo` do estoque (0019), desde que o
-- custo tenha duas linhas que não existiam: DEDUÇÕES (diferença de
-- quitação, restos) e COMISSÃO EXTERNA (paga a quem trouxe o comprador).
--
-- E a planilha atribui cada carro a negociador, meio de alcance e
-- prospector. Carro que veio de atendimento tem isso lá; carro
-- importado da planilha não tem atendimento — então fica gravado em
-- texto aqui, como o lead de indicação (0011): o carro precisa se
-- explicar sozinho.
-- =====================================================================

alter type custo_tipo add value if not exists 'deducao';
alter type custo_tipo add value if not exists 'comissao_externa';

alter table estoque
  add column if not exists negociador_nome text,
  add column if not exists meio_alcance    text,
  add column if not exists prospector      text,
  -- A planilha registra a venda pela semana do mês (1ª, 2ª, 3ª…), não
  -- pelo dia. Quando há `vendido_em`, a semana é derivada dele; a
  -- coluna existe para o que veio da planilha, que só sabe a semana.
  add column if not exists semana_venda    smallint,
  -- Do que veio da planilha, para separar do que nasceu no sistema.
  add column if not exists importado_em    timestamptz;

comment on column estoque.negociador_nome is
  'Cópia em texto: o carro vindo da planilha não tem atendimento para apontar.';
comment on column estoque.semana_venda is
  'Semana do mês da venda (1..5). Derivada de vendido_em quando ele existe.';
