-- =====================================================================
-- 0115 — O prazo de transferência de cada venda
--
-- 05/11/2026, o Derek: "dependendo da negociação, pode ser obrigatória a
-- transferência… ao fazer o contrato do lojista devemos poder selecionar
-- qual o prazo pra transferir, sendo o padrão de 90 dias, mas podendo não
-- ter prazo também, com transferência imediata… e nesses casos já manda a
-- mensagem pedindo os dados pra transferir direto."
--
-- `prazo_transferencia_dias`: vazio é o padrão (3 meses, como sempre);
-- um número é a venda + N dias; 0 é IMEDIATA. Os lembretes passam a contar
-- a partir do prazo de cada carro, e a imediata ganha dois avisos próprios.
-- =====================================================================

alter table estoque add column if not exists prazo_transferencia_dias int
  check (prazo_transferencia_dias is null or (prazo_transferencia_dias >= 0 and prazo_transferencia_dias <= 365));

-- O contato do ADM do lojista (05/11/2026, o Derek: "alguns lojistas
-- indicam um número do ADM pra mandar as questões de documentação"). O
-- telefone de sempre continua o principal — é com quem se negocia —; os
-- avisos de documentação vão para o do ADM quando ele existe.
alter table comprador
  add column if not exists adm_nome     text,
  add column if not exists adm_telefone text;

alter table aviso_lojista drop constraint if exists aviso_lojista_tipo_check;
alter table aviso_lojista add constraint aviso_lojista_tipo_check
  check (tipo in ('boas_vindas', 'crlv', 'd2m', 'd1m', 'd2s', 'd1s', 'venceu', 'imediata', 'imediata_cobra'));

create or replace function lojista_aviso_proximo(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_canal text;
  v_ultima timestamptz;
  v_dia int;
  v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not coalesce((select lojista_lembretes from config_loja where id = 1), false) then return null; end if;
  if extract(isodow from v_agora) = 7 or v_agora::time < '09:00' or v_agora::time >= '18:00' then return null; end if;
  select slug into v_canal from wa_canal
   where not comercial and ativo and telefone is not null
   order by (slug ~* 'adm' or nome ~* 'adm') desc, slug limit 1;
  if v_canal is null then return null; end if;
  select max(criado_em), count(*) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = v_hoje)
    into v_ultima, v_dia from aviso_lojista where tipo in ('d2m', 'd1m', 'd2s', 'd1s', 'venceu', 'imediata_cobra');
  if v_dia >= 30 then return null; end if;
  if v_ultima is not null and v_ultima > now() - interval '90 seconds' then return null; end if;

  select jsonb_build_object('estoque_id', x.id, 'tipo', x.tipo, 'canal', v_canal,
           'placa', x.placa, 'carro', x.carro, 'nome', x.nome, 'telefone', x.telefone,
           'vendido_em', x.vendido_em, 'prazo', x.prazo, 'dias', x.dias)
    into v
    from (
      select e.id, ve.placa, coalesce(ve.marca_modelo, '') as carro,
             case when length(regexp_replace(coalesce(c.adm_telefone, ''), '\D', '', 'g')) >= 10 and nullif(btrim(c.adm_nome), '') is not null
                  then c.adm_nome else c.nome end as nome,
             case when length(regexp_replace(coalesce(c.adm_telefone, ''), '\D', '', 'g')) >= 10
                  then c.adm_telefone else c.telefone end as telefone,
             e.vendido_em,
             e.prazo_transferencia_dias as dias, p.prazo,
             case
               -- 0115: a transferência imediata cobra em 2 dias e "venceu" em 7.
               when e.prazo_transferencia_dias = 0 then
                 case when v_hoje >= e.vendido_em + 7 then 'venceu'
                      when v_hoje >= e.vendido_em + 2 then 'imediata_cobra' end
               when v_hoje >= p.prazo then 'venceu'
               when v_hoje >= p.prazo - 7 then 'd1s'
               when v_hoje >= p.prazo - 14 then 'd2s'
               -- "falta 1 mês" e "faltam 2 meses" só cabem em prazo que tem
               -- esse tamanho: num de 30 dias, sairiam no dia da venda.
               when v_hoje >= p.prazo - 30 and p.prazo - e.vendido_em >= 45 then 'd1m'
               when v_hoje >= p.prazo - 60 and p.prazo - e.vendido_em >= 75 then 'd2m'
             end as tipo
        from estoque e
        join comprador c on c.id = e.comprador_id
        left join veiculo ve on ve.id = e.veiculo_id
        cross join lateral (select case when e.prazo_transferencia_dias is null
                                        then (e.vendido_em + interval '3 months')::date
                                        else e.vendido_em + e.prazo_transferencia_dias end as prazo) p
       where e.situacao = 'vendido' and coalesce(e.natureza::text, '') <> 'indicacao'
         and e.transferido_em is null and e.vendido_em is not null
         -- 0113: quem já pediu o DUT depois desta venda está andando — a
         -- demora, se houver, é nossa (cartório) e não dele; e com o
         -- comunicado de venda feito a loja já saiu da responsabilidade.
         and e.comunicado_em is null
         -- 0114: só segue o protocolo quem ENTROU nele — o lojista que
         -- recebeu as boas-vindas na venda. O passado é passado (o Derek).
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
$$;
revoke all on function lojista_aviso_proximo(text) from public;
grant execute on function lojista_aviso_proximo(text) to anon, authenticated;
