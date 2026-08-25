-- =====================================================================
-- 0001 — tabela de veículo
--
-- Primeira migração do banco da Vaapty. Só o veículo, de propósito:
-- a ideia é ver uma tabela funcionando antes de crescer.
--
-- Migração é um arquivo que descreve uma mudança no banco. Ela fica no
-- repositório, versionada. Nunca mexa no banco clicando no painel: se
-- mudar aqui, qualquer pessoa consegue reproduzir o banco do zero.
-- É isso que vai permitir o Mateus assumir depois.
-- =====================================================================

-- Estado de cada pneu, medido individualmente no pátio.
create type estado_pneu as enum ('novo', 'bom', 'medio', 'fraco');

-- Onde o carro está no fluxo.
create type status_veiculo as enum (
  'em_avaliacao',   -- negociador preenchendo a ficha
  'avaliado',       -- ficha completa, pronto para publicar
  'publicado',      -- no grupo e no Shinkai
  'comprado',       -- fechou com o cliente
  'repassado',      -- vendido para o lojista
  'devolvido'       -- cliente levou o carro embora
);

create table veiculo (
  id uuid primary key default gen_random_uuid(),

  -- identificação
  placa           text not null,
  chassi          text,           -- vem da Placa Fipe quando completo
  renavam         text,           -- sempre digitado do CRLV
  marca_modelo    text,
  ano_fabricacao  int,
  ano_modelo      int,
  cor             text,
  combustivel     text,
  cambio          text,
  km_atual        int,
  km_entrada      int,

  -- FIPE
  fipe_codigo        text,
  fipe_valor         numeric(12,2),
  fipe_consultada_em timestamptz,

  -- estado do carro
  pneu_de estado_pneu,   -- dianteiro esquerdo
  pneu_dd estado_pneu,
  pneu_te estado_pneu,
  pneu_td estado_pneu,
  leilao_sinistro boolean not null default false,
  gnv             boolean not null default false,
  opcionais       text[] not null default '{}',

  detalhes_lataria  text,
  detalhes_mecanica text,

  -- as três camadas de observação
  pontos_positivos     text[] not null default '{}',  -- vai na oferta
  ressalvas_lojista    text[] not null default '{}',  -- vai pro lojista
  observacoes_internas text,                          -- nunca sai da loja

  gastos_descricao text,
  valor_por        numeric(12,2),   -- preço ofertado ao lojista

  status     status_veiculo not null default 'em_avaliacao',
  criado_em  timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index veiculo_placa_idx  on veiculo (placa);
create index veiculo_status_idx on veiculo (status);

-- Mantém atualizado_em correto sem ninguém precisar lembrar.
create or replace function toca_atualizado_em()
returns trigger as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

create trigger veiculo_atualizado
  before update on veiculo
  for each row execute function toca_atualizado_em();

-- ---------------------------------------------------------------------
-- Segurança
--
-- Row Level Security ligada, sem nenhuma política ainda. Efeito: só o
-- servidor (com a chave de serviço) enxerga a tabela. O navegador não
-- consegue ler nem escrever nada.
--
-- É o padrão certo antes de existir login: fechado por omissão. As
-- políticas por loja e por papel entram quando os usuários existirem.
-- ---------------------------------------------------------------------
alter table veiculo enable row level security;
