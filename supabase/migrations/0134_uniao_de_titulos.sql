-- 0134 · Unir títulos e atribuir custo ao carro (08/11/2026, o Derek: "opção de unir em um título
-- só, e ao mesmo tempo atualizar valores e adicionar mais itens para o mesmo fornecedor (com
-- categorias diferentes se quiser)… deve ser possível atribuir o custo de um título a um carro").
--
-- A UNIÃO É UMA CAPA, não um título novo: os títulos de dentro continuam inteiros — cada um com a
-- categoria, o carro e o item do contrato dele —, e o DRE, a projeção e a sincronização com o carro
-- não mudam. Pagar a união dá baixa em todos, ou liga todos a uma linha do banco (o mesmo "dividir"
-- da Conciliação). O relatório de cautelares da TMH é o caso: as do contrato e as que viraram custo
-- numa transferência só.
create table if not exists fin_uniao (
  id uuid primary key default gen_random_uuid(),
  descricao text,
  favorecido text,
  favorecido_id uuid references fin_favorecido(id) on delete set null,
  vencimento date,
  conta_id uuid references fin_conta(id) on delete set null,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
alter table fin_uniao enable row level security;
drop policy if exists fin_uniao_fin on fin_uniao;
create policy fin_uniao_fin on fin_uniao for all to authenticated
  using (e_financeiro()) with check (e_financeiro());

alter table fin_lancamento add column if not exists uniao_id uuid references fin_uniao(id) on delete set null;
create index if not exists fin_lancamento_uniao_idx on fin_lancamento (uniao_id) where uniao_id is not null;

-- O CUSTO ATRIBUÍDO AO CARRO vira uma linha de estoque_custo (entra no custo do carro no pátio, ou na
-- rentabilidade se ele já foi vendido) e o título passa para Negociação, fora do DRE — senão o mesmo
-- dinheiro sairia duas vezes (no carro e na categoria). A categoria de antes fica guardada para
-- "tirar do carro" devolver.
alter table fin_lancamento add column if not exists atribuido_ao_carro boolean not null default false;
alter table fin_lancamento add column if not exists categoria_antes_id uuid references fin_categoria(id) on delete set null;
