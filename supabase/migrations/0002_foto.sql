-- =====================================================================
-- 0002 — fotos do veículo
--
-- A imagem NÃO fica no banco. Ela vai para o Storage do Supabase e a
-- tabela guarda só o caminho do arquivo e a ordem.
--
-- Por quê: imagem dentro de tabela incha o banco e deixa toda consulta
-- lenta, inclusive as que nem pedem foto. Doze fotos por carro, algumas
-- centenas de carros por ano, e o banco vira gigabytes de coisa que
-- ninguém consulta por conteúdo.
-- =====================================================================

create table foto (
  id uuid primary key default gen_random_uuid(),

  veiculo_id uuid not null references veiculo(id) on delete cascade,

  -- Caminho dentro do bucket, ex.: 'QXM5G73/1724540400-a3f2.jpg'
  caminho text not null,

  -- 0 é a capa do anúncio. O negociador reordena na tela.
  ordem int not null default 0,

  largura int,
  altura  int,
  bytes   int,

  criado_em timestamptz not null default now()
);

create index foto_veiculo_idx on foto (veiculo_id, ordem);

-- Uma foto por posição, por carro. Evita duas capas.
create unique index foto_ordem_unica on foto (veiculo_id, ordem);

alter table foto enable row level security;

-- ---------------------------------------------------------------------
-- Espaço de arquivos
--
-- 'privado' significa que ninguém abre a imagem só por saber o endereço.
-- Para mostrar na tela, o servidor gera um link temporário.
--
-- Importante para vocês: as fotos do carro contam a história de um
-- cliente que veio vender. Link público eterno é o tipo de coisa que
-- volta como problema depois.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fotos-veiculo',
  'fotos-veiculo',
  false,
  5242880,                                   -- 5 MB por arquivo
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
