-- =====================================================================
-- 0095 — Aprovação é de REVISOR, não só de gerente
--
-- O Derek, em 28/10/2026: "ao invés de gerente pode chamar de revisor…
-- pois pode ser o gerente, o financeiro, ou eu mesmo… tendo dois está
-- ótimo". A 0089 deixava só `e_gerente()` gravar a decisão; agora vale
-- quem é do financeiro também (`e_financeiro()` já inclui o gerente). A
-- regra que importa continua: cada um grava só a própria decisão, e são
-- duas pessoas diferentes.
-- =====================================================================

drop policy if exists aprovacao_grava on aprovacao_negocio;
create policy aprovacao_grava on aprovacao_negocio for insert to authenticated
  with check (perfil_id = auth.uid() and e_financeiro());
drop policy if exists aprovacao_muda on aprovacao_negocio;
create policy aprovacao_muda on aprovacao_negocio for update to authenticated
  using (perfil_id = auth.uid() and e_financeiro()) with check (perfil_id = auth.uid() and e_financeiro());
drop policy if exists aprovacao_apaga on aprovacao_negocio;
create policy aprovacao_apaga on aprovacao_negocio for delete to authenticated
  using (perfil_id = auth.uid() and e_financeiro());
