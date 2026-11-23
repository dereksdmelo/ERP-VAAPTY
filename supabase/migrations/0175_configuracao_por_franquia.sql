-- 0175 · Configuração da loja, tela da sala e cadastro da empresa: uma linha por franquia (23/11/2026, decisão 79).
--
-- As três nasceram como "uma linha só" (`id = 1`, travado por check): `config_loja` (0068, horários, nome da IA,
-- aviso de chegada, lembretes ao lojista, transbordo), `painel_tv` (0121, a tela da sala) e `empresa` (0137, o
-- cadastro que os papéis leem). Com a segunda franquia, as duas lojas dividiriam os mesmos horários e o mesmo CNPJ.
--
-- Agora a chave de cada uma é a franquia: o check do `id = 1` sai, o `id` ganha sequência (Joinville continua 1) e
-- `franquia_id` vira único. O servidor deixou de pedir `id=eq.1`: lê a linha que a RLS mostra (a da franquia do
-- login, 0169) e grava com `on_conflict=franquia_id`. As funções que rodam sem login leem a da franquia do registro:
--   · `ia_contexto` e `wa_lead_avanca` — a da conversa;
--   · `tv_painel` e `tv_agenda` — a do link (o token, que já era único por tela);
--   · `lojista_aviso_proximo` — a do carro: o interruptor e o número do adm de cada franquia.
-- Franquia nova ganha a `config_loja` com os valores de fábrica no mesmo instante (gatilho em `franquia`).

set lock_timeout = '3s';
set statement_timeout = '60s';

do $$
declare t text; c record;
begin
  foreach t in array array['config_loja', 'painel_tv', 'empresa'] loop
    for c in select conname from pg_constraint
              where conrelid = ('public.' || t)::regclass and contype = 'c'
                and pg_get_constraintdef(oid) ~ 'id = 1' loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format('create sequence if not exists public.%I owned by public.%I.id', t || '_id_seq', t);
    execute format('select setval(''public.%I'', greatest((select coalesce(max(id), 0) from public.%I), 1))', t || '_id_seq', t);
    execute format('alter table public.%I alter column id set default nextval(''public.%I'')', t, t || '_id_seq');
    execute format('create unique index if not exists %I on public.%I (franquia_id)', t || '_franquia_unica', t);
  end loop;
end $$;

-- As que só mudam a linha que leem.
do $$
declare r record; def text; troca text[][] := array[
  ['ia_contexto', 'from config_loja c where c.id = 1)',
   'from config_loja c where c.franquia_id = (select x.franquia_id from wa_conversa x where x.id = p_conversa))'],
  ['wa_lead_avanca', 'from config_loja where id = 1;', 'from config_loja where franquia_id = c.franquia_id;'],
  ['tv_painel', 'from painel_tv where id = 1;', 'from painel_tv where token = p_token limit 1;'],
  ['tv_agenda', 'from painel_tv where id = 1;', 'from painel_tv where token = p_token limit 1;']];
  i int; achou int;
begin
  for i in 1 .. array_length(troca, 1) loop
    achou := 0;
    for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = troca[i][1] loop
      def := pg_get_functiondef(r.oid);
      if position(troca[i][2] in def) > 0 then
        execute replace(def, troca[i][2], troca[i][3]);
        achou := achou + 1;
      end if;
    end loop;
    if achou = 0 then raise exception 'nao achei o trecho em %', troca[i][1]; end if;
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.lojista_aviso_proximo(p_segredo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_agora timestamp := now() at time zone 'America/Sao_Paulo';
 v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
 v_ultima timestamptz;
 v_dia int;
 v jsonb;
begin
 if not ia_chave_ok(p_segredo) then raise exception '%', U&'sem permiss\00E3o' using errcode = '42501'; end if;
 if extract(isodow from v_agora) = 7 or v_agora::time < '09:00' or v_agora::time >= '18:00' then return null; end if;
 select max(criado_em), count(*) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = v_hoje)
 into v_ultima, v_dia from aviso_lojista where tipo in ('d2m', 'd1m', 'd2s', 'd1s', 'venceu', 'imediata_cobra');
 if v_dia >= 30 then return null; end if;
 if v_ultima is not null and v_ultima > now() - interval '90 seconds' then return null; end if;

 select jsonb_build_object('estoque_id', x.id, 'tipo', x.tipo, 'canal', x.canal,
 'placa', x.placa, 'carro', x.carro, 'nome', x.nome, 'telefone', x.telefone,
 'vendido_em', x.vendido_em, 'prazo', x.prazo, 'dias', x.dias)
 into v
 from (
 select e.id, k.canal, ve.placa, coalesce(ve.marca_modelo, '') as carro,
 case when length(regexp_replace(coalesce(c.adm_telefone, ''), '\D', '', 'g')) >= 10 and nullif(btrim(c.adm_nome), '') is not null
 then c.adm_nome else c.nome end as nome,
 case when length(regexp_replace(coalesce(c.adm_telefone, ''), '\D', '', 'g')) >= 10
 then c.adm_telefone else c.telefone end as telefone,
 e.vendido_em,
 e.prazo_transferencia_dias as dias, p.prazo,
 case
 when e.prazo_transferencia_dias = 0 then
 case when v_hoje >= e.vendido_em + 7 then 'venceu'
 when v_hoje >= e.vendido_em + 2 then 'imediata_cobra' end
 when v_hoje >= p.prazo then 'venceu'
 when v_hoje >= p.prazo - 7 then 'd1s'
 when v_hoje >= p.prazo - 14 then 'd2s'
 when v_hoje >= p.prazo - 30 and p.prazo - e.vendido_em >= 45 then 'd1m'
 when v_hoje >= p.prazo - 60 and p.prazo - e.vendido_em >= 75 then 'd2m'
 end as tipo
 from estoque e
 join config_loja cfg on cfg.franquia_id = e.franquia_id and cfg.lojista_lembretes
 cross join lateral (select w.slug as canal from wa_canal w
 where w.franquia_id = e.franquia_id and not w.comercial and w.ativo and w.telefone is not null
 order by (w.slug ~* 'adm' or w.nome ~* 'adm') desc, w.slug limit 1) k
 join comprador c on c.id = e.comprador_id
 left join veiculo ve on ve.id = e.veiculo_id
 cross join lateral (select case when e.prazo_transferencia_dias is null
 then (e.vendido_em + interval '3 months')::date
 else e.vendido_em + e.prazo_transferencia_dias end as prazo) p
 where e.situacao = 'vendido' and coalesce(e.natureza::text, '') <> 'indicacao'
 and e.transferido_em is null and e.vendido_em is not null
 and e.comunicado_em is null
 and exists (select 1 from aviso_lojista b where b.estoque_id = e.id and b.tipo = 'boas_vindas' and b.estado = 'enviado')
 and not exists (select 1 from dut_pedido d
 where d.placa = ve.placa and d.situacao <> 'cancelado'
 and d.criado_em >= (e.vendido_em::timestamp - interval '7 days'))
 and (length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 10
 or length(regexp_replace(coalesce(c.adm_telefone, ''), '\D', '', 'g')) >= 10)
 ) x
 where x.tipo is not null
 and not exists (select 1 from aviso_lojista a where a.estoque_id = x.id and a.tipo = x.tipo)
 order by x.vendido_em
 limit 1;
 return v;
end;
$function$
;

create or replace function franquia_nasce_config()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into config_loja (franquia_id) values (new.id) on conflict (franquia_id) do nothing;
  return new;
end $$;
drop trigger if exists franquia_nasce_config on franquia;
create trigger franquia_nasce_config after insert on franquia for each row execute function franquia_nasce_config();

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0175_configuracao_por_franquia.sql') on conflict do nothing;
