-- =====================================================================
-- 0033 — O painel do gestor: a negociação viva sai do aparelho
--
-- Até aqui o gerente só via o resultado: status, valor fechado, os
-- documentos gerados. O que acontece DURANTE — em que etapa o
-- negociador está, quanto ele imprimiu, o que o cliente contrapôs, o
-- que está sendo dito na mesa — vivia só no `localStorage` do celular
-- dele. Não dava para ajudar a tempo, que é a única hora em que ajudar
-- serve para alguma coisa.
--
-- **Isto muda o que sai do aparelho.** A transcrição passa a existir no
-- servidor. O aceite que o cliente dá (decisão 17) fala em transcrever
-- a conversa e em não gravar áudio, e não promete que o texto fique no
-- celular — mas a frase lida em voz alta ganhou "e fica registrada no
-- sistema da loja", porque dizer menos do que se faz é o começo de um
-- problema.
--
-- **Uma linha por atendimento, sobrescrita.** Não é histórico: é o
-- estado de agora. Histórico de rodada já existe em `documento`, com
-- protocolo, e histórico de status no `fin_log` do financeiro. Guardar
-- cada tecla digitada encheria a tabela para responder pergunta que
-- ninguém faz.
-- =====================================================================

create table negociacao_viva (
  atendimento_id uuid primary key references atendimento(id) on delete cascade,

  -- Em que passo do APONTE o negociador está agora.
  etapa text,

  -- As rodadas como a tela as guarda: [{impresso, contra, em}].
  -- jsonb e não tabela porque ninguém consulta rodada isolada — o que
  -- se olha é a sequência inteira, e ela vem e vai junto.
  rodadas jsonb not null default '[]'::jsonb,

  -- O que foi digitado no fechamento, para o gestor ver o número antes
  -- de ele virar contrato.
  valor_fechado numeric(12,2),
  objecao text,

  -- A escuta. `escuta_ok` sem `transcricao` é conversa autorizada e
  -- ainda sem fala; os dois nulos é microfone desligado.
  escuta_ok  boolean not null default false,
  escuta_em  timestamptz,
  transcricao text,

  atualizado_em timestamptz not null default now()
);

comment on table negociacao_viva is
  'Estado ATUAL da negociação aberta, espelhado do aparelho do negociador. Sobrescrito, não acumulado.';

-- ---------------------------------------------------------------------
-- Quem lê a transcrição
--
-- Não é `e_equipe()`. O CRM inteiro é aberto para a equipe (0004)
-- porque a planilha era, mas a conversa de um cliente com um
-- negociador é outra coisa: **gerente, e o dono do atendimento.** Ler
-- a mesa do colega não é o que esta tabela existe para permitir.
-- ---------------------------------------------------------------------
alter table negociacao_viva enable row level security;

-- A forma é a MESMA da `atendimento_editar` (0004), inclusive o
-- `is null`: atendimento criado pela pré-venda nasce sem dono, e uma
-- regra mais estreita aqui faria o espelho falhar calado justamente
-- nos atendimentos que vêm do agendamento.
create policy negociacao_viva_le on negociacao_viva
  for select to authenticated using (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = negociacao_viva.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)
    )
  );

-- Escrever é só de quem está conduzindo: o espelho vem do aparelho
-- dele, e gerente digitando aqui criaria um estado que a tela do
-- negociador sobrescreveria no segundo seguinte.
create policy negociacao_viva_escreve on negociacao_viva
  for all to authenticated using (
    e_equipe() and exists (
      select 1 from atendimento a
       where a.id = negociacao_viva.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null))
  ) with check (
    e_equipe() and exists (
      select 1 from atendimento a
       where a.id = negociacao_viva.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null))
  );

-- ---------------------------------------------------------------------
-- O recado do gestor
--
-- Mensagem é evento: linha por linha, nunca sobrescrita. É o oposto da
-- tabela acima, e de propósito — "o que foi dito" precisa de ordem e
-- de histórico; "onde ele está agora" não.
-- ---------------------------------------------------------------------
create table mensagem (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references atendimento(id) on delete cascade,

  de   uuid not null references perfil(id),
  texto text not null,

  criado_em timestamptz not null default now(),
  -- Quem leu, não quando cada um leu: a conversa é de dois.
  lida_em   timestamptz
);

create index mensagem_atendimento_idx on mensagem (atendimento_id, criado_em);
-- "Tem recado sem ler?" é a pergunta que a tela faz o tempo todo.
create index mensagem_nao_lida_idx on mensagem (atendimento_id) where lida_em is null;

alter table mensagem enable row level security;

create policy mensagem_le on mensagem
  for select to authenticated using (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = mensagem.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)
    )
  );

-- Escreve quem participa, e `de` é conferido: sem isso alguém manda
-- recado assinado por outro.
create policy mensagem_escreve on mensagem
  for insert to authenticated with check (
    de = auth.uid() and (
      e_gerente() or exists (
        select 1 from atendimento a
         where a.id = mensagem.atendimento_id
           and (a.negociador_id = auth.uid() or a.negociador_id is null)
      )
    )
  );

-- Marcar como lida é dos dois lados; o texto ninguém edita.
create policy mensagem_marca_lida on mensagem
  for update to authenticated using (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = mensagem.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)
    )
  ) with check (true);
