-- 0158 · Investidores e centros de custo (16/11/2026, o Derek: "estamos pegando dinheiro a juros de alguns
-- investidores… com cada um combinamos uma taxa de juros mensal… tem que lançar no DRE e na contas a pagar o
-- valor dos juros no dia que ele faz aniversário. No caso do dinheiro do sócio, a mesma coisa… só que é mais
-- dinâmico, tem mais entra e sai… computa o dinheiro que tinha no final do mês").
--
-- O SALDO DE CADA UM NÃO É DIGITADO: é o saldo inicial + as linhas do financeiro com o investidor e a conta
-- "9.10 Capital de investidores e sócios" (fora do DRE). Aporte e resgate entram pela conciliação, na linha do
-- extrato — como o carro e a pessoa da folha.
--
-- OS JUROS, por investidor: "pago" vira título a pagar em 7.01 Juros no dia do aniversário; "capitaliza" vira
-- um PAR de linhas numa conta interna (débito em Juros, crédito no Capital): o DRE recebe a despesa, o saldo
-- dele cresce, e nenhuma conta de banco se mexe.
--   · investidor: no aniversário, sobre o MENOR saldo do mês que passou (dinheiro que ficou o mês inteiro);
--   · sócio: sobre o saldo do FIM do mês; o título vence no dia escolhido do mês seguinte.
-- A conta mora aqui (fin_investidores_mes) para a tela e a geração automática (cron) lerem a mesma regra.

-- ---------------------------------------------------------------- centros de custo (o financeiro inteiro)
create table if not exists fin_centro_custo (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  codigo text,
  ordem int not null default 0,
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now()
);
create unique index if not exists fin_centro_custo_nome on fin_centro_custo (lower(nome));
alter table fin_centro_custo enable row level security;
drop policy if exists fin_centro_custo_acesso on fin_centro_custo;
create policy fin_centro_custo_acesso on fin_centro_custo for all to authenticated using (e_financeiro()) with check (e_financeiro());

alter table fin_lancamento add column if not exists centro_custo_id uuid references fin_centro_custo(id) on delete set null;
create index if not exists fin_lancamento_centro on fin_lancamento (centro_custo_id) where centro_custo_id is not null;
alter table fin_conta_fixa add column if not exists centro_custo_id uuid references fin_centro_custo(id) on delete set null;

insert into fin_centro_custo (nome, codigo, ordem) values
  ('Operação da loja', '01', 10), ('Investidores e sócios', '02', 20)
on conflict do nothing;

-- ---------------------------------------------------------------- investidores
create table if not exists fin_investidor (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  tipo text not null default 'investidor' check (tipo in ('investidor', 'socio')),
  documento text,
  telefone text,
  pix text,
  favorecido_id uuid references fin_favorecido(id) on delete set null,
  taxa_mensal numeric(7,4) not null default 0 check (taxa_mensal >= 0 and taxa_mensal < 100),   -- % ao mês
  juros_modo text not null default 'pago' check (juros_modo in ('pago', 'capitaliza')),
  -- investidor: o dia do aniversário (vencimento dos juros); sócio: o dia do pagamento no mês seguinte
  dia_aniversario int check (dia_aniversario between 1 and 31),
  conta_id uuid references fin_conta(id) on delete set null,          -- de onde costuma sair o pagamento
  centro_custo_id uuid references fin_centro_custo(id) on delete set null,
  saldo_inicial numeric(14,2) not null default 0,                     -- o que ele já tinha, antes do sistema
  saldo_inicial_em date,                                              -- a partir de quando o extrato conta
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table fin_investidor enable row level security;
drop policy if exists fin_investidor_acesso on fin_investidor;
create policy fin_investidor_acesso on fin_investidor for all to authenticated using (e_financeiro()) with check (e_financeiro());

alter table fin_lancamento add column if not exists investidor_id uuid references fin_investidor(id) on delete set null;
create index if not exists fin_lancamento_investidor on fin_lancamento (investidor_id, data) where investidor_id is not null;

alter table fin_categoria add column if not exists pede_investidor boolean not null default false;

-- A conta do capital (fora do DRE) e a conta interna dos juros que capitalizam.
insert into fin_categoria (nome, grupo, no_dre, ordem, ativa, pede_funcionario, tipo_custo, codigo, pai_id, pede_investidor)
select 'Capital de investidores e sócios', 'despesa', false, 9100, true, false, 'fora', '9.10',
       (select id from fin_categoria where codigo = '9' and pai_id is null limit 1), true
 where not exists (select 1 from fin_categoria where codigo = '9.10');
update fin_categoria set pede_investidor = true where codigo = '9.10';

do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'fin_conta'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%cartao%' loop
    execute format('alter table fin_conta drop constraint %I', c.conname);
  end loop;
end $$;
alter table fin_conta add constraint fin_conta_tipo_check check (tipo in ('banco', 'dinheiro', 'cartao', 'interna'));
insert into fin_conta (nome, tipo, ativa, saldo_inicial, descricao)
select 'Juros capitalizados (investidores)', 'interna', false, 0,
       'Conta interna: cada juro que capitaliza entra aqui como débito em Juros e crédito no Capital — o saldo é sempre zero.'
 where not exists (select 1 from fin_conta where tipo = 'interna');

-- ---------------------------------------------------------------- a conta dos juros
create or replace function fin_inv_saldo(p_inv uuid, p_dia date, p_sem_cap_de date default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(i.saldo_inicial, 0) + coalesce((
    select sum(l.credito - l.debito) from fin_lancamento l join fin_categoria k on k.id = l.categoria_id and k.pede_investidor
     where l.investidor_id = i.id and l.situacao = 'efetivado' and l.data <= p_dia
       and (i.saldo_inicial_em is null or l.data >= i.saldo_inicial_em)
       and not (p_sem_cap_de is not null and l.origem = 'juros_capitalizado' and l.competencia >= p_sem_cap_de)), 0)
  from fin_investidor i where i.id = p_inv
$$;
revoke all on function fin_inv_saldo(uuid, date, date) from public, anon, authenticated;

create or replace function fin_inv_menor_saldo(p_inv uuid, p_de date, p_ate date, p_sem_cap_de date) returns numeric
language sql stable security definer set search_path = public as $$
  -- o menor saldo ao fim de cada dia de [p_de, p_ate): o do primeiro dia e o de cada dia com movimento
  select min(fin_inv_saldo(p_inv, d, p_sem_cap_de)) from (
    select p_de as d
    union select distinct l.data from fin_lancamento l join fin_categoria k on k.id = l.categoria_id and k.pede_investidor
     where l.investidor_id = p_inv and l.situacao = 'efetivado' and l.data > p_de and l.data < p_ate
  ) t
$$;
revoke all on function fin_inv_menor_saldo(uuid, date, date, date) from public, anon, authenticated;

create or replace function fin_inv_juros_de(i fin_investidor, p_comp date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  ini date := date_trunc('month', p_comp)::date;
  fim date := (date_trunc('month', p_comp) + interval '1 month - 1 day')::date;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  d int; ref date; prev date; venc date; base numeric; devido boolean; pfim date;
  jcat uuid := (select id from fin_categoria where codigo = '7.01' limit 1);
  ger jsonb;
begin
  if i.tipo = 'socio' then
    ref := fim;
    base := fin_inv_saldo(i.id, fim, ini);
    d := coalesce(i.dia_aniversario, 5);
    pfim := (fim + interval '1 month')::date;
    venc := make_date(extract(year from pfim)::int, extract(month from pfim)::int, least(d, extract(day from pfim)::int));
    devido := hoje > fim;
  else
    d := coalesce(i.dia_aniversario, extract(day from i.saldo_inicial_em)::int, 1);
    ref := make_date(extract(year from ini)::int, extract(month from ini)::int, least(d, extract(day from fim)::int));
    pfim := (ini - 1);
    prev := make_date(extract(year from pfim)::int, extract(month from pfim)::int, least(d, extract(day from pfim)::int));
    base := greatest(0, fin_inv_menor_saldo(i.id, prev, ref, ini));
    -- antes do saldo inicial não houve dinheiro: o mês só conta se ele já estava lá no começo do período
    -- quem começou depois do aniversário anterior não ficou o mês inteiro: o primeiro juro é no seguinte
    if i.saldo_inicial_em is not null and i.saldo_inicial_em > prev then base := 0; end if;
    venc := ref;
    devido := hoje >= ref;
  end if;
  select jsonb_build_object('id', l.id, 'valor', l.debito, 'situacao', l.situacao, 'origem', l.origem, 'vencimento', l.vencimento)
    into ger from fin_lancamento l
   where l.investidor_id = i.id and l.competencia = ini and l.categoria_id = jcat and l.situacao <> 'cancelado' and l.debito > 0
   order by l.criado_em limit 1;
  if ger is null then
    -- título ligado a uma linha do banco: o título fica cancelado e a linha herda o investidor
    select jsonb_build_object('id', l.id, 'valor', l.debito, 'situacao', 'efetivado', 'origem', l.origem)
      into ger from fin_lancamento l
     where l.investidor_id = i.id and l.competencia = ini and l.categoria_id = jcat and l.situacao = 'cancelado' and l.extrato_id is not null
     limit 1;
  end if;
  return jsonb_build_object('investidor_id', i.id, 'competencia', ini, 'referencia', ref, 'vencimento', venc,
    'base', round(coalesce(base, 0), 2), 'taxa', i.taxa_mensal, 'juros', round(coalesce(base, 0) * i.taxa_mensal / 100, 2),
    'devido', devido, 'gerado', ger);
end $$;
revoke all on function fin_inv_juros_de(fin_investidor, date) from public, anon, authenticated;

create or replace function fin_investidores_mes(p_comp date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not e_financeiro() then raise exception 'apenas o financeiro' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'investidor', to_jsonb(i), 'saldo_hoje', round(fin_inv_saldo(i.id, hoje), 2),
      'juros', fin_inv_juros_de(i, p_comp)) order by i.tipo desc, i.nome)
    from fin_investidor i), '[]'::jsonb);
end $$;
revoke all on function fin_investidores_mes(date) from public, anon;
grant execute on function fin_investidores_mes(date) to authenticated;

-- Gera os juros devidos de um mês. Do financeiro (o botão) ou do cron (IA_SEGREDO).
create or replace function fin_juros_gerar(p_comp date, p_segredo text default null) returns int
language plpgsql security definer set search_path = public as $$
declare
  i fin_investidor; j jsonb; n int := 0; g uuid; v numeric;
  ini date := date_trunc('month', p_comp)::date;
  jcat uuid := (select id from fin_categoria where codigo = '7.01' limit 1);
  ccat uuid := (select id from fin_categoria where codigo = '9.10' limit 1);
  cint uuid := (select id from fin_conta where tipo = 'interna' order by criado_em limit 1);
  rot text := to_char(ini, 'MM/YYYY');
begin
  if not (e_financeiro() or ia_chave_ok(p_segredo)) then raise exception 'apenas o financeiro' using errcode = '42501'; end if;
  if jcat is null or ccat is null or cint is null then raise exception 'Falta a conta Juros (7.01), o Capital (9.10) ou a conta interna.'; end if;
  for i in select * from fin_investidor where ativo and taxa_mensal > 0 loop
    j := fin_inv_juros_de(i, ini);
    v := (j->>'juros')::numeric;
    continue when (not (j->>'devido')::boolean) or (coalesce(j->'gerado', 'null'::jsonb) <> 'null'::jsonb) or v <= 0;
    if i.juros_modo = 'capitaliza' then
      g := gen_random_uuid();
      insert into fin_lancamento (conta_id, data, competencia, categoria_id, descricao, favorecido, debito, credito, situacao,
                                  origem, investidor_id, centro_custo_id, grupo_id, conciliado, observacao)
      values (cint, (j->>'referencia')::date, ini, jcat, format('Juros de %s — %s (capitalizado)', i.nome, rot), i.nome, v, 0, 'efetivado',
              'juros_capitalizado', i.id, i.centro_custo_id, g, true, format('%s%% sobre %s', i.taxa_mensal, j->>'base')),
             (cint, (j->>'referencia')::date, ini, ccat, format('Juros de %s — %s somados ao saldo', i.nome, rot), i.nome, 0, v, 'efetivado',
              'juros_capitalizado', i.id, i.centro_custo_id, g, true, null);
    else
      insert into fin_lancamento (conta_id, data, competencia, categoria_id, descricao, favorecido, favorecido_id, debito, credito,
                                  situacao, vencimento, origem, investidor_id, centro_custo_id, observacao)
      values (i.conta_id, (j->>'vencimento')::date, ini, jcat, format('Juros de %s — %s', i.nome, rot), i.nome, i.favorecido_id, v, 0,
              'aberto', (j->>'vencimento')::date, 'juros_investidor', i.id, i.centro_custo_id,
              format('%s%% sobre %s', i.taxa_mensal, j->>'base'));
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function fin_juros_gerar(date, text) from public;
grant execute on function fin_juros_gerar(date, text) to anon, authenticated;

-- A linha com investidor e sem centro herda o centro dele (aporte conciliado, juros, título).
create or replace function fin_lanc_centro_do_investidor() returns trigger language plpgsql as $$
begin
  if new.investidor_id is not null and new.centro_custo_id is null then
    select centro_custo_id into new.centro_custo_id from fin_investidor where id = new.investidor_id;
  end if;
  return new;
end $$;
drop trigger if exists fin_lancamento_centro_investidor on fin_lancamento;
create trigger fin_lancamento_centro_investidor before insert or update of investidor_id on fin_lancamento
  for each row execute function fin_lanc_centro_do_investidor();

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0158_investidores.sql') on conflict do nothing;
