-- 0145 · Cancelamento com multa contratual (10/11/2026, o Derek). O cliente aceitou a proposta e desistiu: a
-- multa do termo de aceite vai para a rentabilidade e para a meta de quem atendeu. Como a comissão de indicação
-- (0067), é uma linha do estoque já vendida, compra zero e venda igual à multa — a natureza 'multa' é o que a
-- separa de carro que passou pelo pátio. `transferido_em` vai preenchido para ela não cair em Transferências.
alter table estoque drop constraint if exists estoque_natureza_check;
alter table estoque add constraint estoque_natureza_check check (natureza in ('compra', 'indicacao', 'multa'));



-- A INDICAÇÃO E A MULTA NÃO PRECISAM DA FICHA DO CARRO (o Derek, no mesmo dia: "ele tá pedindo todo o cadastro
-- do carro… basta o cadastro do lojista, pois é uma simples indicação"). Sem veículo, a linha pende só do
-- atendimento, e o carro vai em texto em `descricao_carro`. Carro de verdade continua exigindo o veículo.
alter table estoque alter column veiculo_id drop not null;
alter table estoque add column if not exists descricao_carro text;
alter table estoque drop constraint if exists estoque_veiculo_ou_nao_carro;
alter table estoque add constraint estoque_veiculo_ou_nao_carro check (veiculo_id is not null or natureza in ('indicacao', 'multa'));

insert into schema_migrations(arquivo) values ('0145_multa_contratual.sql') on conflict do nothing;
