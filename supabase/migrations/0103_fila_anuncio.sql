-- =====================================================================
-- 0103 — Quem foi anunciado segura a vez
--
-- O Derek, em 03/11/2026: "teve um momento que todos estavam atendendo
-- e o Carlos seria o próximo. Daí ia ser o Carlos mas o Dimas terminou
-- de atender, aí de repente começou a ser a vez do Dimas". A regra da 0085
-- punha o livre na frente de quem tem cliente; ele escolheu: quando
-- todos estão ocupados, o próximo ANUNCIADO segura a vez até pegar um
-- cliente, mesmo que outro libere antes.
--
-- A vez é calculada a cada leitura (decisão 67), então o anúncio precisa
-- ficar gravado: uma linha por dia, com quem e desde quando. Vale até ele
-- abrir atendimento novo depois disso, sair da fila, ou o dia virar.
-- =====================================================================

create table if not exists fila_anuncio (
  dia       date primary key,
  perfil_id uuid not null references perfil(id) on delete cascade,
  desde     timestamptz not null default now()
);
alter table fila_anuncio enable row level security;
drop policy if exists fila_anuncio_equipe on fila_anuncio;
create policy fila_anuncio_equipe on fila_anuncio for all to authenticated using (e_equipe()) with check (e_equipe());
