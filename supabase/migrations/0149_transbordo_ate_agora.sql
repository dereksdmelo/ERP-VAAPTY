-- 0149 · O gatilho do transbordo conta a conversão "até ontem" ou "até agora" (10/11/2026, o Derek: "precisava
-- ser até agora, ou ter a opção de selecionar um ou outro"). Até ontem não muda no meio do dia; até agora reage ao
-- carro que fechou hoje — e pode tirar ou pôr alguém no transbordo durante o expediente.
alter table config_loja add column if not exists transbordo_base text not null default 'ontem' check (transbordo_base in ('ontem', 'agora'));

insert into schema_migrations(arquivo) values ('0149_transbordo_ate_agora.sql') on conflict do nothing;
