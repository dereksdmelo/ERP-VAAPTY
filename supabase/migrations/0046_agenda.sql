-- =====================================================================
-- 0046 — A agenda do negociador: a folha de bordo do dia
--
-- O Derek fotografou em 14/09/2026 a folha que o negociador preenche à
-- mão: hora a hora, o que ele fez no dia.
--
--   11:03  Whats recuperação
--   11:18  Jair — Recuperação — Whats
--   11:40  Almoço — início
--   12:00  Atendimento — início
--   12:59  Consegui um agendamento de recuperação
--   13:06  Ligação com Douglas
--   16:01  Atendimento finalizado — carro consignado
--
-- É o dia inteiro numa coluna, e hoje isso some com o papel. O pedido:
-- planejar o dia e a semana, ver os atendimentos marcados sozinhos, e
-- poder acrescentar ação no meio.
--
-- **Plano e realizado são a MESMA linha, e é isso que faz a tela
-- funcionar.** Uma ação nasce planejada (`feito_em` nulo) e ganha a
-- marca quando acontece. Duas tabelas — uma de plano e outra de
-- registro — obrigariam a decidir, a cada item, se aquilo que foi
-- feito era o que estava planejado; e a resposta certa ("era, com
-- meia hora de atraso") não cabe em nenhuma das duas.
--
-- **O atendimento NÃO vira linha aqui.** Ele já existe, com hora de
-- criação e status; copiá-lo para cá criaria uma segunda verdade que
-- envelhece no minuto seguinte — o negócio muda de status e a agenda
-- continua dizendo o que era antes. A tela mescla as duas fontes na
-- hora de desenhar, como o painel do gestor faz com a negociação viva.
-- **Quem "simplificar" isso gravando o atendimento na agenda está
-- criando o problema que esta linha evita.**
-- =====================================================================

create table agenda (
  id uuid primary key default gen_random_uuid(),

  -- De quem é o dia. `perfil`, não `negociador`: a agenda é de quem
  -- entra no sistema — é o mesmo cuidado que a FK do atendimento
  -- cobrou em 12/09/2026.
  perfil_id uuid not null references perfil(id) on delete cascade,

  dia  date not null,
  -- `hora` nula é item do plano que ainda não tem horário: "hoje eu
  -- preciso ligar para o Douglas", sem dizer quando.
  hora time,
  -- Só o que tem duração usa: almoço, ligação, reunião. O resto é um
  -- instante, como na folha.
  fim  time,

  tipo   text not null default 'outro',
  titulo text not null,

  -- Quando a ação é sobre um negócio específico, o vínculo fica aqui —
  -- e é `set null` porque a ação aconteceu mesmo que o atendimento
  -- seja apagado depois.
  atendimento_id uuid references atendimento(id) on delete set null,

  -- Nulo = planejado. Preenchido = aconteceu, e a que horas se soube.
  feito_em timestamptz,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint agenda_tipo_valido check (tipo in (
    'atendimento', 'recuperacao', 'prospeccao', 'ligacao',
    'reuniao', 'almoco', 'pausa', 'outro'
  )),
  -- Fim antes do início é erro de digitação, e vira duração negativa
  -- em toda soma que a tela fizer.
  constraint agenda_fim_depois check (fim is null or hora is null or fim >= hora)
);

comment on table agenda is
  'A folha de bordo do dia do negociador. Plano e realizado na mesma linha: feito_em nulo e plano.';

-- "O dia do fulano" é a única pergunta que esta tabela responde.
create index agenda_dia_idx on agenda (perfil_id, dia, hora);

create trigger agenda_atualizado
  before update on agenda
  for each row execute function toca_atualizado_em();

-- ---------------------------------------------------------------------
-- A agenda é pessoal, e o gerente vê todas
--
-- Ler o dia do colega não é o que esta tabela existe para permitir —
-- mesma régua da `negociacao_viva` (0033). O gerente vê tudo porque
-- cobrar o ritmo da equipe é o trabalho dele.
-- ---------------------------------------------------------------------
alter table agenda enable row level security;

create policy agenda_le on agenda
  for select to authenticated
  using (e_gerente() or perfil_id = auth.uid());

-- Escrever é só do dono, inclusive para o gerente: agenda preenchida
-- por outra pessoa deixa de ser o registro de quem viveu o dia.
create policy agenda_escreve on agenda
  for all to authenticated
  using (e_equipe() and perfil_id = auth.uid())
  with check (e_equipe() and perfil_id = auth.uid());
