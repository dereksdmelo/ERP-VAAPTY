-- =====================================================================
-- 0114 — Os lembretes de transferência só para as vendas novas
--
-- 05/11/2026, o Derek: "só quero que mande automaticamente logo que o
-- lojista compra pra ele saber do procedimento e ter o contato salvo… aí
-- depois vai recebendo os lembretes. O passado é passado, só quero que os
-- novos sigam o protocolo." Ligar os lembretes mandaria "venceu" a
-- lojistas de carros vendidos antes de existir o protocolo, sem nunca
-- terem recebido a primeira mensagem. Agora só recebe lembrete o carro
-- cujas boas-vindas saíram (aviso_lojista boas_vindas enviado).
-- =====================================================================

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
    into v_ultima, v_dia from aviso_lojista where tipo in ('d2m', 'd1m', 'd2s', 'd1s', 'venceu');
  if v_dia >= 30 then return null; end if;
  if v_ultima is not null and v_ultima > now() - interval '90 seconds' then return null; end if;

  select jsonb_build_object('estoque_id', x.id, 'tipo', x.tipo, 'canal', v_canal,
           'placa', x.placa, 'carro', x.carro, 'nome', x.nome, 'telefone', x.telefone,
           'vendido_em', x.vendido_em, 'prazo', x.prazo)
    into v
    from (
      select e.id, ve.placa, coalesce(ve.marca_modelo, '') as carro, c.nome, c.telefone, e.vendido_em,
             (e.vendido_em + interval '3 months')::date as prazo,
             case
               when v_hoje >= (e.vendido_em + interval '3 months')::date then 'venceu'
               when v_hoje >= (e.vendido_em + interval '3 months')::date - 7 then 'd1s'
               when v_hoje >= (e.vendido_em + interval '3 months')::date - 14 then 'd2s'
               when v_hoje >= (e.vendido_em + interval '2 months')::date then 'd1m'
               when v_hoje >= (e.vendido_em + interval '1 month')::date then 'd2m'
             end as tipo
        from estoque e
        join comprador c on c.id = e.comprador_id
        left join veiculo ve on ve.id = e.veiculo_id
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
         and length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 10
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
