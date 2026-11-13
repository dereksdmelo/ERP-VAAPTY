-- 0155 · Bloquear a agenda em dias escolhidos (13/11/2026, o Derek: "bloquear a agenda em dia x, ou dia x…
-- porque às vezes tem feriado"). Uma lista na configuração da loja, que o agendador da equipe e a Flávia já
-- leem (0068): [{ dia: 'AAAA-MM-DD', motivo, das?: 'HH:MM', ate?: 'HH:MM' }]. Sem das/até, o dia inteiro.
alter table config_loja add column if not exists bloqueios jsonb not null default '[]'::jsonb;

insert into schema_migrations(arquivo) values ('0155_agenda_bloqueios.sql') on conflict do nothing;
