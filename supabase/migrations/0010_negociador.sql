-- =====================================================================
-- 0010 — cadastro de negociadores e prospecção
--
-- A planilha mede por pessoa: fluxo, vendas, conversão e meta de cada
-- negociador. Até aqui o sistema só tinha `perfil`, que é quem tem
-- LOGIN — e nem todo negociador da planilha tem conta.
--
-- Por isso uma tabela separada: cadastro de gente, não de usuário. O
-- vínculo com o login é opcional (`perfil_id`) e vem depois.
--
-- Metas iguais para todos, como estão na planilha (R$ 70.000 e 15
-- carros no mês), mas por pessoa: negociador novo costuma entrar com
-- meta menor, e uma meta global não deixaria.
-- =====================================================================

create table negociador (
  id    uuid primary key default gen_random_uuid(),
  nome  text not null,
  -- 'negociador' atende; 'prospeccao' agenda. São as duas colunas que a
  -- planilha separa (NEGOCIADOR e PROSPEC), e a comissão é dos dois.
  papel text not null default 'negociador',
  ativo boolean not null default true,

  meta_valor  numeric(12,2) not null default 70000,
  meta_volume int           not null default 15,

  -- Quando a pessoa ganhar login, aponta para o perfil dela.
  perfil_id uuid references perfil(id),

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Nome é a chave prática: é por ele que a planilha e o importador
-- casam a pessoa. Sem índice, "ANDRE" entraria duas vezes.
create unique index negociador_nome_unico on negociador (lower(nome), papel);

create trigger negociador_atualizado
  before update on negociador
  for each row execute function toca_atualizado_em();

-- Os seis que aparecem na aba FLUXO X CONVERSÃO de agosto/2026.
insert into negociador (nome, papel) values
  ('ANDRÉ BRUNO', 'negociador'),
  ('ANDRE',       'negociador'),
  ('DIMAS',       'negociador'),
  ('TIAGO',       'negociador'),
  ('ALESSANDRO',  'negociador'),
  ('PABLO',       'negociador')
on conflict do nothing;

alter table negociador enable row level security;

-- Todo mundo da equipe lê: a lista aparece no cadastro do atendimento.
-- Só gerente mexe, porque meta é assunto de gerente.
create policy negociador_leitura on negociador
  for select to authenticated using (e_equipe());

create policy negociador_gerente on negociador
  for all to authenticated using (e_gerente()) with check (e_gerente());
