-- =====================================================================
-- 0117 — A folha com as pessoas repetidas (07/11/2026)
--
-- O Derek: "mudei os nomes pra colocar nome completo na equipe, aí puxei
-- pro financeiro… duplicou tudo as pessoas… e não dá pra excluir, não dá
-- pra arrumar". O "pôr na folha" da ficha do colaborador criava uma
-- pessoa nova na folha pelo nome completo, sem olhar que a mesma pessoa
-- já estava lá com o nome curto (CARLOS, DIMAS, MARCOS, TIAGO). Cinco
-- cópias nasceram em 06/11/2026; a ficha de cada um continuou ligada ao
-- registro antigo.
--
-- `fin_juntar_funcionario(fica, sai)` move tudo que aponta para quem sai
-- (lançamento, rateio, vale, folha, ficha do colaborador) para quem fica
-- e apaga quem sai. Só o financeiro (ou o gerente).
-- =====================================================================

create or replace function fin_juntar_funcionario(p_fica uuid, p_sai uuid)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_lanc int; v_rat int; v_vale int; v_folha int;
begin
  if not e_financeiro() then raise exception 'só o financeiro junta pessoas da folha' using errcode = '42501'; end if;
  if p_fica = p_sai then raise exception 'escolha duas pessoas diferentes'; end if;
  if not exists (select 1 from fin_funcionario where id = p_fica) or not exists (select 1 from fin_funcionario where id = p_sai) then
    raise exception 'pessoa da folha não encontrada';
  end if;
  update fin_lancamento set funcionario_id = p_fica where funcionario_id = p_sai;
  get diagnostics v_lanc = row_count;
  update fin_rateio set funcionario_id = p_fica where funcionario_id = p_sai;
  get diagnostics v_rat = row_count;
  update fin_vale set funcionario_id = p_fica where funcionario_id = p_sai;
  get diagnostics v_vale = row_count;
  -- A folha é uma linha por pessoa por mês: a de quem sai só passa no mês
  -- em que quem fica não tem linha (a gravada de quem fica manda).
  update fin_folha s set funcionario_id = p_fica
   where s.funcionario_id = p_sai
     and not exists (select 1 from fin_folha f where f.funcionario_id = p_fica and f.competencia = s.competencia);
  get diagnostics v_folha = row_count;
  delete from fin_folha where funcionario_id = p_sai;
  update colaborador set fin_funcionario_id = p_fica where fin_funcionario_id = p_sai;
  update fin_funcionario f set negociador_id = coalesce(f.negociador_id, (select negociador_id from fin_funcionario where id = p_sai))
   where f.id = p_fica;
  delete from fin_funcionario where id = p_sai;
  return jsonb_build_object('lancamentos', v_lanc, 'rateios', v_rat, 'vales', v_vale, 'folhas', v_folha);
end;
$$;
revoke all on function fin_juntar_funcionario(uuid, uuid) from public;
grant execute on function fin_juntar_funcionario(uuid, uuid) to authenticated;
