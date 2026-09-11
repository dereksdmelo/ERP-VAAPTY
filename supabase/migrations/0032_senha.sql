-- =====================================================================
-- 0032 — Senha provisória, e a troca obrigatória na entrada
--
-- Dois funcionários ficaram de fora hoje porque o e-mail de confirmação
-- do Supabase não chegou. A confirmação foi desligada, mas o mesmo
-- buraco vale para "esqueci minha senha": o SMTP compartilhado do plano
-- gratuito entrega mal, e um botão que depende dele não é garantia.
--
-- Então são dois caminhos. O de sempre é o "esqueci minha senha", que
-- manda e-mail. O que nunca falha é o gerente gerar uma senha
-- aleatória e passar por WhatsApp — e o sistema **obrigar a troca na
-- primeira entrada**, senão a senha que circulou no WhatsApp fica
-- valendo para sempre.
--
-- O Supabase não tem "precisa trocar a senha". Esta coluna é isso.
-- =====================================================================

alter table perfil
  add column if not exists senha_provisoria boolean not null default false;

comment on column perfil.senha_provisoria is
  'O gerente gerou uma senha aleatória e ela ainda não foi trocada. Enquanto for true, a tela não deixa passar.';

-- ---------------------------------------------------------------------
-- Limpar a marca é do próprio dono, e só ela.
--
-- Não dá para resolver com política de RLS: a escrita em `perfil` é do
-- gerente (0004), e abrir `update` para o dono da linha abriria
-- `papel` e `ativo` junto — RLS não separa coluna. Uma função estreita
-- resolve, como a `marcar_contrato_assinado()` da 0015 resolveu o
-- webhook do ZapSign.
-- ---------------------------------------------------------------------
create or replace function limpar_senha_provisoria()
returns void as $$
  update perfil set senha_provisoria = false where id = auth.uid();
$$ language sql security definer set search_path = public, pg_temp;

revoke all on function limpar_senha_provisoria() from public;
grant execute on function limpar_senha_provisoria() to authenticated;
