-- =====================================================================
-- 0042 — Recibo de pagamento e de recebimento
--
-- Pedido do Derek em 11/09/2026. O financeiro registrava o dinheiro e
-- não emitia o papel — e é o papel que a outra ponta pede: o cliente
-- que recebeu o PIX da venda, o despachante que foi pago, o lojista
-- que pagou pelo carro.
--
-- **Duas direções, um documento só.** Recebimento (crédito) é a Vaapty
-- quem recebe, e o recibo sai assinado por ela; pagamento (débito) é a
-- Vaapty quem paga, e o recibo é o que a outra parte assina. O texto é
-- o mesmo com emitente e recebedor trocados de lado — e é por isso que
-- a direção NÃO é digitada: ela sai do lançamento, do lado em que o
-- valor está. Deixar isso para quem emite é como se assina recibo
-- invertido.
--
-- **Cada emissão é uma linha, como na 0003.** Segunda via é evento
-- novo: é assim que se sabe quantas vias existem circulando. Sem
-- índice único, de propósito.
--
-- **`documento` não servia**: ela exige `veiculo_id not null` (0003) e
-- recibo de aluguel não tem veículo nenhum.
-- =====================================================================

create table fin_recibo (
  id uuid primary key default gen_random_uuid(),

  lancamento_id uuid not null references fin_lancamento(id) on delete cascade,

  -- O número que vai impresso, sequencial por ano. Recibo sem número é
  -- recibo que ninguém acha depois.
  numero int not null,
  ano    int not null,

  -- Congelados na emissão, não lidos do lançamento na hora de olhar.
  -- O recibo é prova do que foi dito NAQUELE dia: se amanhã alguém
  -- corrigir o nome do favorecido ou a competência, a via que está na
  -- mão da pessoa continua sendo a que foi assinada.
  valor      numeric(14,2) not null,
  direcao    text not null check (direcao in ('recebemos', 'pagamos')),
  outra_parte      text not null,
  outra_parte_doc  text,
  referente  text,
  emitido_em_data date not null,

  -- Liga o papel a esta linha, como o protocolo da 0003.
  protocolo text,
  conteudo  text,

  emitido_por uuid references perfil(id),
  emitido_em  timestamptz not null default now()
);

create index fin_recibo_lancamento on fin_recibo (lancamento_id, emitido_em desc);
create unique index fin_recibo_numero on fin_recibo (ano, numero);

comment on table fin_recibo is
  'Cada emissao de recibo, inclusive segunda via. Os dados sao congelados: o papel prova o que foi dito no dia.';

-- ---------------------------------------------------------------------
-- O próximo número do ano.
--
-- `max(numero) + 1` na aplicação daria duas vias com o mesmo número se
-- duas pessoas emitissem no mesmo segundo. Aqui o índice único é a
-- rede: a função tenta, e o `unique_violation` faz tentar de novo.
-- Sequência do Postgres não serve porque o número zera a cada ano.
-- ---------------------------------------------------------------------
create or replace function proximo_recibo(p_ano int) returns int as $$
declare
  n int;
begin
  select coalesce(max(numero), 0) + 1 into n from fin_recibo where ano = p_ano;
  return n;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

revoke all on function proximo_recibo(int) from public;
grant execute on function proximo_recibo(int) to authenticated;

-- ---------------------------------------------------------------------
-- RLS: a mesma do resto do financeiro (0021).
-- ---------------------------------------------------------------------
alter table fin_recibo enable row level security;

create policy fin_recibo_le on fin_recibo
  for select to authenticated using (e_financeiro());

create policy fin_recibo_escreve on fin_recibo
  for insert to authenticated with check (e_financeiro());

-- Apagar é do gerente: recibo emitido some com a prova de que a via
-- existe, e isso é conversa de gerente.
create policy fin_recibo_apaga on fin_recibo
  for delete to authenticated using (e_gerente());
