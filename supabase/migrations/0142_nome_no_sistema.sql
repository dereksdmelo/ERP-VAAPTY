-- 0142 · Um nome só por pessoa (09/11/2026, o Derek: "tudo deve seguir apenas um nome: o nome do cadastro
-- na pessoa da equipe"). O André Ricardo era "ANDRE RICARDO" na meta, "ANDRÉ RICARDO" num atendimento,
-- "André Santos" no login e na folha — e a fila não o via atendendo.
--
-- O NOME NO SISTEMA é curto e editável na ficha do colaborador (o nome completo continua para documento e
-- folha). Trocá-lo troca o login, a meta e o HISTÓRICO que está em texto (atendimento, estoque, documento,
-- lead, indicação, mensagem do WhatsApp). Só se reescreve o nome velho que é DESTA pessoa: um "MARCOS" que
-- também é de outra pessoa da equipe fica como está — reescrever daria o atendimento de um ao outro.

alter table colaborador add column if not exists nome_sistema text;

-- O nome de hoje no cartão da Equipe: o da meta, senão o do login.
update colaborador c set nome_sistema = coalesce(
    nullif(trim((select n.nome from negociador n where n.id = c.negociador_id)), ''),
    nullif(trim((select p.nome from perfil p where p.id = c.perfil_id)), ''), c.nome_completo)
 where c.nome_sistema is null;

create or replace function nome_chave(t text) returns text language sql immutable as $$
  select regexp_replace(trim(translate(upper(coalesce(t, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')), '\s+', ' ', 'g')
$$;

create or replace function renomear_pessoa(p_colaborador uuid, p_nome text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c colaborador%rowtype;
  novo text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  velhas text[]; outras text[]; minhas text[];
  n_at int := 0; n_es int := 0; n_doc int := 0; n_lead int := 0; n_ind int := 0; n_msg int := 0; x int;
begin
  if not (e_gerente() or e_financeiro()) then raise exception 'só o gerente ou o financeiro renomeia' using errcode = '42501'; end if;
  if length(novo) < 2 then raise exception 'Escreva o nome.'; end if;
  select * into c from colaborador where id = p_colaborador;
  if c.id is null then raise exception 'Ficha não encontrada.'; end if;

  -- Os nomes de TODAS as outras pessoas da equipe (login, meta e ficha).
  select coalesce(array_agg(distinct k), '{}') into outras from (
    select nome_chave(p.nome) k from perfil p where p.id is distinct from c.perfil_id
    union select nome_chave(n.nome) from negociador n where n.id is distinct from c.negociador_id
    union select nome_chave(o.nome_sistema) from colaborador o where o.id <> c.id and o.nome_sistema is not null
  ) t where k <> '';
  if nome_chave(novo) = any(outras) then raise exception 'Já existe outra pessoa com o nome "%". Escolha um nome que só ela tenha.', novo; end if;

  select coalesce(array_agg(distinct k), '{}') into velhas from (
    select nome_chave(c.nome_sistema) k
    union select nome_chave(p.nome) from perfil p where p.id = c.perfil_id
    union select nome_chave(n.nome) from negociador n where n.id = c.negociador_id
  ) t where k <> '';
  -- Só o que é desta pessoa e de mais ninguém.
  select coalesce(array_agg(k), '{}') into minhas from unnest(velhas) k where not (k = any(outras));

  update colaborador set nome_sistema = novo where id = c.id;
  if c.perfil_id is not null then update perfil set nome = novo where id = c.perfil_id; end if;
  if c.negociador_id is not null then update negociador set nome = novo where id = c.negociador_id; end if;

  update atendimento set negociador_nome = novo
   where negociador_nome is distinct from novo
     and ((c.perfil_id is not null and negociador_id = c.perfil_id) or nome_chave(negociador_nome) = any(minhas));
  get diagnostics n_at = row_count;
  update estoque set negociador_nome = novo where negociador_nome is distinct from novo and nome_chave(negociador_nome) = any(minhas);
  get diagnostics n_es = row_count;
  update documento set negociador = novo where negociador is distinct from novo and nome_chave(negociador) = any(minhas);
  get diagnostics n_doc = row_count;
  update lead set negociador_nome = novo where negociador_nome is distinct from novo and nome_chave(negociador_nome) = any(minhas);
  get diagnostics n_lead = row_count;
  update lead set agendado_por_nome = novo where agendado_por_nome is distinct from novo and nome_chave(agendado_por_nome) = any(minhas);
  get diagnostics x = row_count; n_lead := n_lead + x;
  update indicacao set negociador_nome = novo where negociador_nome is distinct from novo and nome_chave(negociador_nome) = any(minhas);
  get diagnostics n_ind = row_count;
  update wa_mensagem set enviado_por_nome = novo
   where enviado_por_nome is distinct from novo
     and ((c.perfil_id is not null and enviado_por = c.perfil_id) or nome_chave(enviado_por_nome) = any(minhas));
  get diagnostics n_msg = row_count;

  return jsonb_build_object('nome', novo, 'atendimentos', n_at, 'carros', n_es, 'documentos', n_doc,
    'leads', n_lead, 'indicacoes', n_ind, 'mensagens', n_msg,
    'ambiguos', (select coalesce(array_agg(k), '{}') from unnest(velhas) k where k = any(outras)));
end $$;
revoke all on function renomear_pessoa(uuid, text) from public, anon;
grant execute on function renomear_pessoa(uuid, text) to authenticated;

insert into schema_migrations(arquivo) values ('0142_nome_no_sistema.sql') on conflict do nothing;
