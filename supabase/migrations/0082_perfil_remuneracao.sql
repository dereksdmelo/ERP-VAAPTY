-- =====================================================================
-- 0082 — Perfis de remuneração: o combinado que serve a mais de um
--
-- O Derek, em 27/10/2026: *"no painel de gestão, abaixo de Equipe,
-- permitir cadastrar PERFIL DE REMUNERAÇÃO, para que eu possa cadastrar
-- um perfil que pode ser usado pra mais de um tipo de negociador"*.
--
-- O perfil é a mesma lista de peças da ficha (0081, `regras/
-- remuneracao.js`). A ficha aponta para ele (`remuneracao.perfil_id`,
-- dentro do jsonb) e ainda pode ter peças só dela — o ajuste de uma
-- pessoa não obriga a criar um perfil novo. Mudar o perfil muda o
-- combinado de todo mundo que o usa, e é para isso que ele existe.
--
-- Mesma porta da ficha: só financeiro e gerente (`e_financeiro()`).
-- =====================================================================

create table if not exists perfil_remuneracao (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  descricao    text,
  remuneracao  jsonb not null default '{}'::jsonb,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);
alter table perfil_remuneracao enable row level security;
drop policy if exists perfil_remuneracao_financeiro on perfil_remuneracao;
create policy perfil_remuneracao_financeiro on perfil_remuneracao
  for all using (e_financeiro()) with check (e_financeiro());
