-- =====================================================================
-- 0125 — Acessos mais estreitos (08/11/2026, da varredura do sistema)
--
-- 1) checklist: conta e PIX do cliente eram lidos e alterados por toda
--    a equipe (pré-venda inclusive) pela política `for all e_equipe()`.
--    Agora: o dono do atendimento (ou atendimento sem dono), o
--    administrativo e o financeiro (que incluem o gerente). Apagar é do
--    gerente.
-- 2) Apagar veículo, documento, conversa ou mensagem era possível a
--    qualquer login pela mesma política. Agora só o gerente apaga; o
--    resto (ler, criar, alterar) continua da equipe.
-- 3) Apagar a ficha do veículo levava o carro do estoque e os
--    recebimentos conciliados em cascata. Agora a cascata é `restrict`.
-- =====================================================================

-- 1) checklist
drop policy if exists checklist_equipe on checklist;
drop policy if exists checklist_le on checklist;
drop policy if exists checklist_grava on checklist;
drop policy if exists checklist_apaga on checklist;
create policy checklist_le on checklist for select to authenticated
  using (e_adm() or e_financeiro() or exists (
    select 1 from atendimento a where a.id = checklist.atendimento_id
       and (a.negociador_id = auth.uid() or a.negociador_id is null)));
create policy checklist_ins on checklist for insert to authenticated
  with check (e_adm() or e_financeiro() or exists (
    select 1 from atendimento a where a.id = checklist.atendimento_id
       and (a.negociador_id = auth.uid() or a.negociador_id is null)));
create policy checklist_upd on checklist for update to authenticated
  using (e_adm() or e_financeiro() or exists (
    select 1 from atendimento a where a.id = checklist.atendimento_id
       and (a.negociador_id = auth.uid() or a.negociador_id is null)))
  with check (e_adm() or e_financeiro() or exists (
    select 1 from atendimento a where a.id = checklist.atendimento_id
       and (a.negociador_id = auth.uid() or a.negociador_id is null)));
create policy checklist_del on checklist for delete to authenticated using (e_gerente());

-- 2) leitura/criação/alteração da equipe, exclusão do gerente
do $$
declare t record;
begin
  for t in select * from (values
      ('veiculo','veiculo_equipe'), ('documento','documento_equipe'),
      ('wa_conversa','wa_conversa_esc'), ('wa_mensagem','wa_mensagem_esc')) v(tab, pol)
  loop
    execute format('drop policy if exists %I on %I', t.pol, t.tab);
    execute format('drop policy if exists %I on %I', t.tab || '_sel', t.tab);
    execute format('drop policy if exists %I on %I', t.tab || '_ins', t.tab);
    execute format('drop policy if exists %I on %I', t.tab || '_upd', t.tab);
    execute format('drop policy if exists %I on %I', t.tab || '_del', t.tab);
    execute format('create policy %I on %I for select to authenticated using (e_equipe())', t.tab || '_sel', t.tab);
    execute format('create policy %I on %I for insert to authenticated with check (e_equipe())', t.tab || '_ins', t.tab);
    execute format('create policy %I on %I for update to authenticated using (e_equipe()) with check (e_equipe())', t.tab || '_upd', t.tab);
    execute format('create policy %I on %I for delete to authenticated using (e_gerente())', t.tab || '_del', t.tab);
  end loop;
end $$;

-- 3) cascatas que levavam o dinheiro junto
do $$
declare c record;
begin
  for c in
    select con.conname, con.conrelid::regclass as tab, a.attname as col, con.confrelid::regclass as ref
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
     where con.contype = 'f' and con.confdeltype = 'c'
       and ((con.conrelid = 'estoque'::regclass and a.attname = 'veiculo_id')
         or (con.conrelid = 'fin_recebimento'::regclass and a.attname = 'estoque_id'))
  loop
    execute format('alter table %s drop constraint %I', c.tab, c.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references %s(id) on delete restrict',
                   c.tab, c.conname, c.col, c.ref);
  end loop;
end $$;
