-- =====================================================================
-- 0003 — documentos gerados no atendimento
--
-- Registra que um documento foi gerado: qual, quando, para qual carro,
-- e o texto exato que saiu impresso.
--
-- Por que guardar o conteúdo e não só o registro: a ficha continua
-- sendo editada depois. Se amanhã alguém corrigir o KM, o pré-contrato
-- que o cliente assinou hoje não muda — e é o texto assinado que vale
-- numa discussão, não o que a ficha diz agora.
--
-- Cada geração é uma linha. Imprimir de novo é um evento novo, com
-- protocolo novo: é assim que se sabe quantas vias existem por aí.
-- =====================================================================

create type tipo_documento as enum (
  'termo_aceite',           -- uma por rodada de negociação
  'autorizacao_cautelar',
  'pre_contrato'
);

create table documento (
  id uuid primary key default gen_random_uuid(),

  veiculo_id uuid not null references veiculo(id) on delete cascade,

  tipo   tipo_documento not null,
  rodada int,               -- só o termo de aceite usa; nos outros fica nulo

  -- Impresso no rodapé da folha. É o que liga o papel na mão do
  -- cliente a esta linha do banco.
  protocolo text,

  conteudo   text,          -- o HTML como saiu, incluindo a tarja de rascunho
  negociador text,

  gerado_em timestamptz not null default now()
);

create index documento_veiculo_idx on documento (veiculo_id, gerado_em desc);

-- Sem índice único: gerar a segunda via é legítimo e precisa aparecer.

alter table documento enable row level security;
