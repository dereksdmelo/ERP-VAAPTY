-- 0160 · Os papéis da desistência (16/11/2026): o termo de desistência unilateral e a nota promissória da
-- multa, impressos no "Cancelar com multa", entram no registro de documentos como os outros.
alter type tipo_documento add value if not exists 'termo_desistencia';
alter type tipo_documento add value if not exists 'nota_promissoria';
notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0160_desistencia.sql') on conflict do nothing;
