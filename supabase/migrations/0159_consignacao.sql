-- 0159 · O termo de consignação (16/11/2026, o Derek: "pra quando os negociadores quiserem consignar os
-- carros dos clientes. Precisa estar na fase de negociação. E pra colocar status consignado tem que ter esse
-- termo… os carros consignados devem aparecer no estoque, de maneira separada, com uma cor diferente").
--
-- O termo impresso grava `consignado_em`, o valor estimado e o prazo no atendimento; o status "consignado"
-- é recusado sem ele (api/atendimento.js). O Estoque lê os atendimentos em Consignado à parte: o carro não é
-- da loja, então não entra na tabela `estoque` nem no custo do pátio. "Tirar" muda o status e grava o fim.
alter type tipo_documento add value if not exists 'termo_consignacao';

alter table atendimento add column if not exists consignado_em timestamptz;
alter table atendimento add column if not exists consignado_valor numeric(14,2);
alter table atendimento add column if not exists consignado_dias int;
alter table atendimento add column if not exists consignado_ate date;
alter table atendimento add column if not exists consignado_fim_em timestamptz;

-- Os que já estão em Consignado (antes do termo existir no sistema) continuam valendo: contam como tendo termo.
update atendimento set consignado_em = coalesce(consignado_em, criado_em) where status = 'consignado';

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0159_consignacao.sql') on conflict do nothing;
