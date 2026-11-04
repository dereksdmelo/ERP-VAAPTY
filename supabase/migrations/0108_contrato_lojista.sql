-- =====================================================================
-- 0108 — O contrato do lojista
--
-- A Schell, em 04/11/2026: "como faz o contrato do lojista? fui em
-- estoque e lancei a venda no nome do investidor mas ele não gera nada
-- para contrato". O contrato da casa ("Instrumento particular de compra
-- de veículo mediante intermediação", o PDF da Pereira Automóveis) pede
-- do comprador o que o cadastro da 0019 não tinha: endereço completo, RG
-- ou inscrição estadual, e o representante legal quando o comprador é
-- empresa. Ficam no cadastro: o mesmo lojista leva dezenas de carros, e
-- digitar o endereço dele em cada contrato é como o contrato sai em
-- branco.
--
-- O documento entra no registro (0003) como `contrato_lojista`.
-- `add value` roda sozinho, fora de transação (decisão 19).
-- =====================================================================

alter table comprador add column if not exists rg_ie        text;
alter table comprador add column if not exists endereco     text;
alter table comprador add column if not exists bairro       text;
alter table comprador add column if not exists cep          text;
alter table comprador add column if not exists rep_nome     text;
alter table comprador add column if not exists rep_cpf      text;
alter table comprador add column if not exists rep_rg       text;
alter table comprador add column if not exists rep_endereco text;
alter table comprador add column if not exists rep_bairro   text;
alter table comprador add column if not exists rep_cidade   text;
alter table comprador add column if not exists rep_uf       text;
alter table comprador add column if not exists rep_cep      text;
alter table comprador add column if not exists rep_contato  text;
alter table comprador add column if not exists rep_email    text;
alter table comprador add column if not exists rep_especie  text;

-- Rodar SOZINHO, depois do resto:
alter type tipo_documento add value if not exists 'contrato_lojista';
