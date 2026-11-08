-- =====================================================================
-- 0121 — A tela da sala: gestão à vista (08/11/2026)
--
-- O Derek: "a ideia é fazer uma tela dinâmica, pra pendurar na sala onde
-- o gestor está e a equipe faz reuniões, pra fazer gestão à vista em
-- tempo real… efeitos visuais quando alguém fecha um carro, comemoração,
-- pódio, vitória, de forma configurável. As configurações devem ficar no
-- painel do gestor e o link pra tela deve ser gerado por lá."
--
-- A TV não tem login: ela abre `tv.html#t=<chave>`. A chave mora em
-- `painel_tv` (uma linha só), que só o gerente lê e escreve; gerar outra
-- desliga a anterior. A página pública chama `tv_painel(chave)` com a
-- chave anônima — função `security definer` estreita que devolve SÓ o
-- agregado do mês (meta, feito, carros, fluxo, conversão por negociador,
-- e os carros que entraram: negociador e modelo). Nenhum dado de cliente
-- sai daqui. Mesmo remédio da assinatura (0048) e do DUT (0057).
--
-- Fica em texto (não em hash) porque o gerente precisa ver e copiar o
-- link de novo depois de pendurar a TV; o que ele abre é número de
-- vendas, não cadastro.
-- =====================================================================

create table if not exists painel_tv (
  id int primary key default 1 check (id = 1),
  token text not null,
  config jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table painel_tv enable row level security;
drop policy if exists painel_tv_gerente on painel_tv;
create policy painel_tv_gerente on painel_tv for all to authenticated using (e_gerente()) with check (e_gerente());

create or replace function sem_acento_maiusc(t text) returns text
language sql immutable as $$
  select upper(regexp_replace(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'), '\s+', ' ', 'g'))
$$;

create or replace function tv_painel(p_token text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  cfg painel_tv;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  fim date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) + interval '1 month - 1 day')::date;
  v jsonb;
begin
  select * into cfg from painel_tv where id = 1;
  if cfg.token is null or p_token is null or length(p_token) < 20 or cfg.token <> p_token then
    raise exception 'link da tela inválido' using errcode = '42501';
  end if;

  with neg as (
    select nome, sem_acento_maiusc(nome) as k, coalesce(meta_valor, 0) as meta
      from negociador where ativo and papel = 'negociador'),
  vend as (
    select sem_acento_maiusc(e.negociador_nome) as k, count(*) as carros,
           sum(coalesce(e.valor_venda, 0) - coalesce(e.valor_compra, 0)
               - coalesce((select sum(coalesce(c.realizado, c.previsto, 0)) from estoque_custo c where c.estoque_id = e.id), 0)) as rent
      from estoque e
     where e.situacao = 'vendido'
       and ((e.vendido_em between ini and fim) or (e.vendido_em is null and e.entrou_em between ini and fim))
     group by 1),
  ats as (
    select sem_acento_maiusc(a.negociador_nome) as k, count(*) as fluxo,
           count(*) filter (where a.status = 'fechado') as fechados,
           count(*) filter (where a.data = hoje) as fluxo_hoje,
           count(*) filter (where a.data = hoje and a.status = 'fechado') as fechados_hoje
      from atendimento a where a.data between ini and fim group by 1),
  entrou as (
    select e.id, e.criado_em, coalesce(nullif(e.negociador_nome, ''), '—') as negociador,
           coalesce(ve.marca_modelo, '') as carro
      from estoque e left join veiculo ve on ve.id = e.veiculo_id
     where e.criado_em >= (ini::timestamp at time zone 'America/Sao_Paulo')
       and coalesce(e.natureza, 'compra') = 'compra' and e.situacao <> 'baixado'
     order by e.criado_em desc limit 30)
  select jsonb_build_object(
    'agora', now(), 'hoje', hoje, 'inicio', ini, 'fim', fim,
    'config', cfg.config,
    'meta_loja', (select valor from meta_loja where competencia = ini),
    'pessoas', (select coalesce(jsonb_agg(jsonb_build_object(
        'nome', n.nome, 'meta', n.meta, 'feito', coalesce(v.rent, 0), 'carros', coalesce(v.carros, 0),
        'fluxo', coalesce(a.fluxo, 0), 'fechados', coalesce(a.fechados, 0),
        'fluxo_hoje', coalesce(a.fluxo_hoje, 0), 'fechados_hoje', coalesce(a.fechados_hoje, 0))
        order by coalesce(v.rent, 0) desc), '[]'::jsonb)
      from neg n left join vend v on v.k = n.k left join ats a on a.k = n.k),
    'loja', jsonb_build_object(
      'feito', (select coalesce(sum(rent), 0) from vend),
      'carros', (select coalesce(sum(carros), 0) from vend),
      'fluxo', (select coalesce(sum(fluxo), 0) from ats),
      'fechados', (select coalesce(sum(fechados), 0) from ats),
      'fluxo_hoje', (select coalesce(sum(fluxo_hoje), 0) from ats),
      'fechados_hoje', (select coalesce(sum(fechados_hoje), 0) from ats)),
    'entradas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'quando', criado_em, 'negociador', negociador, 'carro', carro)), '[]'::jsonb) from entrou)
  ) into v;
  return v;
end;
$$;
revoke all on function tv_painel(text) from public;
grant execute on function tv_painel(text) to anon, authenticated;
