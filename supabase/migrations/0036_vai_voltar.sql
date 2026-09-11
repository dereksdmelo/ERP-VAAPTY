-- =====================================================================
-- 0036 — "Vai voltar" sem data é promessa que ninguém cobra
--
-- É o segundo status mais comum da planilha, e o único que carrega um
-- compromisso: o cliente disse que volta. Sem a data, ninguém sabe
-- quando cobrar — e o atendimento morre de morte natural na lista.
--
-- A data mora no `atendimento` e não numa tabela à parte porque é
-- atributo do atendimento, como `valor_fechado`: uma por linha, e
-- muda quando o cliente remarca.
-- =====================================================================

alter table atendimento
  add column if not exists volta_em date;

comment on column atendimento.volta_em is
  'Quando o cliente disse que volta. Só faz sentido com status vai_voltar; é o que o painel do gestor cobra.';

-- O painel pergunta "quem prometeu voltar e já passou da data".
create index if not exists atendimento_volta_idx
  on atendimento (volta_em) where volta_em is not null;
