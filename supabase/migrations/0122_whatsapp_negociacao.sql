-- =====================================================================
-- 0122 — O número de WhatsApp dos negociadores (08/11/2026)
--
-- O Derek: "ter um número de whats da loja que os negociadores possam
-- conversar com os clientes e fique registrado… fazer anotações a partir
-- dali no atendimento daquele cliente… e gerar agendamentos de
-- recuperação a partir dali."
--
-- Até aqui o número era comercial (pré-venda: quem escreve vira lead) ou
-- de operação (o adm: lojista, cartório). O da negociação é um terceiro
-- uso: não cria lead (o cliente já é atendimento) e não entra na caixa do
-- adm. `uso` diz qual; `comercial` continua sendo o que a ponte e a
-- `wa_receber` olham, e é verdadeiro só no uso comercial.
-- =====================================================================

alter table wa_canal add column if not exists uso text;
update wa_canal set uso = case when comercial then 'comercial' else 'operacao' end where uso is null;
alter table wa_canal alter column uso set default 'comercial';
alter table wa_canal alter column uso set not null;
alter table wa_canal drop constraint if exists wa_canal_uso_check;
alter table wa_canal add constraint wa_canal_uso_check check (uso in ('comercial', 'operacao', 'negociacao'));
