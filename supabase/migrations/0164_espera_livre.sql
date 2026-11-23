-- 0164 · A espera depois de ficar livre (23/11/2026, o Derek: "quando alguém marca que está livre, tem que passar
-- pelo menos 10 minutos pra ser a vez dele… configurável pelo gestor"). `presenca.livre_em` é o "Estou livre" de
-- quem estava fora da fila; `config_loja.fila_espera_livre_min` são os minutos (0 desliga). A regra mora em
-- regras/fila.js; quem escreve a configuração é o gerente, pela RLS que a config_loja já tem.
alter table presenca add column if not exists livre_em timestamptz;
alter table config_loja add column if not exists fila_espera_livre_min integer not null default 10
  check (fila_espera_livre_min between 0 and 60);
notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0164_espera_livre.sql') on conflict do nothing;
