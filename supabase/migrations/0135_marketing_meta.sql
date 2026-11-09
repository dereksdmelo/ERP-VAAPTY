-- 0135 · Marketing: a conexão com a conta de anúncios da Meta (08/11/2026, o Derek: "mais uma aba
-- principal para marketing… imitar a do Camisetas Já, mas mais completo, criativo por criativo").
--
-- O TOKEN NUNCA VOLTA AO NAVEGADOR. A tabela não tem política de leitura: o gerente grava por
-- `mkt_conectar()` e o servidor lê por `mkt_token()`, que só responde a gerente ou financeiro
-- (o mesmo token do usuário que abriu a tela). A tela só fica sabendo se está conectado e a qual conta.
create table if not exists mkt_conexao (
  plataforma text primary key check (plataforma in ('meta')),
  conta text not null,
  token text not null,
  nome text,
  conectado_por uuid default auth.uid(),
  conectado_em timestamptz not null default now()
);
alter table mkt_conexao enable row level security;
revoke all on mkt_conexao from anon, authenticated;

create or replace function mkt_conectar(p_plataforma text, p_conta text, p_token text, p_nome text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not e_gerente() then raise exception 'só o gerente conecta a conta de anúncios' using errcode = '42501'; end if;
  if p_token is null or p_token = '' then
    delete from mkt_conexao where plataforma = p_plataforma;
    return;
  end if;
  insert into mkt_conexao (plataforma, conta, token, nome) values (p_plataforma, p_conta, p_token, p_nome)
  on conflict (plataforma) do update set conta = excluded.conta, token = excluded.token, nome = excluded.nome,
    conectado_por = auth.uid(), conectado_em = now();
end $$;

create or replace function mkt_token(p_plataforma text)
returns table (conta text, token text) language plpgsql security definer set search_path = public as $$
begin
  if not (e_gerente() or e_financeiro()) then raise exception 'sem acesso' using errcode = '42501'; end if;
  return query select m.conta, m.token from mkt_conexao m where m.plataforma = p_plataforma;
end $$;

create or replace function mkt_estado()
returns table (plataforma text, conta text, nome text, conectado_em timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not (e_gerente() or e_financeiro()) then raise exception 'sem acesso' using errcode = '42501'; end if;
  return query select m.plataforma, m.conta, m.nome, m.conectado_em from mkt_conexao m;
end $$;

revoke all on function mkt_conectar(text, text, text, text) from public, anon;
revoke all on function mkt_token(text) from public, anon;
revoke all on function mkt_estado() from public, anon;
grant execute on function mkt_conectar(text, text, text, text) to authenticated;
grant execute on function mkt_token(text) to authenticated;
grant execute on function mkt_estado() to authenticated;
