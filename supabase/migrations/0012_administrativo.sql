-- 0012 — quem é o administrativo
--
-- A conferência do administrativo estava dentro do check list do
-- negociador: as duas mãos preenchiam a mesma tela. O Derek pediu que
-- ela saísse para uma tela própria, "só na tela do adm mesmo".
--
-- Para isso o sistema precisa saber quem é o adm, e hoje não sabe: o
-- enum `papel_usuario` tem pre_venda, negociador, gerente e prep.
--
-- É coluna booleana e não valor novo no enum de propósito. Duas razões:
--   1. `alter type ... add value` não pode ser usado na mesma transação
--      em que é criado, então viraria duas migrações encadeadas.
--   2. administrativo não substitui o papel — o gerente também confere,
--      e uma pessoa da pré-venda pode acumular a função. Papel é o que
--      a pessoa faz no atendimento; isto é uma permissão a mais.

alter table perfil add column if not exists administrativo boolean not null default false;

comment on column perfil.administrativo is
  'Pode conferir o check list na tela do administrativo. Independe do papel.';

-- Mesma forma das outras: security definer com search_path fixo, senão
-- a função enxerga tabela de outro schema conforme quem chama.
create or replace function e_adm()
returns boolean as $$
  select coalesce(
    (select administrativo or papel = 'gerente' from perfil where id = auth.uid() and ativo),
    false
  );
$$ language sql stable security definer set search_path = public;

-- O gerente já confere hoje, e é quem está usando o sistema. Sem isto a
-- tela nasceria vazia para todo mundo e pareceria quebrada.
update perfil set administrativo = true where papel = 'gerente';
