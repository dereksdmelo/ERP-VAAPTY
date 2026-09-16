-- =====================================================================
-- 0050 — A ficha viva: o mesmo atendimento em dois aparelhos
--
-- O negociador trabalha com o celular na mão e o computador na mesa, ao
-- mesmo tempo. Até aqui o que ele digitava vivia no `localStorage`
-- daquele aparelho (decisão 10) e só chegava ao servidor quando ele
-- apertava "Salvar no banco" — e mesmo assim só a parte de VEÍCULO da
-- ficha, que é a que tem coluna (0001). O resto — as rodadas, as notas
-- da espera, os toggles do APONTE, os canais vistos — nunca saía dali.
--
-- A `negociacao_viva` (0033) já espelhava um retrato disso a cada 15 s,
-- mas de MÃO ÚNICA: subia para o painel do gestor e nunca voltava para
-- a tela. Era um relatório, não uma sincronização.
--
-- `ficha` é o estado de trabalho inteiro, do jeito que a tela o guarda.
-- Continua sendo uma linha por atendimento, sobrescrita, e continua
-- **não sendo histórico**: o histórico das rodadas está em `documento`,
-- com protocolo, e o registro estruturado do carro está em `veiculo`.
--
-- **Por que jsonb e não colunas.** Isto não é o registro do negócio; é
-- a área de trabalho de um atendimento que dura menos de uma hora.
-- Dar coluna a cada toggle do APONTE criaria um segundo esquema do
-- carro para manter em sincronia com o da 0001 — e o que se consulta
-- depois é o `veiculo`, nunca este.
--
-- **A transcrição fica na coluna dela.** Ela já existe desde a 0033 e
-- passa de 100 KB numa conversa longa; repeti-la aqui dobraria o que
-- trafega a cada volta da sincronização.
--
-- Sem mudança de RLS: as políticas da 0033 valem para a linha inteira
-- — lê o gerente e o dono do atendimento, escreve só quem conduz.
-- =====================================================================

alter table negociacao_viva add column if not exists ficha jsonb;

comment on column negociacao_viva.ficha is
  'Estado de trabalho do atendimento, como a tela o guarda. Área de trabalho compartilhada entre os aparelhos do negociador, não registro: o do carro é `veiculo`, o das rodadas é `documento`.';
