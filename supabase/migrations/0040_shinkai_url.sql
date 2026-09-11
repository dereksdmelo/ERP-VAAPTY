-- =====================================================================
-- 0040 — O endereço do carro no Shinkai
--
-- O descritivo que vai ao grupo dos lojistas precisa levar o link das
-- fotos — foi o pedido do Derek em 11/09/2026: "o descritivo deve vir
-- do Shinkai, pois lá tem o link das fotos pros lojistas".
--
-- **A resposta documentada do Shinkai NÃO traz esse link.** O 200
-- devolve `id`, `placa`, `acao`, `status`, `fotos` (a contagem) e
-- `avisos`, e mais nada. Montar a URL a partir do `id` seria chutar o
-- formato do site deles, e link quebrado no grupo dos lojistas é pior
-- que link nenhum.
--
-- Então a coluna nasce vazia e o servidor a preenche com o primeiro
-- campo de endereço que a resposta trouxer — `url`, `link`,
-- `permalink`, `oferta_url`. No dia em que o Mateus incluir um deles,
-- o link passa a aparecer no descritivo sozinho, sem deploy.
-- =====================================================================

alter table veiculo add column if not exists shinkai_url text;
alter table estoque add column if not exists shinkai_url text;

comment on column veiculo.shinkai_url is
  'Endereco do carro no Shinkai, quando a resposta do POST traz um. Nulo enquanto eles nao devolverem.';
