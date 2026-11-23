-- 0176 · O lembrete ao lojista leva a loja no link do DUT (23/11/2026, decisão 79).
--
-- O formulário público do DUT não tem login: é o `?f=<loja>` do link que diz de qual franquia é o pedido (0173). O
-- lembrete de prazo sai do cron (`ia/lojistas.js`), que monta o link com o que `lojista_aviso_proximo` devolve — e
-- agora ela devolve também `loja`, o slug da franquia do carro.

set lock_timeout = '3s';
set statement_timeout = '60s';

do $$
declare def text;
begin
  def := pg_get_functiondef('public.lojista_aviso_proximo(text)'::regprocedure);
  if position('''canal'', x.canal,' in def) = 0 or position('select e.id, k.canal,' in def) = 0 then
    raise exception 'lojista_aviso_proximo mudou; confira antes';
  end if;
  def := replace(def, '''canal'', x.canal,', '''canal'', x.canal, ''loja'', (select f.slug from franquia f where f.id = x.fr),');
  def := replace(def, 'select e.id, k.canal,', 'select e.id, e.franquia_id as fr, k.canal,');
  execute def;
end $$;

insert into schema_migrations(arquivo) values ('0176_lojista_aviso_loja.sql') on conflict do nothing;
