-- 0171 · Horários especiais da agenda (23/11/2026, o Derek: "no sábado, último sábado do mês normalmente temos um
-- horário estendido de atendimento… a IA precisa agendar pra esses horários"). Uma lista na configuração da loja,
-- ao lado dos bloqueios (0155), que o agendador da equipe e a Flávia já leem (0068):
--   [{ dia: 'AAAA-MM-DD', primeiro: 'HH:MM', ultimo: 'HH:MM', motivo }]           -- uma data
--   [{ regra: 'ultimo_sabado', primeiro: 'HH:MM', ultimo: 'HH:MM', motivo }]      -- todo mês
-- O horário especial TROCA o do dia (primeiro e último agendamento). A data ganha da regra; o bloqueio ganha dos dois.
alter table config_loja add column if not exists horarios_especiais jsonb not null default '[]'::jsonb;

insert into schema_migrations(arquivo) values ('0171_horarios_especiais.sql') on conflict do nothing;
