-- 0016 — como avisar o comprador para assinar
--
-- O ZapSign precisa de e-mail ou telefone para mandar o convite de
-- assinatura. A 0014 trouxe os seis dados do preâmbulo do contrato,
-- que são os que o papel exige — nenhum deles serve para chamar a
-- pessoa. Guardar em vez de digitar de novo a cada reenvio.

alter table atendimento add column if not exists comprador_email    text;
alter table atendimento add column if not exists comprador_telefone text;

comment on column atendimento.comprador_email is
  'Para onde o ZapSign manda o convite de assinatura. Não entra no texto do contrato.';
