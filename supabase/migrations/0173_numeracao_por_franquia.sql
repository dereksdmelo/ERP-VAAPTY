-- 0173 · Cada franquia tem a própria numeração (23/11/2026, decisão 79).
--
-- Recibo, pedido de DUT e nota fiscal eram numerados contando o ano inteiro, sem olhar a franquia: a segunda franquia
-- começaria no número seguinte ao de Joinville, e o índice único recusaria o mesmo número nas duas. Agora:
--   · recibo: `proximo_recibo` conta só a franquia de quem emite, e o único passa a ser (franquia, ano, número);
--   · DUT: o formulário público diz de qual franquia é (`?f=<slug>` no dut.html; sem ele, Joinville, para os links que
--     já circulam), o protocolo conta dentro dela e a consulta procura dentro dela;
--   · nota fiscal: o número da DPS sai do contador do cadastro da empresa DA franquia (cada CNPJ tem a sua série),
--     e o único inclui a franquia. Franquia sem cadastro da empresa recebe o recado em vez de um número.
-- O que já existe não muda: tudo hoje é Joinville.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- Recibo
drop index if exists fin_recibo_numero;
create unique index fin_recibo_numero on fin_recibo (franquia_id, ano, numero);

create or replace function public.proximo_recibo(p_ano integer)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
 n int;
begin
 if not e_financeiro() then return null; end if;
 select coalesce(max(numero), 0) + 1 into n from fin_recibo where ano = p_ano and franquia_id = minha_franquia();
 return n;
end;
$function$;

-- DUT
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'dut_pedido'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) ilike 'UNIQUE (ano, protocolo)';
  if c is not null then execute format('alter table dut_pedido drop constraint %I', c); end if;
end $$;
create unique index if not exists dut_pedido_protocolo on dut_pedido (franquia_id, ano, protocolo);

create or replace function franquia_do_slug(p_slug text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select case when coalesce(trim(p_slug), '') = '' then '00000000-0000-0000-0000-000000000001'::uuid
              else (select id from franquia where slug = lower(trim(p_slug)) and ativa) end;
$$;
revoke all on function franquia_do_slug(text) from public, anon, authenticated;

drop function if exists dut_criar(text,text,text,text,text,text,text,text,numeric,int,date,text,text,text,text);
create or replace function public.dut_criar(p_token_hash text, p_tipo text, p_placa text, p_veiculo text, p_nome text, p_doc text, p_rg text, p_endereco text, p_valor numeric, p_km integer, p_data date, p_entrega text, p_envio text, p_lojista text, p_whats text, p_franquia text default null)
 returns table(id uuid, protocolo text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
 v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'));
 v_fr uuid := franquia_do_slug(p_franquia);
 v_num int;
 v_prot text;
 v_id uuid;
 v_tentativas int := 0;
begin
 if v_fr is null then
 raise exception '%', U&'loja n\00E3o encontrada' using errcode = 'P0001';
 end if;
 if coalesce(p_placa, '') = '' then
 raise exception 'informe a placa' using errcode = 'P0001';
 end if;

 loop
 v_tentativas := v_tentativas + 1;
 select coalesce(max(substring(d.protocolo from '\d+$')::int), 0) + 1
 into v_num from dut_pedido d where d.ano = v_ano and d.franquia_id = v_fr;
 v_prot := 'DUT-' || v_ano || '-' || lpad(v_num::text, 4, '0');
 begin
 insert into dut_pedido (franquia_id, protocolo, ano, tipo, placa, veiculo,
 comprador_nome, comprador_doc, comprador_rg, comprador_endereco,
 valor_venda, km, data_venda, entrega, endereco_envio,
 lojista_nome, lojista_whats, token_hash, token_ate)
 values (v_fr, v_prot, v_ano,
 coalesce(nullif(p_tipo, '')::dut_tipo, 'preencher'),
 upper(regexp_replace(p_placa, '[^A-Za-z0-9]', '', 'g')), nullif(p_veiculo, ''),
 nullif(p_nome, ''), nullif(p_doc, ''), nullif(p_rg, ''), nullif(p_endereco, ''),
 p_valor, p_km, p_data,
 coalesce(nullif(p_entrega, '')::dut_entrega, 'retirada'), nullif(p_envio, ''),
 nullif(p_lojista, ''), nullif(p_whats, ''),
 nullif(p_token_hash, ''), now() + interval '2 hours')
 returning dut_pedido.id into v_id;
 exit;
 exception when unique_violation then
 if v_tentativas >= 5 then raise; end if;
 end;
 end loop;

 return query select v_id, v_prot;
end;
$function$;
revoke all on function dut_criar(text,text,text,text,text,text,text,text,numeric,int,date,text,text,text,text,text) from public;
grant execute on function dut_criar(text,text,text,text,text,text,text,text,numeric,int,date,text,text,text,text,text) to anon, authenticated;

drop function if exists dut_estado(text);
create or replace function public.dut_estado(p_protocolo text, p_franquia text default null)
 returns table(protocolo text, placa text, tipo text, situacao text, pendencia text, criado_em timestamp with time zone, preenchido_em timestamp with time zone, cartorio_em timestamp with time zone, reconhecido_em timestamp with time zone, entregue_em timestamp with time zone, entrega text, rastreio text)
 language sql
 security definer
 set search_path to 'public'
as $function$
 select p.protocolo, p.placa, p.tipo::text, p.situacao::text,
 p.pendencia, p.criado_em, p.preenchido_em, p.cartorio_em, p.reconhecido_em,
 p.entregue_em, p.entrega::text, p.rastreio
 from dut_pedido p
 where upper(p.protocolo) = upper(trim(p_protocolo))
 and p.franquia_id = franquia_do_slug(p_franquia)
 limit 1;
$function$;
revoke all on function dut_estado(text, text) from public;
grant execute on function dut_estado(text, text) to anon, authenticated;

-- Nota fiscal
drop index if exists nfse_numero_unico;
create unique index nfse_numero_unico on nfse (franquia_id, ambiente, serie, numero_dps) where numero_dps is not null;

create or replace function public.nfse_reservar_numero(p_nfse uuid)
 returns table(serie text, numero bigint)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare s text; n bigint; amb text; fr uuid := minha_franquia();
begin
 if not (e_financeiro() or e_gerente()) then raise exception 'sem acesso' using errcode = '42501'; end if;
 select x.numero_dps, x.serie, x.ambiente into n, s, amb from nfse x where x.id = p_nfse and x.franquia_id = fr;
 if amb is null then raise exception '%', U&'nota n\00E3o encontrada'; end if;
 if n is not null then return query select s, n; return; end if;
 if amb = 'producao' then
 update empresa set nfse_proximo_producao = nfse_proximo_producao + 1 where franquia_id = fr
 returning nfse_serie_producao, nfse_proximo_producao - 1 into s, n;
 else
 update empresa set nfse_proximo_restrita = nfse_proximo_restrita + 1 where franquia_id = fr
 returning nfse_serie_restrita, nfse_proximo_restrita - 1 into s, n;
 end if;
 if n is null then raise exception '%', U&'preencha o cadastro da empresa antes de emitir'; end if;
 update nfse set serie = s, numero_dps = n where id = p_nfse;
 return query select s, n;
end $function$;

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0173_numeracao_por_franquia.sql') on conflict do nothing;
