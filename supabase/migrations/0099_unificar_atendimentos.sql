-- =====================================================================
-- 0099 — Juntar dois atendimentos do mesmo cliente
--
-- O Derek, em 03/11/2026: "o pré-vendas está marcando que o cliente
-- chegou e adicionando o cliente… e ao mesmo tempo alguns negociadores
-- anotaram o carro manual… preciso de um jeito de unificar os
-- atendimentos ou excluir o errado (de preferência o do negociador, já
-- que se excluir o do pré-vendas não vai contar como 'veio' o lead)".
--
-- **Juntar, não excluir.** Nos 24 pares dos últimos 30 dias, em 10 o
-- carro e as fotos estavam só no do negociador — excluir o dele levaria
-- o trabalho; excluir o da pré-venda soltaria o lead. Então um FICA e o
-- outro SAI, e tudo o que o que sai tinha passa para o que fica: o lead
-- (é o `lead.atendimento_id` que faz a visita contar para a pré-venda),
-- o carro, o check list, os documentos, a conversa, a agenda.
--
-- **O que fica é escolhido na tela**, e o padrão é o que tem o carro:
-- é o que está aberto no celular do negociador, e mudar o id debaixo
-- dele faria a tela dele perder a ficha.
--
-- **Quem pode:** o gerente, ou o negociador quando os dois atendimentos
-- são dele (ou sem dono). Apagar atendimento é do gerente pela RLS da
-- 0004; esta função é a exceção estreita, e só apaga depois de mover.
-- =====================================================================

create or replace function unificar_atendimentos(p_fica uuid, p_sai uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f atendimento%rowtype;
  s atendimento%rowtype;
  s_lead boolean;
  f_lead boolean;
  v_solto int := 0;
begin
  if p_fica is null or p_sai is null or p_fica = p_sai then
    raise exception 'Escolha dois atendimentos diferentes.';
  end if;
  select * into f from atendimento where id = p_fica;
  select * into s from atendimento where id = p_sai;
  if f.id is null or s.id is null then raise exception 'Atendimento não encontrado.'; end if;

  if not (e_gerente() or (e_equipe()
          and coalesce(f.negociador_id, auth.uid()) = auth.uid()
          and coalesce(s.negociador_id, auth.uid()) = auth.uid())) then
    raise exception 'Só o gerente junta atendimentos de negociadores diferentes.';
  end if;

  s_lead := exists (select 1 from lead where atendimento_id = s.id);
  f_lead := exists (select 1 from lead where atendimento_id = f.id);

  -- Os dados do cliente: o que fica preenchido não muda; o vazio herda.
  -- A ORIGEM e o PROSPEC vêm de quem veio pelo lead: o negociador que
  -- abriu à mão quase sempre deixou "fluxo", e o lead sabe a verdade.
  update atendimento set
    cliente_nome     = coalesce(nullif(btrim(f.cliente_nome), ''), s.cliente_nome),
    cliente_telefone = coalesce(nullif(btrim(f.cliente_telefone), ''), s.cliente_telefone),
    cliente_cpf      = coalesce(nullif(btrim(f.cliente_cpf), ''), s.cliente_cpf),
    cliente_rg       = coalesce(nullif(btrim(f.cliente_rg), ''), s.cliente_rg),
    cliente_endereco = coalesce(nullif(btrim(f.cliente_endereco), ''), s.cliente_endereco),
    carro_descricao  = coalesce(nullif(btrim(f.carro_descricao), ''), s.carro_descricao),
    como_conheceu    = coalesce(f.como_conheceu, s.como_conheceu),
    negociador_id    = coalesce(f.negociador_id, s.negociador_id),
    negociador_nome  = coalesce(nullif(btrim(f.negociador_nome), ''), s.negociador_nome),
    origem           = case when s_lead and not f_lead then s.origem else coalesce(f.origem, s.origem) end,
    prospec          = case when s_lead and not f_lead and nullif(btrim(s.prospec), '') is not null then s.prospec
                            else coalesce(nullif(btrim(f.prospec), ''), s.prospec) end,
    chegada_em       = least(coalesce(f.chegada_em, s.chegada_em), coalesce(s.chegada_em, f.chegada_em)),
    observacoes      = nullif(concat_ws(E'\n', nullif(btrim(f.observacoes), ''),
                         nullif(btrim(s.observacoes), ''),
                         'Juntado com o atendimento aberto às ' ||
                           to_char(s.criado_em at time zone 'America/Sao_Paulo', 'HH24:MI') ||
                           coalesce(' por ' || nullif(btrim(s.negociador_nome), ''), '') ||
                           ' em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || '.'), '')
  where id = f.id;

  -- O que é UM por atendimento passa só se o que fica não tem.
  if not exists (select 1 from veiculo where atendimento_id = f.id) then
    update veiculo set atendimento_id = f.id where atendimento_id = s.id;
  else
    select count(*) into v_solto from veiculo where atendimento_id = s.id;
  end if;
  if not exists (select 1 from checklist where atendimento_id = f.id) then
    update checklist set atendimento_id = f.id where atendimento_id = s.id;
  end if;
  if not exists (select 1 from negociacao_viva where atendimento_id = f.id) then
    update negociacao_viva set atendimento_id = f.id where atendimento_id = s.id;
  end if;
  update checklist_doc d set atendimento_id = f.id
   where d.atendimento_id = s.id
     and not exists (select 1 from checklist_doc x where x.atendimento_id = f.id and x.item = d.item);
  update aprovacao_negocio a set atendimento_id = f.id
   where a.atendimento_id = s.id
     and not exists (select 1 from aprovacao_negocio x where x.atendimento_id = f.id and x.perfil_id = a.perfil_id);

  -- O que é lista passa inteiro.
  update proposta      set atendimento_id = f.id where atendimento_id = s.id;
  update anexo         set atendimento_id = f.id where atendimento_id = s.id;
  update mensagem      set atendimento_id = f.id where atendimento_id = s.id;
  update revisao       set atendimento_id = f.id where atendimento_id = s.id;
  update escuta_sessao set atendimento_id = f.id where atendimento_id = s.id;
  update indicacao     set atendimento_id = f.id where atendimento_id = s.id;
  update estoque       set atendimento_id = f.id where atendimento_id = s.id;
  update agenda        set atendimento_id = f.id where atendimento_id = s.id;
  update wa_conversa   set atendimento_id = f.id where atendimento_id = s.id;
  -- O lead por último: é ele que faz a visita contar para a pré-venda.
  update lead set atendimento_id = f.id, status = 'compareceu' where atendimento_id = s.id;

  delete from atendimento where id = s.id;
  return jsonb_build_object('ok', true, 'fica', f.id, 'veiculo_solto', v_solto);
end;
$$;

revoke all on function unificar_atendimentos(uuid, uuid) from public;
grant execute on function unificar_atendimentos(uuid, uuid) to authenticated;
