-- =====================================================================
-- 0007 — CPF, RG e endereço do cliente
--
-- Os contratos precisam desses três campos. Até aqui eles saíam como
-- lacuna laranja na folha, para preencher à mão — que é como o papel
-- funciona hoje.
--
-- Regra da casa: só imprime documento com os dados completos. Papel com
-- campo em branco volta para ser preenchido depois, e é assim que
-- contrato acaba assinado incompleto.
--
-- Estes campos são dado pessoal, como nome e telefone: valem as mesmas
-- políticas da 0004, e a mesma conversa com o jurídico sobre retenção
-- que está pendente.
-- =====================================================================

alter table atendimento add column if not exists cliente_cpf       text;
alter table atendimento add column if not exists cliente_rg        text;
alter table atendimento add column if not exists cliente_endereco  text;
