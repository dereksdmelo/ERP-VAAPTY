-- =====================================================================
-- 0019 — Estoque: o carro depois que o negócio fecha
--
-- Até aqui o sistema terminava no contrato assinado. O que acontece
-- depois — o carro parado no pátio, custando dinheiro — não existia em
-- lugar nenhum.
--
-- A ideia central é uma só: **custo previsto contra custo real**. Na
-- mesa o negociador combina débitos de R$ 3.000 e quitação de R$
-- 28.000; na prática se consegue desconto na quitação, aparece juros
-- que ninguém viu, o carro precisa de pneu. Guardar só o total final
-- esconde de onde veio a diferença — e a diferença é o lucro.
--
-- Por isso o custo é **linha a linha**, cada uma com previsto, real e
-- comprovante. O previsto nasce do check list, que é onde esses
-- números já foram digitados uma vez: ninguém redigita nada.
-- =====================================================================

create type estoque_situacao as enum (
  'em_estoque',   -- comprado, no pátio
  'vendido',
  'devolvido'     -- voltou para o cliente (cautelar, arrependimento)
);

create table estoque (
  id uuid primary key default gen_random_uuid(),

  veiculo_id     uuid not null references veiculo(id) on delete cascade,
  -- O atendimento é de onde o carro veio, e é por ele que o comprovante
  -- acha a pasta no Storage. `set null` porque o carro sobrevive ao
  -- atendimento de origem, como no lead de indicação (0011).
  atendimento_id uuid references atendimento(id) on delete set null,

  situacao   estoque_situacao not null default 'em_estoque',
  entrou_em  date not null default (now() at time zone 'America/Sao_Paulo')::date,

  -- O que foi pago ao cliente. É o `valor_fechado` do atendimento no
  -- momento da entrada, copiado e não referenciado: renegociar o
  -- atendimento meses depois não pode mexer no custo de um carro que
  -- já está no pátio.
  valor_compra numeric(12,2),

  -- A venda.
  comprador_id uuid,
  vendido_em   date,
  valor_venda  numeric(12,2),
  nota_venda   text,

  observacoes text,

  criado_por    uuid references perfil(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Um carro entra no estoque uma vez. Sem isto, dois cliques no botão
-- criariam duas fichas de custo para o mesmo carro e o total dobraria.
create unique index estoque_veiculo_unico on estoque (veiculo_id);
create index estoque_situacao_idx on estoque (situacao, entrou_em desc);

create trigger estoque_atualizado
  before update on estoque
  for each row execute function toca_atualizado_em();

-- ---------------------------------------------------------------------
-- As linhas de custo.
-- ---------------------------------------------------------------------
create type custo_tipo as enum (
  'quitacao',   -- financiamento a quitar
  'debitos',    -- IPVA, multas, licenciamento
  'cautelar',   -- laudo
  'transporte',
  'reparo',     -- funilaria, mecânica, pneu
  'juros',      -- o que apareceu por atraso
  'documentacao',
  'outro'
);

create table estoque_custo (
  id uuid primary key default gen_random_uuid(),
  estoque_id uuid not null references estoque(id) on delete cascade,

  tipo      custo_tipo not null default 'outro',
  descricao text not null,

  -- `realizado`, e não `real`: `real` é tipo do Postgres e a coluna
  -- precisaria de aspas em toda consulta.
  previsto  numeric(12,2) not null default 0,
  realizado numeric(12,2),          -- null = ainda não pagou
  pago_em   date,

  -- O comprovante mora em `anexo` (0008), no bucket que já existe.
  -- Bucket novo significaria política nova de Storage e mais um lugar
  -- para o arquivo se perder.
  anexo_id uuid references anexo(id) on delete set null,

  -- O que veio do check list nasce marcado: é o que separa "o negócio
  -- combinou isso" de "alguém digitou isso depois".
  do_fechamento boolean not null default false,

  criado_por    uuid references perfil(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index estoque_custo_idx on estoque_custo (estoque_id, criado_em);

create trigger estoque_custo_atualizado
  before update on estoque_custo
  for each row execute function toca_atualizado_em();

-- ---------------------------------------------------------------------
-- O comprador.
--
-- Cadastro próprio e não texto solto no `estoque` porque o mesmo
-- lojista compra dezenas de carros: sem cadastro, "AUTO CENTER SUL" e
-- "Auto Center Sul" viram dois compradores e o histórico se parte.
-- ---------------------------------------------------------------------
create type comprador_tipo as enum ('lojista', 'pessoa_fisica');

create table comprador (
  id uuid primary key default gen_random_uuid(),

  nome      text not null,
  tipo      comprador_tipo not null default 'lojista',
  documento text,             -- CPF ou CNPJ
  telefone  text,
  email     text,
  cidade    text,
  uf        text,

  -- Quando o cadastro vier da Shinkai, o id de lá fica aqui para o
  -- mesmo lojista não entrar duas vezes numa próxima importação.
  shinkai_id text,

  ativo boolean not null default true,

  criado_por    uuid references perfil(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Nome é a chave prática, como no cadastro de negociadores (0010).
create unique index comprador_nome_unico on comprador (lower(nome));
create unique index comprador_shinkai_unico on comprador (shinkai_id) where shinkai_id is not null;

create trigger comprador_atualizado
  before update on comprador
  for each row execute function toca_atualizado_em();

alter table estoque
  add constraint estoque_comprador_fk
  foreign key (comprador_id) references comprador(id);

-- ---------------------------------------------------------------------
-- RLS
--
-- Estoque é informação de custo e margem: a equipe inteira lê, porque
-- o negociador precisa saber o que tem no pátio para vender. Escrever
-- também é da equipe — quem lança a nota do pneu é quem trocou o pneu.
-- Apagar não é: linha de custo apagada some com a explicação da
-- margem, e isso é conversa de gerente.
-- ---------------------------------------------------------------------
alter table estoque        enable row level security;
alter table estoque_custo  enable row level security;
alter table comprador      enable row level security;

drop policy if exists estoque_equipe on estoque;
create policy estoque_equipe on estoque
  for select to authenticated using (e_equipe());
drop policy if exists estoque_escreve on estoque;
create policy estoque_escreve on estoque
  for insert to authenticated with check (e_equipe());
drop policy if exists estoque_edita on estoque;
create policy estoque_edita on estoque
  for update to authenticated using (e_equipe()) with check (e_equipe());
drop policy if exists estoque_apaga on estoque;
create policy estoque_apaga on estoque
  for delete to authenticated using (e_gerente());

drop policy if exists custo_equipe on estoque_custo;
create policy custo_equipe on estoque_custo
  for select to authenticated using (e_equipe());
drop policy if exists custo_escreve on estoque_custo;
create policy custo_escreve on estoque_custo
  for insert to authenticated with check (e_equipe());
drop policy if exists custo_edita on estoque_custo;
create policy custo_edita on estoque_custo
  for update to authenticated using (e_equipe()) with check (e_equipe());
drop policy if exists custo_apaga on estoque_custo;
create policy custo_apaga on estoque_custo
  for delete to authenticated using (e_gerente());

drop policy if exists comprador_equipe on comprador;
create policy comprador_equipe on comprador
  for select to authenticated using (e_equipe());
drop policy if exists comprador_escreve on comprador;
create policy comprador_escreve on comprador
  for insert to authenticated with check (e_equipe());
drop policy if exists comprador_edita on comprador;
create policy comprador_edita on comprador
  for update to authenticated using (e_equipe()) with check (e_equipe());
drop policy if exists comprador_apaga on comprador;
create policy comprador_apaga on comprador
  for delete to authenticated using (e_gerente());
