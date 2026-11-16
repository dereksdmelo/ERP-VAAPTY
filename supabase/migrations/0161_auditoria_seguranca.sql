-- 0161 · Auditoria de segurança (16/11/2026, depois da conta "redteam.probe.vaapty").
--
-- 1) O check list (conta e PIX do cliente) era lido por QUALQUER negociador em 28 de 39 atendimentos. A 0125 já
--    deixava só o dono, mas "atendimento sem dono" contava como de todos — e 603 de 731 atendimentos não têm
--    `negociador_id` (o "Chegou" da pré-venda nasce sem ele; fica só o nome). Agora o atendimento sem id vale pelo
--    NOME do negociador, comparado sem acento com o nome do login dele (perfil) ou da meta ligada a ele. Atendimento
--    sem id e sem nome continua da equipe, porque não há como saber de quem é. Adm, financeiro e gerente veem todos.
-- 2) `mensagem` e `escuta_sessao`: o UPDATE tinha `with check (true)` — quem podia editar uma linha podia movê-la
--    para outro atendimento. O check agora é a mesma regra do using.
-- 3) `proximo_recibo` respondia a quem não tem login quantos recibos a loja emitiu no ano.
create or replace function e_dono_do_atendimento(p_id uuid, p_nome text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select e_equipe() and (
    p_id = auth.uid()
    or (p_id is null and (
      coalesce(btrim(p_nome), '') = ''
      or nome_chave(p_nome) in (
        select nome_chave(nome) from perfil where id = auth.uid()
        union
        select nome_chave(nome) from negociador where perfil_id = auth.uid())))
  );
$$;
revoke all on function e_dono_do_atendimento(uuid, text) from public, anon;
grant execute on function e_dono_do_atendimento(uuid, text) to authenticated;

drop policy if exists checklist_le on checklist;
drop policy if exists checklist_ins on checklist;
drop policy if exists checklist_upd on checklist;
create policy checklist_le on checklist for select to authenticated
  using (e_adm() or e_financeiro() or exists (
    select 1 from atendimento a where a.id = checklist.atendimento_id
       and e_dono_do_atendimento(a.negociador_id, a.negociador_nome)));
create policy checklist_ins on checklist for insert to authenticated
  with check (e_adm() or e_financeiro() or exists (
    select 1 from atendimento a where a.id = checklist.atendimento_id
       and e_dono_do_atendimento(a.negociador_id, a.negociador_nome)));
create policy checklist_upd on checklist for update to authenticated
  using (e_adm() or e_financeiro() or exists (
    select 1 from atendimento a where a.id = checklist.atendimento_id
       and e_dono_do_atendimento(a.negociador_id, a.negociador_nome)))
  with check (e_adm() or e_financeiro() or exists (
    select 1 from atendimento a where a.id = checklist.atendimento_id
       and e_dono_do_atendimento(a.negociador_id, a.negociador_nome)));

drop policy if exists mensagem_marca_lida on mensagem;
create policy mensagem_marca_lida on mensagem
  for update to authenticated using (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = mensagem.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)))
  with check (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = mensagem.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)));

drop policy if exists escuta_sessao_responde on escuta_sessao;
create policy escuta_sessao_responde on escuta_sessao
  for update to authenticated using (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = escuta_sessao.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)))
  with check (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = escuta_sessao.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)));

create or replace function proximo_recibo(p_ano int) returns int as $$
declare
  n int;
begin
  if not e_financeiro() then return null; end if;
  select coalesce(max(numero), 0) + 1 into n from fin_recibo where ano = p_ano;
  return n;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;
revoke all on function proximo_recibo(int) from public, anon;
grant execute on function proximo_recibo(int) to authenticated;

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0161_auditoria_seguranca.sql') on conflict do nothing;
