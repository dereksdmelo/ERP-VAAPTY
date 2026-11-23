-- 0175 · RH: o formulário completo e as perguntas de cada vaga (23/11/2026, decisão 80).
--
-- O Derek, depois de ver o "Trabalhe conosco" no ar: "precisa ter o formulário para os candidatos preencherem
-- certinho, pra poder divulgar nas vagas de RH". O formulário passou a perguntar o que a loja precisa saber para
-- decidir quem chamar — escolaridade, CNH, carro próprio, experiência em vendas e com veículos, se trabalha hoje,
-- quando pode começar, sábado — e cada vaga pode ter perguntas próprias (`rh_vaga.perguntas`).
--
-- As respostas ficam em `rh_candidato.respostas`, como lista de {p, r} (a pergunta como a pessoa leu e a resposta):
-- a pergunta pode mudar depois, e o que vale é o que ela respondeu ao que estava escrito.

set lock_timeout = '3s';
set statement_timeout = '60s';

alter table rh_vaga      add column if not exists perguntas jsonb not null default '[]';
alter table rh_candidato add column if not exists respostas jsonb;

drop function if exists rh_vagas_publicas(text);
create or replace function rh_vagas_publicas(p_franquia text default null)
returns table (id uuid, titulo text, setor text, descricao text, requisitos text, oferecemos text, modalidade text,
               perguntas jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id, v.titulo, v.setor, v.descricao, v.requisitos, v.oferecemos, v.modalidade, v.perguntas
    from rh_vaga v
   where v.aberta and v.publica and v.franquia_id = franquia_do_slug(p_franquia)
   order by v.criado_em desc;
$$;
revoke all on function rh_vagas_publicas(text) from public;
grant execute on function rh_vagas_publicas(text) to anon, authenticated;

-- A candidatura guarda as respostas (o servidor já as limpou: lista de {p, r}, textos curtos).
create or replace function rh_candidatar_respostas(p_token_hash text, p_respostas jsonb)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_respostas) <> 'array' or jsonb_array_length(p_respostas) > 80 then return false; end if;
  update rh_candidato set respostas = p_respostas, atualizado_em = now()
   where token_hash = p_token_hash and p_token_hash is not null and token_ate > now();
  return found;
end;
$$;
revoke all on function rh_candidatar_respostas(text, jsonb) from public;
grant execute on function rh_candidatar_respostas(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0175_rh_formulario.sql') on conflict do nothing;
