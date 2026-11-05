-- =====================================================================
-- 0112 — Quem da equipe mandou a mensagem
--
-- 05/11/2026, o Derek: "era bom que o WhatsApp identificasse pra nós
-- qual o usuário que mandou a mensagem" — e, no "Meu dia", mostrar
-- "mandou mensagem para o cliente X". A mensagem que sai pela caixa de
-- Conversas do ERP (texto ou arquivo) passa a guardar o login de quem
-- escreveu. A que sai direto do celular ou do WhatsApp Web não passa
-- pelo ERP: dela só se sabe que saiu do número.
-- =====================================================================

alter table wa_mensagem
  add column if not exists enviado_por      uuid references perfil(id) on delete set null,
  add column if not exists enviado_por_nome text;
create index if not exists wa_mensagem_enviado_por on wa_mensagem (enviado_por, quando) where enviado_por is not null;
