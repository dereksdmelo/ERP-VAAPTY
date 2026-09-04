-- =====================================================================
-- 0021 — Financeiro: a pasta "Financeiro Joinville" vira tabela
--
-- A pasta do Derek (janeiro/2024) tem seis abas amarradas:
--
--   Lançamentos   o extrato do banco categorizado, com saldo corrido
--   DRE           SUMIFS por categoria + rentabilidade dos carros = lucro
--   Negociação    por carro: pago cliente / quitação / pago lojista
--   Salarios      salário + comissão − vale = líquido
--   Vales         adiantamentos, descontados numa competência
--   Retiradas     retiradas do sócio, e a fatura do cartão
--
-- Tudo aqui é ÁREA RESTRITA. A regra não é "esconder a tela": é a RLS.
-- `e_financeiro()` libera quem tem o sinalizador no perfil ou é
-- gerente; para todo o resto, as tabelas não existem — o PostgREST
-- devolve lista vazia e recusa escrita.
-- =====================================================================

alter table perfil add column if not exists financeiro boolean not null default false;
comment on column perfil.financeiro is
  'Entra na área financeira: lançamentos, DRE, folha. Independe do papel; gerente sempre entra.';

create or replace function e_financeiro()
returns boolean as $$
  select coalesce(
    (select financeiro or papel = 'gerente' from perfil where id = auth.uid() and ativo),
    false
  );
$$ language sql stable security definer set search_path = public;

update perfil set financeiro = true where papel = 'gerente';

-- ---------------------------------------------------------------------
-- Contas: banco, caixa, cartão. A planilha tem uma; a casa tem mais
-- de uma empresa (Jlle, Mr Wiz aparecem na fatura), então `empresa`
-- existe desde já.
-- ---------------------------------------------------------------------
create table fin_conta (
  id uuid primary key default gen_random_uuid(),
  nome    text not null,
  banco   text,
  empresa text,
  -- O "Saldo Anterior" da primeira linha da planilha.
  saldo_inicial    numeric(14,2) not null default 0,
  saldo_inicial_em date,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Categorias: o "Tipo pgt" da planilha. `grupo` separa o que é despesa
-- da loja (entra no DRE) do que é fluxo de carro, retirada de sócio ou
-- transferência (não entra — o carro entra pela rentabilidade).
-- ---------------------------------------------------------------------
create type fin_grupo as enum ('despesa', 'receita', 'negociacao', 'retirada', 'transferencia', 'saldo');

create table fin_categoria (
  id uuid primary key default gen_random_uuid(),
  nome  text not null,
  grupo fin_grupo not null default 'despesa',
  -- Entra na soma do DRE. Negociação, retirada e transferência não.
  no_dre boolean not null default true,
  ordem  int not null default 0,
  ativa  boolean not null default true
);
create unique index fin_categoria_nome on fin_categoria (lower(nome));

-- ---------------------------------------------------------------------
-- Funcionários: quem recebe folha. `negociador_id` liga à comissão.
-- ---------------------------------------------------------------------
create table fin_funcionario (
  id uuid primary key default gen_random_uuid(),
  nome          text not null,
  salario_base  numeric(12,2) not null default 0,
  negociador_id uuid references negociador(id),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index fin_funcionario_nome on fin_funcionario (lower(nome));

-- ---------------------------------------------------------------------
-- Lançamentos: cada linha do extrato. Débito OU crédito, nunca os dois.
-- ---------------------------------------------------------------------
create type fin_negociacao as enum ('pagto_cliente', 'quitacao', 'debitos', 'pagto_lojista', 'reembolso', 'outro');

create table fin_lancamento (
  id uuid primary key default gen_random_uuid(),
  conta_id     uuid not null references fin_conta(id),
  data         date not null,
  -- Competência é o mês a que a despesa pertence, não o mês do
  -- pagamento: a luz de dezembro paga em janeiro é despesa de dezembro.
  competencia  date not null,
  categoria_id uuid references fin_categoria(id),
  descricao    text,
  debito  numeric(14,2) not null default 0,
  credito numeric(14,2) not null default 0,

  -- Quando é fluxo de carro: qual carro e que parte do negócio.
  estoque_id      uuid references estoque(id) on delete set null,
  tipo_negociacao fin_negociacao,
  -- Quando é folha ou vale: de quem.
  funcionario_id uuid references fin_funcionario(id),

  conciliado boolean not null default false,
  origem     text not null default 'manual',    -- manual | planilha | extrato
  -- Chave que impede o mesmo movimento entrar duas vezes ao colar o
  -- extrato de novo: data + descrição + valor. Lançamento manual ganha
  -- um uuid aqui.
  chave_extrato text not null default gen_random_uuid()::text,

  criado_por    uuid references perfil(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint fin_lancamento_um_lado check (debito = 0 or credito = 0)
);
create unique index fin_lancamento_extrato on fin_lancamento (conta_id, chave_extrato);
create index fin_lancamento_comp on fin_lancamento (competencia, data);
create index fin_lancamento_data on fin_lancamento (conta_id, data, criado_em);
create index fin_lancamento_estoque on fin_lancamento (estoque_id) where estoque_id is not null;

create trigger fin_lancamento_atualizado
  before update on fin_lancamento
  for each row execute function toca_atualizado_em();

-- ---------------------------------------------------------------------
-- Vales e folha.
-- ---------------------------------------------------------------------
create table fin_vale (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references fin_funcionario(id),
  data        date not null,
  -- Em que folha desconta. Sempre dia 1.
  competencia date not null,
  valor       numeric(12,2) not null,
  descricao   text,
  descontado  boolean not null default false,
  criado_em   timestamptz not null default now()
);
create index fin_vale_comp on fin_vale (competencia);

create table fin_folha (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references fin_funcionario(id),
  competencia    date not null,
  salario     numeric(12,2) not null default 0,
  comissao    numeric(12,2) not null default 0,
  bonificacao numeric(12,2) not null default 0,
  vales       numeric(12,2) not null default 0,
  -- líquido = salário + comissão + bonificação − vales. Calculado no
  -- servidor, gravado aqui para o histórico não mudar se a regra mudar.
  liquido     numeric(12,2) not null default 0,
  pago_em     date,
  lancamento_id uuid references fin_lancamento(id),
  atualizado_em timestamptz not null default now(),
  unique (funcionario_id, competencia)
);

-- ---------------------------------------------------------------------
-- Fechamento do mês por conta: o saldo que o BANCO diz no último dia.
-- A conciliação é a diferença entre esse número e o saldo calculado
-- dos lançamentos. Enquanto não for zero, o mês não fecha.
-- ---------------------------------------------------------------------
create table fin_fechamento (
  id uuid primary key default gen_random_uuid(),
  conta_id    uuid not null references fin_conta(id),
  competencia date not null,
  saldo_banco numeric(14,2),
  fechado_em  timestamptz,
  fechado_por uuid references perfil(id),
  observacao  text,
  unique (conta_id, competencia)
);

-- ---------------------------------------------------------------------
-- RLS: só quem é do financeiro. Tudo — ler, escrever, apagar.
-- ---------------------------------------------------------------------
alter table fin_conta       enable row level security;
alter table fin_categoria   enable row level security;
alter table fin_funcionario enable row level security;
alter table fin_lancamento  enable row level security;
alter table fin_vale        enable row level security;
alter table fin_folha       enable row level security;
alter table fin_fechamento  enable row level security;

create policy fin_conta_acesso       on fin_conta       for all to authenticated using (e_financeiro()) with check (e_financeiro());
create policy fin_categoria_acesso   on fin_categoria   for all to authenticated using (e_financeiro()) with check (e_financeiro());
create policy fin_funcionario_acesso on fin_funcionario for all to authenticated using (e_financeiro()) with check (e_financeiro());
create policy fin_lancamento_acesso  on fin_lancamento  for all to authenticated using (e_financeiro()) with check (e_financeiro());
create policy fin_vale_acesso        on fin_vale        for all to authenticated using (e_financeiro()) with check (e_financeiro());
create policy fin_folha_acesso       on fin_folha       for all to authenticated using (e_financeiro()) with check (e_financeiro());
create policy fin_fechamento_acesso  on fin_fechamento  for all to authenticated using (e_financeiro()) with check (e_financeiro());

-- ---------------------------------------------------------------------
-- As categorias da planilha, na ordem do DRE. Quem importar a planilha
-- não precisa cadastrar nada antes.
-- ---------------------------------------------------------------------
insert into fin_categoria (nome, grupo, no_dre, ordem) values
  ('Agua','despesa',true,1),('Aluguel','despesa',true,2),('Bancario','despesa',true,3),('Bens','despesa',true,4),
  ('Bonificação','despesa',true,5),('Brinde','despesa',true,6),('Capital','despesa',true,7),('Cartorio','despesa',true,8),
  ('Cautelar','despesa',true,9),('Combustivel','despesa',true,10),('Comissão','despesa',true,11),('Confraternização','despesa',true,12),
  ('Consultas','despesa',true,13),('Copa','despesa',true,14),('Correio','despesa',true,15),('Crédito','despesa',true,16),
  ('Decoração','despesa',true,17),('Despachante','despesa',true,18),('Equipamento','despesa',true,19),('Escritorio','despesa',true,20),
  ('Feirão','despesa',true,21),('Honorario','despesa',true,22),('Internet','despesa',true,23),('INSS','despesa',true,24),
  ('IRRF','despesa',true,25),('Juros','despesa',true,26),('Limpeza','despesa',true,27),('Luz','despesa',true,28),
  ('M.Veiculo','despesa',true,29),('Manutenção','despesa',true,30),('MKT','despesa',true,31),('Motoboy','despesa',true,32),
  ('Papelaria','despesa',true,33),('Prejuizo','despesa',true,34),('Salario','despesa',true,35),('Segurança','despesa',true,36),
  ('Seguro','despesa',true,37),('Sistema','despesa',true,38),('Uber','despesa',true,39),('Uniformes','despesa',true,40),
  ('Negociação','negociacao',false,90),('Vale','despesa',false,91),('Retirada','retirada',false,92),
  ('Transferência','transferencia',false,93),('Saldo','saldo',false,99)
on conflict do nothing;

insert into fin_conta (nome, banco, empresa) values ('Conta principal', null, 'Vaapty Joinville');
