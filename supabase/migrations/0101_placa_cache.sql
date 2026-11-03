-- =====================================================================
-- 0101 — A consulta de placa é guardada no mês
--
-- 03/11/2026, meio-dia: "Limite diário de consultas atingido… 20
-- consultas" na tela da Schell. A decisão 4 queria a consulta guardada
-- por mês — o valor FIPE muda uma vez por mês —, e o que guardava era o
-- `s-maxage` da Vercel. Desde que o ERP roda no Cloudflare, em
-- `workers.dev`, nada era guardado (o cache do Cloudflare não funciona
-- nesse domínio): a mesma placa, no celular e no computador, ou
-- consultada de novo depois de recarregar, gastava cota de novo.
--
-- **Uma linha por placa e mês.** Mês novo consulta de novo, porque a
-- FIPE mudou. A tabela não tem política: só as duas funções abaixo, que
-- exigem o segredo do servidor (`ia_chave_ok`, 0075), leem e gravam —
-- a resposta traz o chassi, e a rota de placa não tem login (decisão 9).
-- =====================================================================

create table if not exists placa_cache (
  placa     text not null,
  mes       text not null,
  dados     jsonb not null,
  criado_em timestamptz not null default now(),
  primary key (placa, mes)
);
alter table placa_cache enable row level security;

create or replace function placa_cache_ler(p_segredo text, p_placa text, p_mes text)
returns jsonb language sql security definer set search_path = public stable as $$
  select dados from placa_cache
   where ia_chave_ok(p_segredo) and placa = upper(p_placa) and mes = p_mes;
$$;

create or replace function placa_cache_gravar(p_segredo text, p_placa text, p_mes text, p_dados jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then return false; end if;
  insert into placa_cache (placa, mes, dados) values (upper(p_placa), p_mes, p_dados)
  on conflict (placa, mes) do update set dados = excluded.dados, criado_em = now();
  return true;
end;
$$;

revoke all on function placa_cache_ler(text, text, text) from public;
revoke all on function placa_cache_gravar(text, text, text, jsonb) from public;
grant execute on function placa_cache_ler(text, text, text) to anon, authenticated;
grant execute on function placa_cache_gravar(text, text, text, jsonb) to anon, authenticated;
