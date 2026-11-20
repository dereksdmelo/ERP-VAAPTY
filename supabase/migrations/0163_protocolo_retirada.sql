-- 0163 · O protocolo de retirada do veículo (20/11/2026, pedido da Bruna pelo botão de suporte, aprovado pelo
-- Derek): a folha "Retirada de veículo" sai do check list de documentações, assina-se na caneta ou pelo link,
-- e entra no registro de documentos — a via assinada vale como papel do item "Protocolo de Retirada".
alter type tipo_documento add value if not exists 'protocolo_retirada';
notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0163_protocolo_retirada.sql') on conflict do nothing;
