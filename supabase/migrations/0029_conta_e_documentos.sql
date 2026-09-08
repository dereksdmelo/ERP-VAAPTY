-- =====================================================================
-- 0029 — A conta do negócio composta, e o check list que aceita item novo
--
-- Três buracos que apareceram no uso:
--
-- 1. **"Débitos" era um número só.** Na mesa se diz "R$ 1.200 de
--    débitos"; no envelope, três meses depois, ninguém sabe se era
--    IPVA, licenciamento ou multa — e é essa lista que o cliente
--    contesta. `debitos_itens` guarda o detalhe, e `valor_debitos`
--    passa a ser a soma dele quando ele existe.
--
-- 2. **Nem todo negócio desconta as mesmas linhas.** No negócio com
--    comissão saem cautelar, débitos, quitação e comissão; no negócio
--    "limpo" a comissão não sai — o valor combinado já é o que o
--    cliente leva. Somar comissão num negócio limpo tira dinheiro do
--    cliente no papel que ele assina. `modo_conta` diz qual é.
--
-- 3. **"Entre outros".** Despachante, guincho, segunda via de chave:
--    descontos que existem e não têm linha fixa. `descontos_extras`
--    é a lista deles.
--
-- E o check list de documentações passa a aceitar item que a casa
-- inventa para um carro específico (`extra_...`), com o rótulo na
-- própria linha — a lista fixa continua no código, como na 0027.
-- =====================================================================

alter table checklist
  add column if not exists debitos_itens     jsonb not null default '[]'::jsonb,
  add column if not exists descontos_extras  jsonb not null default '[]'::jsonb,
  add column if not exists modo_conta        text  not null default 'com_comissao';

alter table checklist
  drop constraint if exists checklist_modo_conta_ck;
alter table checklist
  add constraint checklist_modo_conta_ck check (modo_conta in ('com_comissao', 'limpo'));

comment on column checklist.debitos_itens is
  'Detalhe dos débitos: [{descricao, valor}]. Quando tem item, valor_debitos é a soma.';
comment on column checklist.descontos_extras is
  'Descontos que não têm linha fixa: [{descricao, valor, custo}]. custo=false é retenção nossa, não desembolso.';
comment on column checklist.modo_conta is
  'com_comissao: a comissão Vaapty sai do valor. limpo: não sai — o combinado já é o líquido.';

-- ---------------------------------------------------------------------
-- Item extra no check list de documentações.
--
-- A lista fixa segue no código (0027) porque muda com o processo, não
-- com o carro. Estas colunas são para o item que existe só neste
-- carro — o laudo que a seguradora pediu, o distrato daquele caso.
-- ---------------------------------------------------------------------
alter table checklist_doc
  add column if not exists rotulo   text,
  add column if not exists grupo    text,
  add column if not exists pede_doc boolean not null default true;

-- Apagar item extra é do administrativo também, não só do gerente: quem
-- criou por engano precisa poder desfazer sem chamar alguém.
drop policy if exists checklist_doc_apaga_extra on checklist_doc;
create policy checklist_doc_apaga_extra on checklist_doc
  for delete to authenticated using (e_adm() and item like 'extra%');
