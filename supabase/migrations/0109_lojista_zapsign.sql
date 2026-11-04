-- =====================================================================
-- 0109 — O contrato do lojista vai ao ZapSign
--
-- O Derek, em 04/11/2026: "a assinatura do contrato do lojista seria bom
-- se fosse pelo ZapSign". É o mesmo caminho do contrato do cliente
-- (decisão 21, 0102): o PDF com a âncora da assinatura, o token do
-- documento guardado para o webhook saber de quem é, e o link para
-- mandar de novo. O contrato do lojista é do CARRO VENDIDO, então tudo
-- mora no `estoque`, não no atendimento.
-- =====================================================================

alter table estoque add column if not exists lojista_zapsign_token   text;
alter table estoque add column if not exists lojista_zapsign_link    text;
alter table estoque add column if not exists lojista_zapsign_formato text;
alter table estoque add column if not exists lojista_enviado_em      timestamptz;
alter table estoque add column if not exists lojista_assinado_em     timestamptz;

/* O webhook chega sem login, como o do cliente (0015): esta função só
 * sabe marcar a data, e só para token que já foi gravado no envio. */
create or replace function marcar_contrato_lojista_assinado(tok text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if coalesce(length(tok), 0) < 10 then return false; end if;
  update estoque set lojista_assinado_em = coalesce(lojista_assinado_em, now())
   where lojista_zapsign_token = tok;
  return found;
end;
$$;
revoke all on function marcar_contrato_lojista_assinado(text) from public;
grant execute on function marcar_contrato_lojista_assinado(text) to anon, authenticated;
