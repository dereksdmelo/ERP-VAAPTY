-- =====================================================================
-- 0089 — A esteira do negócio fechado: revisar, aprovar, pagar
--
-- O Derek, em 28/10/2026, olhando o Administrativo:
--   negócios fechados (revisar) — o adm coloca todos os itens
--   aprovações — os gerentes analisam os documentos revisados pelo adm,
--     pelo menos dois revisores
--   pagamentos a realizar — os revisados e aprovados que precisam ser
--     pagos, e a opção de ver os que ainda estão em revisão, para
--     programar o fluxo de caixa
--
-- A etapa não é coluna: sai de revisado_em, das aprovações e de pago_em
-- (api/checklist.js, `etapaDe`). Quem carimba é o servidor, a partir do
-- token — a mesma régua do adm_conferido_por (0008).
-- =====================================================================

alter table checklist
  add column if not exists revisado_em  timestamptz,
  add column if not exists revisado_por uuid references perfil(id),
  add column if not exists pago_em      timestamptz,
  add column if not exists pago_por     uuid references perfil(id),
  add column if not exists pago_obs     text;

-- Uma decisão por gerente por negócio. Refazer a decisão sobrescreve a
-- linha (e o criado_em): a aprovação vale para a revisão que ela viu, e
-- a que é mais velha que o revisado_em deixa de contar.
create table if not exists aprovacao_negocio (
  id             uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references atendimento(id) on delete cascade,
  perfil_id      uuid not null default auth.uid() references perfil(id),
  decisao        text not null check (decisao in ('aprovado', 'devolvido')),
  motivo         text,
  criado_em      timestamptz not null default now(),
  unique (atendimento_id, perfil_id)
);
create index if not exists aprovacao_negocio_at on aprovacao_negocio (atendimento_id);

alter table aprovacao_negocio enable row level security;
drop policy if exists aprovacao_le on aprovacao_negocio;
create policy aprovacao_le on aprovacao_negocio for select to authenticated using (e_equipe());
-- Cada gerente só escreve a própria decisão: aprovação em nome de outro
-- tiraria o sentido de "dois revisores".
drop policy if exists aprovacao_grava on aprovacao_negocio;
create policy aprovacao_grava on aprovacao_negocio for insert to authenticated
  with check (perfil_id = auth.uid() and e_gerente());
drop policy if exists aprovacao_muda on aprovacao_negocio;
create policy aprovacao_muda on aprovacao_negocio for update to authenticated
  using (perfil_id = auth.uid() and e_gerente()) with check (perfil_id = auth.uid() and e_gerente());
drop policy if exists aprovacao_apaga on aprovacao_negocio;
create policy aprovacao_apaga on aprovacao_negocio for delete to authenticated
  using (perfil_id = auth.uid() and e_gerente());
