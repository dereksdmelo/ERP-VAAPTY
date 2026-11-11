-- 0152 · O contrato final assinado fora do ZapSign (11/11/2026, o Derek: "se o contrato for assinado por outro
-- meio preciso registrar a venda e o estoque do mesmo jeito"). `contrato_assinado_em` passa a valer para os dois
-- caminhos; `contrato_assinado_fora` diz qual ('papel' ou 'outro'; nulo = ZapSign). Reenviar ao ZapSign zera os dois.
alter table atendimento add column if not exists contrato_assinado_fora text check (contrato_assinado_fora in ('papel', 'outro'));

insert into schema_migrations(arquivo) values ('0152_contrato_assinado_fora.sql') on conflict do nothing;
