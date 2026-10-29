-- =====================================================================
-- 0091 — A lista de documentos exigidos é editável
--
-- O Derek, em 28/10/2026, olhando o check list de documentações:
-- "lista de documentos exigidos editável". A 0027 deixou a lista no
-- código (ITENS_DOC, api/checklist.js) porque "muda quando a casa muda o
-- processo" — e é justamente por isso que ela tem que mudar sem deploy:
-- quem muda o processo é o gerente, não o programador.
--
-- O código do item é a chave que amarra o visto (checklist_doc.item) e o
-- anexo ("doc:<codigo>"). Por isso o item se DESATIVA, não se apaga, e o
-- rótulo pode mudar à vontade: o código fica.
-- =====================================================================

create table if not exists doc_exigido (
  codigo        text primary key,
  rotulo        text not null,
  grupo         text not null default 'pf',
  vistos        text not null default 'tres' check (vistos in ('tres', 'um')),
  pede_doc      boolean not null default true,
  ordem         int not null default 0,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

alter table doc_exigido enable row level security;
drop policy if exists doc_exigido_le on doc_exigido;
create policy doc_exigido_le on doc_exigido for select to authenticated using (e_equipe());
drop policy if exists doc_exigido_grava on doc_exigido;
create policy doc_exigido_grava on doc_exigido for insert to authenticated with check (e_gerente());
drop policy if exists doc_exigido_muda on doc_exigido;
create policy doc_exigido_muda on doc_exigido for update to authenticated using (e_gerente()) with check (e_gerente());

-- O ponto de partida é a lista que estava no código em 28/10/2026.
insert into doc_exigido (codigo, rotulo, grupo, vistos, pede_doc, ordem) values
  ('fechamento', 'Check List Fechamento', 'pf', 'tres', true, 10),
  ('resumo_negociacao', 'Resumo Negociação Sances', 'pf', 'tres', true, 20),
  ('procuracao', 'Procuração', 'pf', 'tres', true, 30),
  ('crv_dut', 'CRV/DUT', 'pf', 'tres', true, 40),
  ('crlv', 'CRLV', 'pf', 'tres', true, 50),
  ('dossie_detran', 'Dossiê Detran', 'pf', 'tres', true, 60),
  ('prf', 'PRF', 'pf', 'tres', true, 70),
  ('divida_ativa', 'Dívida Ativa', 'pf', 'tres', true, 80),
  ('cnh_contratante', 'CNH Contratante', 'pf', 'tres', true, 90),
  ('cnh_proprietario', 'CNH Proprietário', 'pf', 'tres', true, 100),
  ('comprovante_residencia', 'Comprovante de Residência', 'pf', 'tres', true, 110),
  ('serasa', 'Consulta Serasa', 'pf', 'tres', true, 120),
  ('pre_contrato', 'Pré-contrato', 'pf', 'tres', true, 130),
  ('contrato', 'Contrato', 'pf', 'tres', true, 140),
  ('cautelar', 'Cautelar veículo', 'pf', 'tres', true, 150),
  ('manual', 'Manual', 'pf', 'tres', false, 160),
  ('chave_reserva', 'Chave Reserva', 'pf', 'tres', false, 170),
  ('gnv_selo', 'GNV, Selo Atualizado?', 'pf', 'tres', false, 180),
  ('placa_mercosul', 'Tem placa Mercosul?', 'pf', 'tres', false, 190),
  ('trocar_placa', 'Trocar de Placa?', 'pf', 'tres', false, 200),
  ('tem_financiamento', 'Tem Financiamento?', 'pf', 'tres', false, 210),
  ('financiamento_incluso', 'Financiamento está Incluso?', 'pf', 'tres', false, 220),
  ('financiamento_quitado', 'Financiamento está Quitado?', 'pf', 'tres', false, 230),
  ('tem_debitos', 'Tem Débitos?', 'pf', 'tres', false, 240),
  ('debitos_cobrados', 'Foi cobrado os Débitos?', 'pf', 'tres', false, 250),
  ('debitos_pagos', 'Vai ser pago os Débitos?', 'pf', 'tres', false, 260),
  ('cartao_cnpj', 'Cartão CNPJ', 'pj', 'tres', true, 270),
  ('contrato_social', 'Contrato Social', 'pj', 'tres', true, 280),
  ('documentos_socios', 'Documentos Sócios', 'pj', 'tres', true, 290),
  ('multas_duplicacao', 'Multas (Duplicação)', 'pj', 'tres', true, 300),
  ('arq_comprovante_cliente', 'Comprovante Cliente', 'arquivamento', 'um', true, 310),
  ('arq_comprovante_lojista', 'Comprovante Lojista', 'arquivamento', 'um', true, 320),
  ('arq_contrato_lojista', 'Contrato Lojista', 'arquivamento', 'um', true, 330),
  ('arq_protocolo_retirada', 'Protocolo de Retirada', 'arquivamento', 'um', true, 340),
  ('transf_dut_atpv', 'Cópia DUT ou ATPV Reconhecida', 'transferencia', 'um', true, 350),
  ('transf_procuracao', 'Cópia Procuração', 'transferencia', 'um', true, 360),
  ('transf_comunicado_venda', 'Comunicado Venda', 'transferencia', 'um', true, 370)
on conflict (codigo) do nothing;
