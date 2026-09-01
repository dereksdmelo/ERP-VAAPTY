-- =====================================================================
-- 0018 — A meta deixa de ser um número solto
--
-- Até aqui `meta_valor` era digitado direto: R$ 70.000 e pronto. Isso
-- não diz ao negociador o que ele tem que FAZER para chegar lá — e é
-- disso que a conversa de meta é feita. Agora a meta de cada um é a
-- combinação de três coisas que ele controla:
--
--     atendimentos × conversão × ticket médio = faturamento
--
-- O faturamento vira consequência. `meta_valor` e `meta_volume`
-- continuam existindo, e continuam sendo o que o dashboard lê — mas
-- passam a ser DERIVADOS, calculados no servidor a partir dos três.
-- Quem escrever direto neles cria duas verdades para a mesma meta.
--
-- E a meta da LOJA passa a ser independente. Somar as metas
-- individuais pressupõe que todo mundo bate a sua, o que não acontece
-- em mês nenhum: o alvo da loja é decisão de gestor, não aritmética.
-- =====================================================================

alter table negociador
  add column if not exists meta_atendimentos int           not null default 0,
  add column if not exists meta_conversao    numeric(5,2)  not null default 0,
  add column if not exists meta_ticket       numeric(12,2) not null default 0;

comment on column negociador.meta_atendimentos is
  'Atendimentos no mês. Entrada da meta; meta_valor é consequência.';
comment on column negociador.meta_conversao is
  'Conversão alvo em pontos percentuais (20 = 20%).';
comment on column negociador.meta_ticket is
  'Ticket médio alvo em R$.';
comment on column negociador.meta_valor is
  'DERIVADO no servidor: round(meta_atendimentos * meta_conversao/100) * meta_ticket.';
comment on column negociador.meta_volume is
  'DERIVADO no servidor: round(meta_atendimentos * meta_conversao/100).';

-- Os R$ 70.000 do padrão antigo ficam de pé até o gerente preencher os
-- três campos. Zerar aqui apagaria a meta de todo mundo numa migração,
-- e o dashboard amanheceria sem alvo nenhum.

-- ---------------------------------------------------------------------
-- A meta da loja, uma por mês.
--
-- Por competência e não linha única porque a meta muda de mês para mês
-- e o dashboard sabe olhar meses fechados — guardar só a atual faria o
-- mês de agosto ser julgado pelo alvo de setembro.
-- ---------------------------------------------------------------------
create table if not exists meta_loja (
  competencia date primary key,
  valor  numeric(12,2) not null default 0,
  volume int           not null default 0,

  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references perfil(id)
);

comment on table meta_loja is
  'Meta de faturamento da loja no mês. Independente da soma das metas individuais: elas pressupõem que todos batam a sua.';

alter table meta_loja enable row level security;

-- Todo mundo da equipe lê — a régua do mês aparece para quem abre o
-- dashboard. Só gerente escreve, como no cadastro de negociadores.
-- `drop if exists` antes de criar: `create policy` não aceita
-- `if not exists`, e sem isto rodar a migração duas vezes falha aqui —
-- o que aconteceu na primeira aplicação e deixa o arquivo parecendo
-- quebrado quando ele já tinha funcionado.
drop policy if exists meta_loja_leitura on meta_loja;
create policy meta_loja_leitura on meta_loja
  for select to authenticated using (e_equipe());

drop policy if exists meta_loja_gerente on meta_loja;
create policy meta_loja_gerente on meta_loja
  for all to authenticated using (e_gerente()) with check (e_gerente());
