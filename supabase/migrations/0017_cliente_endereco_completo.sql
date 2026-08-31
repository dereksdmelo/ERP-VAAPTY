-- 0017 — o endereço do cliente como o contrato pede
--
-- O instrumento de aceite de proposta qualifica a CONTRATANTE com
-- cidade, estado, CEP, endereço e bairro em campos separados, mais
-- e-mail. A 0007 guardava o endereço como uma linha só, e não havia
-- e-mail em lugar nenhum.
--
-- O e-mail não é enfeite: é para onde o ZapSign manda o convite de
-- assinatura, e neste contrato quem assina é o cliente.
--
-- Tudo isso está no CRLV que o negociador já anexa na Pesquisa — a
-- ideia é ler de lá, não perguntar ao cliente.

alter table atendimento add column if not exists cliente_email  text;
alter table atendimento add column if not exists cliente_cidade text;
alter table atendimento add column if not exists cliente_uf     text;
alter table atendimento add column if not exists cliente_cep    text;
alter table atendimento add column if not exists cliente_bairro text;

comment on column atendimento.cliente_email is
  'Para onde o ZapSign manda o convite. Neste contrato quem assina é o cliente.';
