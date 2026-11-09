-- 0139 · Os campos que a declaração da NFS-e nacional pede (Anexo I, leiaute 1.01):
-- o regime de apuração do Simples (obrigatório para ME/EPP, E0166) e o percentual de tributos do
-- Simples que vai em totTrib; e o endereço do tomador, obrigatório quando ele é CNPJ (E0235).
alter table empresa add column if not exists regime_apuracao_sn text default '1';
alter table empresa add column if not exists perc_tot_trib_sn numeric(5,2);
alter table nfse add column if not exists tomador_cep text;
alter table nfse add column if not exists tomador_logradouro text;
alter table nfse add column if not exists tomador_numero text;
alter table nfse add column if not exists tomador_bairro text;
alter table nfse add column if not exists tomador_cmun text;
