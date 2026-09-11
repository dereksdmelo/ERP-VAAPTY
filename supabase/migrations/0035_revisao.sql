-- =====================================================================
-- 0035 — A revisão do gestor, com feedback por atendimento
--
-- O painel nasceu olhando só o que está acontecendo agora, e o Derek
-- viu o buraco no primeiro uso: um negócio já marcado como FECHADO
-- continuava na lista de "em andamento". E apontou o que falta do
-- outro lado — **todo atendimento merece passar pelo gestor depois**,
-- com um retorno para o negociador. Acompanhar ao vivo ajuda um
-- atendimento; revisar depois ensina o próximo.
--
-- **Tabela à parte, e não coluna em `atendimento`.** A política da
-- 0004 deixa o próprio negociador editar o atendimento dele — e
-- feedback que a pessoa avaliada pode reescrever não é feedback.
-- Aqui quem escreve é o gerente, e só ele.
--
-- Sem linha = ainda não revisado. Não existe estado "pendente"
-- gravado: pendência é ausência, e guardar uma linha vazia para cada
-- atendimento criaria 89 registros por mês dizendo "nada aconteceu".
-- =====================================================================

create table revisao (
  atendimento_id uuid primary key references atendimento(id) on delete cascade,

  feedback text not null,
  revisado_por uuid references perfil(id),
  revisado_em  timestamptz not null default now(),

  -- Quando o negociador abriu e leu. Sem isto, "dei o retorno" e "ele
  -- viu o retorno" viram a mesma coisa — e não são.
  lida_em timestamptz
);

create index revisao_revisado_em_idx on revisao (revisado_em desc);

alter table revisao enable row level security;

-- Lê quem escreveu e quem foi avaliado.
create policy revisao_le on revisao
  for select to authenticated using (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = revisao.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)
    )
  );

-- Escreve só o gerente. É o ponto inteiro da tabela.
create policy revisao_escreve on revisao
  for all to authenticated using (e_gerente()) with check (e_gerente());

-- ---------------------------------------------------------------------
-- Marcar como lido é do avaliado, e só isso.
--
-- Mesma solução da 0032: RLS não separa coluna, e abrir `update` para
-- o negociador deixaria ele reescrever o próprio feedback.
-- ---------------------------------------------------------------------
create or replace function marcar_feedback_lido(alvo uuid)
returns void as $$
  update revisao set lida_em = now()
   where atendimento_id = alvo
     and lida_em is null
     and exists (
       select 1 from atendimento a
        where a.id = alvo
          and (a.negociador_id = auth.uid() or a.negociador_id is null)
     );
$$ language sql security definer set search_path = public, pg_temp;

revoke all on function marcar_feedback_lido(uuid) from public;
grant execute on function marcar_feedback_lido(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- As etapas que o negociador fechou, espelhadas junto.
--
-- O gestor não quer ler a transcrição inteira: quer saber se o
-- processo foi seguido. E isso o sistema já sabe — `etapaConcluida()`
-- decide, etapa por etapa, na tela do negociador. O espelho manda o
-- RESULTADO dela em vez de a regra ser reescrita no servidor: duas
-- implementações da mesma regra divergem no primeiro ajuste, e aí o
-- painel passa a cobrar coisa que a tela não pede.
-- ---------------------------------------------------------------------
alter table negociacao_viva
  add column if not exists etapas_ok jsonb not null default '[]'::jsonb;

comment on column negociacao_viva.etapas_ok is
  'Ids das etapas do APONTE que `etapaConcluida()` deu por fechadas. Resultado, não regra.';
