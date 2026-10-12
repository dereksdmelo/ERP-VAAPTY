-- =====================================================================
-- 0067 — Recebimentos: toda venda tem que aparecer no extrato
--
-- O Derek, em 12/10/2026: "eu tenho que me certificar que todas as
-- vendas tenham sido recebidas". O estoque sabe quanto cada lojista
-- deve (valor_venda); o extrato sabe quanto entrou. Faltava a linha que
-- diz QUAL crédito pagou QUAL carro — e a explicação quando nenhum
-- pagou.
--
-- Três peças, mais duas correções que apareceram ao olhar o dado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O casamento venda × extrato.
--
-- Uma linha por pedaço: o lojista que paga um carro em dois PIX gera
-- duas linhas; o PIX que paga dois carros também gera duas (uma por
-- carro). Por isso `valor` existe — o crédito inteiro não pertence
-- sempre a uma venda só.
--
-- Sem crédito, a linha é EXPLICAÇÃO: pago em dinheiro, encontro de
-- contas, desconto dado ao lojista. A explicação é obrigatória; venda
-- que some da lista sem dizer por quê é o que esta tabela existe para
-- impedir.
-- ---------------------------------------------------------------------
create table fin_recebimento (
  id uuid primary key default gen_random_uuid(),
  estoque_id    uuid not null references estoque(id) on delete cascade,
  lancamento_id uuid references fin_lancamento(id) on delete cascade,
  valor numeric(14,2) not null check (valor > 0),
  -- auto: o sistema casou sozinho (valor exato E pagador reconhecido).
  -- manual: o financeiro casou. explicado: não há crédito, há motivo.
  modo text not null check (modo in ('auto', 'manual', 'explicado')),
  explicacao text,
  criado_por uuid references perfil(id) default auth.uid(),
  criado_em timestamptz not null default now(),
  check ((modo = 'explicado') = (lancamento_id is null)),
  check (modo <> 'explicado' or coalesce(trim(explicacao), '') <> '')
);
create unique index fin_recebimento_par on fin_recebimento (estoque_id, lancamento_id)
  where lancamento_id is not null;
create index fin_recebimento_lanc_idx on fin_recebimento (lancamento_id) where lancamento_id is not null;

alter table fin_recebimento enable row level security;
create policy fin_recebimento_acesso on fin_recebimento
  for all to authenticated using (e_financeiro()) with check (e_financeiro());

-- ---------------------------------------------------------------------
-- 2. Quem paga por quem.
--
-- A ALFA VEICULOS paga pelo CNPJ da F C MONTEVECHIO; o carro vendido ao
-- MELVILLE foi pago pela ALINE. Nome nenhum casa isso — mas o
-- financeiro casa uma vez, e daí em diante o sistema sabe. É o mesmo
-- aprendizado da categoria por descrição: a pessoa ensina, a máquina
-- repete.
-- ---------------------------------------------------------------------
create table fin_pagador (
  comprador_id  uuid not null references comprador(id) on delete cascade,
  favorecido_id uuid not null references fin_favorecido(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (comprador_id, favorecido_id)
);
alter table fin_pagador enable row level security;
create policy fin_pagador_acesso on fin_pagador
  for all to authenticated using (e_financeiro()) with check (e_financeiro());

-- ---------------------------------------------------------------------
-- 3. Comissão de indicação: o negócio em que a Vaapty não compra.
--
-- Quitação maior que o carro: a Vaapty não resolve, mas um lojista
-- resolve (assume o financiamento) e paga uma comissão por ter recebido
-- o cliente. A casa já registrava isso — 30 linhas na planilha de
-- rentabilidade, com valor de compra zero e o comprador escrito como
-- "ADAM ... ASSUMIU". Funcionava na conta (margem = comissão) e
-- mentia no nome: o comprador não se chama "ASSUMIU".
--
-- `natureza` dá nome ao caso. A linha continua sendo do estoque, e é
-- isso que faz a comissão entrar na rentabilidade, na meta do
-- negociador e nos recebimentos sem uma conta nova em lugar nenhum.
-- ---------------------------------------------------------------------
alter table estoque add column if not exists natureza text not null default 'compra'
  check (natureza in ('compra', 'indicacao'));

update estoque e set natureza = 'indicacao'
  from comprador c
 where c.id = e.comprador_id and c.nome ilike '%ASSUMIU%' and e.natureza = 'compra';

-- ---------------------------------------------------------------------
-- 4. A linha de saldo do Itaú não é movimento.
--
-- "SALDO TOTAL DISPONÍVEL DIA" vem no extrato todo dia, com o saldo no
-- campo de crédito. O importador só reconhecia "saldo anterior", então
-- 194 dessas entraram como créditos — R$ 29,5 milhões que nunca
-- entraram na conta. Não se apaga: vira `cancelado`, que nenhuma soma
-- lê, e a observação diz por quê. A chave do extrato continua ali e
-- barra a mesma linha de entrar de novo.
-- ---------------------------------------------------------------------
update fin_lancamento
   set situacao = 'cancelado',
       observacao = trim(coalesce(observacao, '') || ' Linha de saldo do extrato, não é movimento (0067).')
 where descricao ilike 'SALDO TOTAL DISPON%' and situacao = 'efetivado';

-- ---------------------------------------------------------------------
-- 5. Crédito identificado vira lançamento categorizado.
--
-- Casar o PIX com o carro É dizer o que ele é: Negociação, pagamento
-- do lojista, daquele carro. Sem isto o mesmo crédito ficaria
-- "identificado" numa tela e "sem categoria" na outra — duas verdades
-- sobre a mesma linha.
--
-- Só quando o crédito inteiro pertence a UM carro e ninguém categorizou
-- antes: o PIX que pagou dois carros não cabe no cabeçalho (é rateio,
-- e fica para a pessoa), e categoria escolhida à mão não é desfeita
-- por máquina.
--
-- Em lote, numa chamada: o primeiro casamento automático pega perto de
-- duzentos créditos, e um PATCH por linha estouraria o teto de
-- subrequisições do Worker.
-- ---------------------------------------------------------------------
create or replace function fin_recebimento_categorizar()
returns integer
language sql
security invoker
set search_path = public
as $$
  with cat as (
    select id from fin_categoria where grupo = 'negociacao' order by ordem, nome limit 1
  ),
  alvo as (
    select r.lancamento_id, (array_agg(r.estoque_id))[1] as estoque_id, sum(r.valor) as usado
      from fin_recebimento r
     where r.lancamento_id is not null
     group by r.lancamento_id
    having count(distinct r.estoque_id) = 1
  ),
  feito as (
    update fin_lancamento l
       set categoria_id = (select id from cat),
           tipo_negociacao = 'pagto_lojista',
           estoque_id = a.estoque_id
      from alvo a
     where l.id = a.lancamento_id
       and l.categoria_id is null
       and l.credito > 0
       and a.usado >= l.credito - 0.01
       and exists (select 1 from cat)
    returning 1
  )
  select count(*)::int from feito;
$$;
