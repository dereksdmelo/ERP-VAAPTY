-- =====================================================================
-- 0072 — Quais números a ponte precisa manter acordados
--
-- O container de cada número dorme depois de 15 minutos sem pergunta
-- (`sleepAfter` na ponte), e dormindo ele não escuta o WhatsApp. O
-- comentário de lá dizia que "o cron do ERP pergunta o estado a cada
-- minuto" — esse cron nunca existiu. A ponte parou em 15/10/2026 de
-- madrugada e só voltou em 21/10 às 21h, quando alguém abriu a tela
-- dos números: seis dias de conversa da Ana, da Camila e da TV sem
-- chegar, e o funil da pré-venda parado junto.
--
-- O cron agora existe, no Worker do ERP, e precisa saber QUAIS números
-- acordar. Ele roda sem usuário, então não tem token para a RLS; em vez
-- da chave de serviço (decisão 9), esta função estreita devolve só os
-- apelidos — que já viajam na URL da ponte e não identificam ninguém.
--
-- Só número ativo e que JÁ LIGOU (tem telefone gravado). Número que
-- nunca leu o QR não tem sessão: acordá-lo a cada cinco minutos
-- gastaria uma instância para mostrar um QR que ninguém está olhando.
-- =====================================================================

create or replace function wa_canais_para_acordar()
returns setof text
language sql
security definer
set search_path = public
stable
as $$
  select slug from wa_canal where ativo and telefone is not null order by slug;
$$;

revoke all on function wa_canais_para_acordar() from public;
grant execute on function wa_canais_para_acordar() to anon, authenticated;
