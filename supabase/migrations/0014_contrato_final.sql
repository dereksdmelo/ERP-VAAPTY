-- 0014 — o contrato final e quem compra
--
-- O contrato particular de compra e venda mediante intermediação é
-- entre a Vaapty e o COMPRADOR — o lojista que leva o carro. Esse é um
-- terceiro que o sistema não conhecia: o atendimento inteiro fala do
-- cliente que vende, e o comprador só aparecia como texto solto no
-- nome do lojista da proposta.
--
-- O preâmbulo do contrato pede seis dados dele. Sem coluna, o contrato
-- sairia com seis lacunas — e papel com lacuna volta para ser
-- preenchido depois, que é como contrato acaba assinado pela metade.

alter table atendimento add column if not exists comprador_nome         text;
alter table atendimento add column if not exists comprador_cpf          text;
alter table atendimento add column if not exists comprador_nacionalidade text;
alter table atendimento add column if not exists comprador_estado_civil text;
alter table atendimento add column if not exists comprador_profissao    text;
alter table atendimento add column if not exists comprador_endereco     text;

comment on column atendimento.comprador_nome is
  'O lojista que compra o carro. É a outra parte do contrato final, não o cliente que vende.';

-- A assinatura eletrônica (cláusula décima quinta). O token é o
-- identificador do documento no ZapSign, não segredo: o segredo é a
-- chave da conta, que fica em variável de ambiente e nunca no banco.
alter table atendimento add column if not exists contrato_zapsign_token text;
alter table atendimento add column if not exists contrato_enviado_em    timestamptz;
alter table atendimento add column if not exists contrato_assinado_em   timestamptz;

create index if not exists atendimento_zapsign_idx
  on atendimento (contrato_zapsign_token) where contrato_zapsign_token is not null;
