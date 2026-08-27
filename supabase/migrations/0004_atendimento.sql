-- =====================================================================
-- 0004 — atendimento, propostas e papéis
--
-- Até aqui o banco só conhecia o carro. Esta migração traz o que a
-- planilha "CRM - JOINVILLE - C/ PIPELINE" registra há anos: uma linha
-- por atendimento, com quem prospectou, quem atendeu, de onde veio o
-- cliente, quanto ele pediu e o que cada lojista ofertou.
--
-- O veículo passa a ser filho do atendimento. O mesmo carro pode voltar
-- meses depois: aí é atendimento novo, linha nova, e o histórico do
-- primeiro continua de pé.
--
-- ATENÇÃO — a partir daqui o banco guarda NOME e TELEFONE de cliente.
-- Isso é dado pessoal. A RLS abaixo deixa de ser formalidade: sem ela,
-- e sem login, a carteira inteira fica legível por quem souber a URL.
-- =====================================================================

/* ---------------------------------------------------------------------
 * Quem é quem
 * ------------------------------------------------------------------ */

create type papel_usuario as enum (
  'pre_venda',    -- prospecta e agenda; é o PROSPEC da planilha
  'negociador',   -- conduz o atendimento
  'gerente',      -- vê tudo, fecha metas
  'prep'          -- prepara o carro depois da compra
);

-- Espelha auth.users. O Supabase cria o usuário; o papel é nosso.
create table perfil (
  id        uuid primary key references auth.users(id) on delete cascade,
  nome      text not null,
  papel     papel_usuario not null default 'negociador',
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- security definer para não cair em recursão: a política de perfil
-- consulta estas funções, que consultam perfil. O search_path fixo
-- fecha a porta de sequestro de esquema.
create or replace function papel_atual()
returns papel_usuario as $$
  select papel from perfil where id = auth.uid() and ativo;
$$ language sql stable security definer set search_path = public, pg_temp;

create or replace function e_gerente()
returns boolean as $$
  select coalesce(papel_atual() = 'gerente', false);
$$ language sql stable security definer set search_path = public, pg_temp;

-- Ter login não basta: é preciso ter perfil ativo. Sem isto, qualquer
-- conta criada no Supabase — inclusive por cadastro aberto — leria
-- nome e telefone de todos os clientes.
create or replace function e_equipe()
returns boolean as $$
  select exists (select 1 from perfil where id = auth.uid() and ativo);
$$ language sql stable security definer set search_path = public, pg_temp;

-- Conta nova entra desativada, e o gerente libera. É o oposto do
-- padrão do Supabase, onde quem se cadastra já entra valendo.
create or replace function ao_criar_usuario()
returns trigger as $$
begin
  insert into perfil (id, nome, papel, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)),
    'negociador',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create trigger usuario_criado
  after insert on auth.users
  for each row execute function ao_criar_usuario();

/* ---------------------------------------------------------------------
 * O atendimento
 * ------------------------------------------------------------------ */

-- Os nove valores que a coluna ORIGEM usa na planilha.
create type origem_atendimento as enum (
  'fluxo_loja', 'prospeccao', 'indicacao', 'tv', 'google',
  'facebook', 'outdoor', 'recuperacao', 'faceleads', 'outro'
);

-- Os quatro da coluna STATUS, mais 'aberto' para o atendimento que
-- ainda está acontecendo na mesa — a planilha não tinha esse estado
-- porque era preenchida depois do fato.
create type status_atendimento as enum (
  'aberto', 'aguardando_propostas', 'em_negociacao', 'fechado', 'perdido'
);

create table atendimento (
  id   uuid primary key default gen_random_uuid(),
  data date not null default current_date,

  -- Dois nomes, não um: quem prospectou e quem atendeu são pessoas
  -- diferentes, e a comissão é dos dois. Na planilha, PROSPEC vira
  -- "FLUXO" quando o cliente entrou pela porta sozinho.
  negociador_id   uuid references perfil(id),
  negociador_nome text,          -- texto livre: nem todo negociador terá login
  prospec         text,

  -- Dado pessoal. Nada disso sai da loja.
  cliente_nome     text,
  cliente_telefone text,

  origem origem_atendimento not null default 'fluxo_loja',
  status status_atendimento not null default 'aberto',

  -- A planilha tem CARRO em texto livre ("PEUGEOT", "FORD KA") e boa
  -- parte das linhas não tem placa. Sem este campo, essas linhas não
  -- teriam como ser importadas.
  carro_descricao text,

  pretensao        numeric(12,2),
  valor_fechado    numeric(12,2),
  forma_fechamento text,

  -- Hoje o recontato mora dentro da célula de proposta, misturado com
  -- o valor ("02/06/23/Não atendeu"). Aqui são dois campos.
  proximo_contato date,
  observacoes     text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index atendimento_data_idx   on atendimento (data desc);
create index atendimento_status_idx on atendimento (status);
create index atendimento_negociador_idx on atendimento (negociador_id, data desc);

create trigger atendimento_atualizado
  before update on atendimento
  for each row execute function toca_atualizado_em();

-- O veículo passa a pendurar no atendimento. Fica nulo nas linhas que
-- já existem e nas que vierem de importação sem placa.
alter table veiculo add column atendimento_id uuid references atendimento(id) on delete set null;
create index veiculo_atendimento_idx on veiculo (atendimento_id);

/* ---------------------------------------------------------------------
 * As propostas dos lojistas
 *
 * Na planilha são quatro pares de colunas PROPOSTAS/LOJISTA, o que
 * limita a quatro e obriga a apagar para registrar a quinta. Aqui é
 * uma linha por proposta, sem teto.
 * ------------------------------------------------------------------ */

create table proposta (
  id             uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references atendimento(id) on delete cascade,

  lojista text not null,
  valor   numeric(12,2),

  -- Proposta escolhida para imprimir e levar ao cliente.
  apresentada boolean not null default false,

  observacao  text,
  recebida_em timestamptz not null default now()
);

create index proposta_atendimento_idx on proposta (atendimento_id, valor desc);

/* ---------------------------------------------------------------------
 * Segurança
 *
 * A equipe divide uma planilha só, e todos enxergam tudo — é assim que
 * o trabalho acontece hoje. Mantive a leitura aberta para quem tem
 * login, e prendi a escrita a quem conduziu o atendimento, com o
 * gerente por cima.
 *
 * Sem login não há acesso nenhum: 'authenticated' exclui o anônimo.
 * ------------------------------------------------------------------ */

alter table perfil      enable row level security;
alter table atendimento enable row level security;
alter table proposta    enable row level security;

-- Perfil: cada um lê o seu; o gerente lê todos. Ninguém muda o próprio
-- papel — promoção é no painel ou pelo gerente.
create policy perfil_leitura on perfil
  for select to authenticated
  using (id = auth.uid() or e_gerente());

create policy perfil_gerente_escreve on perfil
  for all to authenticated
  using (e_gerente()) with check (e_gerente());

-- Atendimento: todo mundo com login lê.
create policy atendimento_leitura on atendimento
  for select to authenticated using (e_equipe());

create policy atendimento_criar on atendimento
  for insert to authenticated with check (e_equipe());

create policy atendimento_editar on atendimento
  for update to authenticated
  using (e_equipe() and (negociador_id = auth.uid() or negociador_id is null or e_gerente()))
  with check (e_equipe() and (negociador_id = auth.uid() or negociador_id is null or e_gerente()));

-- Apagar atendimento é do gerente. Negociador que errou muda o status
-- para 'perdido'; apagar esconde o furo do funil.
create policy atendimento_apagar on atendimento
  for delete to authenticated using (e_gerente());

create policy proposta_leitura on proposta
  for select to authenticated using (e_equipe());

create policy proposta_escreve on proposta
  for all to authenticated using (e_equipe()) with check (e_equipe());

/* ---------------------------------------------------------------------
 * As tabelas de 0001 a 0003 estavam com RLS ligada e sem política
 * nenhuma — fechado por omissão, acessível só pela chave de serviço.
 * Com login, o navegador passa a falar pelo próprio usuário, então
 * elas precisam de política ou param de responder.
 *
 * Dado de veículo não identifica pessoa; quem tem login trabalha nele.
 * O que é pessoal está em atendimento, com as regras acima.
 * ------------------------------------------------------------------ */

create policy veiculo_equipe on veiculo
  for all to authenticated using (e_equipe()) with check (e_equipe());

create policy foto_equipe on foto
  for all to authenticated using (e_equipe()) with check (e_equipe());

create policy documento_equipe on documento
  for all to authenticated using (e_equipe()) with check (e_equipe());

/* ---------------------------------------------------------------------
 * Primeiro acesso
 *
 * Ovo e galinha: só gerente ativa perfil, e todo perfil nasce
 * desativado. O primeiro tem que ser ativado à mão, aqui no painel,
 * depois de criar o usuário em Authentication → Users:
 *
 *   update perfil set papel = 'gerente', ativo = true
 *   where id = (select id from auth.users where email = 'seu@email');
 *
 * Deste ponto em diante o gerente ativa os outros pela tela.
 * ------------------------------------------------------------------ */
