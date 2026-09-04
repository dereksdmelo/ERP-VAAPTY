-- =====================================================================
-- 0024 — Rateio: um lançamento repartido
--
-- O extrato traz UM PIX para o despachante. Na verdade aquilo é três
-- coisas: a documentação de dois carros — que é custo do carro e não
-- entra no DRE — e uma taxa da loja, que entra. Enquanto o lançamento
-- tinha uma categoria só, era preciso escolher qual das três mentir.
--
-- `fin_rateio` é a repartição. Cada linha aponta para a sua categoria
-- e, quando é de carro, para o carro e a parte do negócio.
--
-- **O que sobra não some.** A soma dos rateios pode ser menor que o
-- lançamento; a diferença fica na categoria do próprio lançamento. Sem
-- essa regra, um rateio incompleto tiraria dinheiro do DRE em silêncio.
--
-- Um lançamento sem nenhum rateio continua como sempre foi: a
-- categoria, o carro e o funcionário no cabeçalho.
-- =====================================================================

create table fin_rateio (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references fin_lancamento(id) on delete cascade,

  -- Sempre positivo: o sinal vem do lançamento, que é débito ou
  -- crédito, nunca os dois.
  valor numeric(14,2) not null check (valor > 0),

  categoria_id    uuid references fin_categoria(id),
  estoque_id      uuid references estoque(id) on delete set null,
  tipo_negociacao fin_negociacao,
  funcionario_id  uuid references fin_funcionario(id),
  descricao       text,

  criado_em timestamptz not null default now()
);

create index fin_rateio_lanc_idx on fin_rateio (lancamento_id);
create index fin_rateio_estoque_idx on fin_rateio (estoque_id) where estoque_id is not null;

alter table fin_rateio enable row level security;
create policy fin_rateio_acesso on fin_rateio
  for all to authenticated using (e_financeiro()) with check (e_financeiro());

-- ---------------------------------------------------------------------
-- Que categoria pede o quê.
--
-- Salário e comissão sem a pessoa não conciliam com a folha; o grupo
-- `negociacao` já dizia que era de carro, mas faltava dizer quais
-- categorias são de gente.
-- ---------------------------------------------------------------------
alter table fin_categoria
  add column if not exists pede_funcionario boolean not null default false;

comment on column fin_categoria.pede_funcionario is
  'A tela exige escolher a pessoa. Sem isso o lançamento não bate com a folha do mês.';

update fin_categoria set pede_funcionario = true
  where lower(nome) in ('salario', 'salário', 'comissão', 'comissao', 'bonificação',
                        'bonificacao', 'vale', 'inss', 'irrf');
