-- 0156 · "A fazer" é quem ninguém procurou nem anotou (13/11/2026, o Derek: "os 'a fazer' deveria ser os que não
-- foram contatados e nem feito anotação ainda"). Toda ação da tela Recuperar leads — ligar, WhatsApp, anotar,
-- agendar, retornar, sem chance — e toda ligação registrada carimbam `recuperacao_tocado_em`; comparado com
-- `recuperacao_em` (a designação), diz se o lead já foi trabalhado.
alter table lead add column if not exists recuperacao_tocado_em timestamptz;

insert into schema_migrations(arquivo) values ('0156_recuperacao_tocado.sql') on conflict do nothing;
