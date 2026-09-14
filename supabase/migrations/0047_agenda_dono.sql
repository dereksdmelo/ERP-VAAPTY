-- =====================================================================
-- 0047 — Quem é o dono da linha da agenda é o BANCO que diz
--
-- A 0046 subiu com o servidor descobrindo o próprio perfil assim:
--
--   select id from perfil limit 1
--
-- Isso está errado, e o primeiro teste no ar pegou. Para um
-- negociador a RLS devolve só a própria linha e funciona por acidente;
-- **para o gerente ela devolve a equipe inteira**, e o `limit 1` traz
-- o primeiro da lista — que é outra pessoa. O insert então tentava
-- gravar a agenda no nome de um colega, e a política recusava com 403.
--
-- O 403 foi sorte: a RLS segurou. Sem ela, o gerente estaria
-- escrevendo no dia dos outros sem saber.
--
-- A resposta certa não é o servidor adivinhar, é o banco dizer.
-- `auth.uid()` vem do JWT que o PostgREST já validou — a mesma fonte
-- que a política usa para conferir. Com o default, o cliente não
-- escolhe o dono, e não há o que tentar burlar.
-- =====================================================================

alter table agenda alter column perfil_id set default auth.uid();

comment on column agenda.perfil_id is
  'O dono do dia. Preenchido pelo banco com auth.uid(): o cliente nao escolhe, e a RLS confere o mesmo valor.';
