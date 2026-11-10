-- 0144 · O TRANSBORDO da fila da vez (10/11/2026, o Derek: "certas épocas do mês nós fazemos o transbordo:
-- alguns negociadores que estão com conversão abaixo de XX não vão para a fila da vez, apenas atendem na vez
-- deles se todos estiverem ocupados atendendo"). Só o gerente põe ou tira — à mão, ou pelo gatilho automático.
--
-- À mão é uma linha por pessoa: 'dentro' põe, 'fora' segura fora mesmo que o gatilho diga o contrário. Sem
-- linha, vale o automático. A marca vale até o gerente tirar (não é por dia: o transbordo dura uma época).
create table if not exists fila_transbordo (
  perfil_id  uuid primary key references perfil(id) on delete cascade,
  modo       text not null check (modo in ('dentro', 'fora')),
  motivo     text,
  por        uuid default auth.uid(),
  em         timestamptz not null default now()
);
alter table fila_transbordo enable row level security;
drop policy if exists fila_transbordo_le on fila_transbordo;
create policy fila_transbordo_le on fila_transbordo for select to authenticated using (e_equipe());
drop policy if exists fila_transbordo_gere on fila_transbordo;
create policy fila_transbordo_gere on fila_transbordo for all to authenticated using (e_gerente()) with check (e_gerente());

-- O gatilho automático, na configuração da loja (uma linha, o gerente escreve — 0068): ligado, a conversão
-- do mês ATÉ ONTEM abaixo de tanto (fração: 0.15 = 15%), com pelo menos tantos atendimentos no mês (no dia 2
-- todo mundo tem 0%), e opcionalmente só entre dois dias do mês.
alter table config_loja add column if not exists transbordo_auto boolean not null default false;
alter table config_loja add column if not exists transbordo_abaixo numeric not null default 0.15;
alter table config_loja add column if not exists transbordo_minimo int not null default 10;
alter table config_loja add column if not exists transbordo_dia_de int check (transbordo_dia_de between 1 and 31);
alter table config_loja add column if not exists transbordo_dia_ate int check (transbordo_dia_ate between 1 and 31);

insert into schema_migrations(arquivo) values ('0144_fila_transbordo.sql') on conflict do nothing;
