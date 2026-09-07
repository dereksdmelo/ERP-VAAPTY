-- =====================================================================
-- 0028 — Fechamento: o previsto contra o realizado, mês a mês
--
-- A planilha "Controle Financeiro Completo" é um DRE gerencial de
-- franquia, e a estrutura dela é a que importa:
--
--   receita operacional bruta
--   − despesas VARIÁVEIS (andam com a venda: cautelar, cartório,
--     despachante, comissão)
--   = MARGEM DE CONTRIBUIÇÃO
--   − despesas FIXAS (existem mesmo sem vender: aluguel, salário)
--   = resultado
--
-- Separar variável de fixa não é enfeite contábil: é o que responde
-- "quanto sobra por carro" e "quanto a loja custa parada". Por isso a
-- categoria ganhou `tipo_custo` — o `no_dre` só dizia se entra, não
-- onde entra.
--
-- **O faturamento aqui é a MARGEM BRUTA dos carros, não o valor de
-- venda.** Na planilha o ticket médio de janeiro deu R$ 4.676 com 69
-- carros: é o que a loja ganha por carro, não o preço do carro. Somar
-- o valor de venda inflaria a receita em vinte vezes.
-- =====================================================================

alter table fin_categoria
  add column if not exists tipo_custo text not null default 'fixa'
    check (tipo_custo in ('receita', 'variavel', 'fixa', 'fora'));

comment on column fin_categoria.tipo_custo is
  'Onde a categoria entra no fechamento. variavel anda com a venda; fixa existe mesmo sem vender; fora não entra no resultado.';

-- As que andam com a venda, pela planilha do Derek. O resto fica fixa,
-- que é o padrão, e o gerente corrige na tela.
update fin_categoria set tipo_custo = 'variavel'
  where lower(nome) in ('cautelar', 'cartorio', 'cartório', 'despachante',
                        'comissão', 'comissao', 'correio', 'consultas', 'motoboy');
update fin_categoria set tipo_custo = 'fora' where no_dre = false;
update fin_categoria set tipo_custo = 'receita' where grupo = 'receita';

-- ---------------------------------------------------------------------
-- O orçamento: uma linha por categoria por mês.
--
-- `linha` existe para o que não é categoria — quantidade de veículos e
-- ticket médio são premissas, não despesa, e sem elas o previsto de
-- faturamento não tem de onde sair.
-- ---------------------------------------------------------------------
create table fin_orcamento (
  id uuid primary key default gen_random_uuid(),
  competencia  date not null,
  categoria_id uuid references fin_categoria(id) on delete cascade,
  linha        text,          -- 'veiculos' | 'ticket' | 'outras_receitas'
  valor numeric(14,2) not null default 0,

  -- quem mexeu no orçamento sai do próprio token: previsão que alguém
  -- alterou sem deixar nome é previsão que ninguém defende depois.
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now(),
  constraint fin_orcamento_alvo check (
    (categoria_id is not null and linha is null) or
    (categoria_id is null and linha is not null)
  )
);

-- Dois índices parciais em vez de um único com nulos: o Postgres trata
-- nulos como distintos num índice comum, e a mesma categoria entraria
-- duas vezes no mesmo mês.
create unique index fin_orcamento_cat on fin_orcamento (competencia, categoria_id) where categoria_id is not null;
create unique index fin_orcamento_linha on fin_orcamento (competencia, linha) where linha is not null;

alter table fin_orcamento enable row level security;
create policy fin_orcamento_acesso on fin_orcamento
  for all to authenticated using (e_financeiro()) with check (e_financeiro());
