-- =====================================================================
-- 0105 — Marcar a conversa como lida ou não lida
--
-- O Derek, em 03/11/2026: "whatsapp — opção de marcar como LIDO / não
-- lido". A caixa só sabia "não respondida" (o cliente falou por último):
-- um "ok, obrigado" ficava na fila para sempre, e não havia como pôr de
-- volta uma conversa para alguém retomar depois.
--
-- `lida_em`: alguém deu a conversa por vista sem responder — ela sai de
-- "Não respondidas" até o cliente escrever de novo. `nao_lida`: alguém
-- a pôs de volta de propósito; vale até ser marcada como lida ou
-- respondida. É da conversa, não da pessoa: a caixa é da equipe.
-- =====================================================================

alter table wa_conversa
  add column if not exists lida_em  timestamptz,
  add column if not exists nao_lida boolean not null default false;

-- Responder (daqui, pelo celular ou pela Flávia) desfaz o "não lida":
-- a marca era para alguém retomar, e alguém retomou.
create or replace function wa_resposta_le() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.eco then
    update wa_conversa set nao_lida = false where id = new.conversa_id and nao_lida;
  end if;
  return new;
end;
$$;
drop trigger if exists wa_resposta_le on wa_mensagem;
create trigger wa_resposta_le after insert on wa_mensagem for each row execute function wa_resposta_le();
