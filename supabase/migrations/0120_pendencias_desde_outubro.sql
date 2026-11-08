-- =====================================================================
-- 0120 — As pendências começam em outubro/2026 (08/11/2026)
--
-- O Derek, olhando as Pendências: "tudo que é antigo (setembro pra trás)
-- pode eliminar. Vamos deixar outubro redondo e depois novembro tem que
-- estar perfeito". 3.460 lançamentos sem categoria, 184 de carro sem
-- carro, 45 de folha sem pessoa — quase tudo histórico importado que
-- ninguém vai corrigir, e que esconde o que importa.
--
-- Nada é apagado: as conferências só passam a olhar de 01/10/2026 em
-- diante (`inicio`). O histórico continua no extrato, no DRE e nas
-- telas; só não é cobrado aqui. Mover o corte é mudar uma data.
-- =====================================================================

create or replace function fin_pendencias()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  -- 0120: o que é de antes daqui não é cobrado (o histórico fica).
  inicio date := date '2026-10-01';
  r jsonb;
begin
  -- auth.uid() nulo e o editor do painel (dono do banco); com token de
  -- usuario, so passa quem e do financeiro.
  if auth.uid() is not null and not e_financeiro() then
    raise exception 'sem acesso ao financeiro' using errcode = '42501';
  end if;

  with
  venc as (
    select l.* from fin_lancamento l
     where l.situacao = 'aberto' and l.vencimento < hoje and l.vencimento >= inicio),
  conf as (
    select l.* from fin_lancamento l where l.revisar and coalesce(l.data, l.vencimento) >= inicio),
  semcat as (
    select l.* from fin_lancamento l
     where l.situacao = 'efetivado' and l.categoria_id is null and l.data >= inicio
       and not exists (select 1 from fin_rateio r where r.lancamento_id = l.id)),
  negoc as (
    select l.* from fin_lancamento l
      join fin_categoria c on c.id = l.categoria_id
     where l.situacao = 'efetivado' and c.grupo = 'negociacao' and l.data >= inicio
       and (l.estoque_id is null or l.tipo_negociacao is null)
       and not exists (select 1 from fin_rateio r where r.lancamento_id = l.id)),
  sempes as (
    select l.* from fin_lancamento l
      join fin_categoria c on c.id = l.categoria_id
     where l.situacao = 'efetivado' and c.pede_funcionario and l.funcionario_id is null and l.data >= inicio
       and not exists (select 1 from fin_rateio r
                        where r.lancamento_id = l.id and r.funcionario_id is not null)),
  parado as (
    select c.id, c.nome, max(l.data) as ultima
      from fin_conta c
      left join fin_lancamento l on l.conta_id = c.id and l.situacao = 'efetivado'
     where c.ativa
     group by c.id, c.nome
    having coalesce(max(l.data), date '1900-01-01') < hoje - 7),
  semfechar as (
    select c.id as conta_id, c.nome, m.mes::date as mes
      from fin_conta c
     cross join lateral generate_series(
            date_trunc('month', hoje) - interval '6 months',
            date_trunc('month', hoje) - interval '1 month',
            interval '1 month') as m(mes)
     where c.ativa and m.mes >= inicio
       and exists (select 1 from fin_lancamento l
                    where l.conta_id = c.id and l.situacao = 'efetivado'
                      and l.data >= m.mes and l.data < m.mes + interval '1 month')
       and not exists (select 1 from fin_fechamento f
                        where f.conta_id = c.id and f.competencia = m.mes::date
                          and f.fechado_em is not null)),
  folha as (
    select f.competencia, f.liquido, p.nome
      from fin_folha f join fin_funcionario p on p.id = f.funcionario_id
     where f.competencia < date_trunc('month', hoje)::date and f.competencia >= inicio
       and f.pago_em is null and f.liquido > 0)
  select jsonb_build_object(
    'hoje', hoje,
    'vencidos', jsonb_build_object(
      'a_pagar_qtd',   (select count(*) from venc where debito > 0),
      'a_pagar_valor', (select coalesce(sum(debito), 0) from venc where debito > 0),
      'a_receber_qtd',   (select count(*) from venc where credito > 0),
      'a_receber_valor', (select coalesce(sum(credito), 0) from venc where credito > 0),
      'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
          select id, descricao, favorecido, vencimento, debito, credito, hoje - vencimento as dias
            from venc order by vencimento limit 6) x)),
    'conferir', jsonb_build_object(
      'qtd', (select count(*) from conf),
      'valor', (select coalesce(sum(debito + credito), 0) from conf),
      'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
          select id, data, descricao, debito, credito from conf order by data desc limit 6) x)),
    'sem_categoria', jsonb_build_object(
      'qtd', (select count(*) from semcat),
      'qtd_90d', (select count(*) from semcat where data >= hoje - 90),
      'valor', (select coalesce(sum(debito + credito), 0) from semcat),
      'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
          select id, data, descricao, debito, credito from semcat order by data desc limit 6) x)),
    'negociacao', jsonb_build_object(
      'qtd', (select count(*) from negoc),
      'valor', (select coalesce(sum(debito + credito), 0) from negoc),
      'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
          select id, data, descricao, debito, credito,
                 (estoque_id is null) as sem_carro, (tipo_negociacao is null) as sem_parte
            from negoc order by data desc limit 6) x)),
    'sem_pessoa', jsonb_build_object(
      'qtd', (select count(*) from sempes),
      'valor', (select coalesce(sum(debito + credito), 0) from sempes),
      'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
          select id, data, descricao, debito, credito from sempes order by data desc limit 6) x)),
    'extrato_parado', jsonb_build_object(
      'qtd', (select count(*) from parado),
      'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
          select id, nome, ultima, hoje - ultima as dias from parado order by ultima nulls first) x)),
    'meses_sem_fechar', jsonb_build_object(
      'qtd', (select count(*) from semfechar),
      'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
          select conta_id, nome, mes from semfechar order by mes desc, nome limit 8) x)),
    'folha', jsonb_build_object(
      'qtd', (select count(*) from folha),
      'valor', (select coalesce(sum(liquido), 0) from folha),
      'itens', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
          select nome, competencia, liquido from folha order by competencia desc, nome limit 6) x))
  ) into r;

  return r;
end;
$$;

revoke all on function fin_pendencias() from public, anon;
grant execute on function fin_pendencias() to authenticated;
