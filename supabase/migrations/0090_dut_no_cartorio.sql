-- =====================================================================
-- 0090 — O DUT ganha o passo "no cartório"
--
-- O Derek, em 28/10/2026, olhando o quadro do DUT com a coluna "No
-- cartório" vazia: "será que ela mandou pro cartório e o sistema não
-- reconheceu? … na verdade tem uma etapa a mais: recebido, preenchido,
-- no cartório, pronto pra entrega (voltou do cartório), entregue".
--
-- A 0057 tinha quatro carimbos — pedido, preenchido, reconhecido,
-- entregue — e tratava "preenchido" como se o papel já estivesse no
-- cartório. O pedido "só reconhecer" nem isso: ia de recebido direto a
-- "voltou do cartório", e enquanto o papel estava lá ele aparecia como
-- recebido, parado. Agora levar ao cartório é um passo com data e nome.
-- Os pedidos antigos ficam sem essa data: não se reconstrói depois.
-- =====================================================================

alter type dut_situacao add value if not exists 'no_cartorio' after 'preenchido';

alter table dut_pedido
  add column if not exists cartorio_em  timestamptz,
  add column if not exists cartorio_por uuid references perfil(id);

-- A consulta pública pelo protocolo passa a dizer quando o papel foi ao
-- cartório. Mudar o retorno pede recriar a função.
drop function if exists dut_estado(text);
create function dut_estado(p_protocolo text)
returns table (protocolo text, placa text, tipo text, situacao text,
               pendencia text, criado_em timestamptz,
               preenchido_em timestamptz, cartorio_em timestamptz, reconhecido_em timestamptz,
               entregue_em timestamptz, entrega text, rastreio text)
language sql
security definer
set search_path = public
as $$
  select p.protocolo, p.placa, p.tipo::text, p.situacao::text,
         p.pendencia, p.criado_em, p.preenchido_em, p.cartorio_em, p.reconhecido_em,
         p.entregue_em, p.entrega::text, p.rastreio
    from dut_pedido p
   where upper(p.protocolo) = upper(trim(p_protocolo))
   limit 1;
$$;
revoke all on function dut_estado(text) from public;
grant execute on function dut_estado(text) to anon, authenticated;
