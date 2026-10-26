-- =====================================================================
-- 0080 — Quem pode atender: os negociadores com login ativo
--
-- O Derek, em 26/10/2026, no "Cliente de fluxo": *"não tá aparecendo
-- todos os negociadores"*. A lista do "quem vai atender" saía do
-- cadastro de METAS (`negociador`, 0010) filtrado por `ativo` — e
-- `ativo` ali quer dizer "conta na meta da loja", não "trabalha aqui".
-- O André Santos tem login ativo e a meta dele está desligada: sumia.
--
-- A pré-venda, que é quem marca a chegada, não lê `perfil` (a RLS da
-- 0004 é do dono e do gerente). Esta função entrega só o id e o nome de
-- quem tem login ativo como negociador — e só a quem é da equipe.
-- =====================================================================

create or replace function negociadores_com_login()
returns table (id uuid, nome text)
language sql security definer stable set search_path = public as $$
  select p.id, p.nome from perfil p
   where e_equipe() and p.ativo and p.papel = 'negociador'
   order by p.nome;
$$;
revoke all on function negociadores_com_login() from public;
grant execute on function negociadores_com_login() to authenticated;
