-- 0143 · A pesquisa nas mensagens do WhatsApp, rápida (09/11/2026). A primeira versão era um `ilike` pelo
-- PostgREST: a RLS roda por linha e varria a tabela inteira — 5 s numa palavra comum, e numa rara passava do
-- limite do banco e a caixa mostrava "Falha interna". Agora um índice de trigramas sobre o que se procura
-- (texto, nome do arquivo, leitura da IA) e uma função que confere a equipe UMA vez — a mesma régua da RLS da
-- 0054 (`e_equipe()` lê todas as conversas), sem pagar a política em cada linha.
create extension if not exists pg_trgm;

create or replace function wa_busca_texto(texto text, anexo jsonb, leitura text) returns text
language sql immutable as $$
  select lower(coalesce(texto, '') || ' ' || coalesce(anexo->>'nome', '') || ' ' || coalesce(leitura, ''))
$$;
create index if not exists wa_mensagem_busca on wa_mensagem using gin (wa_busca_texto(texto, anexo, leitura) gin_trgm_ops);

create or replace function wa_procurar(p_q text, p_uso text default null, p_comercial boolean default null,
  p_canal text default null, p_arquivos boolean default false, p_limite int default 60)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare q text := lower(trim(coalesce(p_q, '')));
begin
  if not e_equipe() then raise exception 'sem acesso' using errcode = '42501'; end if;
  if length(q) < 3 then return; end if;
  return query
    select jsonb_build_object('id', m.id, 'conversa_id', m.conversa_id, 'eco', m.eco, 'tipo', m.tipo, 'texto', m.texto,
      'anexo', m.anexo, 'autor', m.autor, 'quando', m.quando,
      'conversa', jsonb_build_object('id', c.id, 'nome', c.nome, 'telefone', c.telefone, 'grupo', c.grupo, 'ultima_em', c.ultima_em,
        'primeira_em', c.primeira_em, 'ultima_de_fora', c.ultima_de_fora, 'respondida_em', c.respondida_em, 'lida_em', c.lida_em,
        'nao_lida', c.nao_lida, 'anuncio', c.anuncio, 'atendimento_id', c.atendimento_id, 'lead_id', c.lead_id,
        'canal', jsonb_build_object('slug', k.slug, 'nome', k.nome, 'atendente', k.atendente, 'comercial', k.comercial, 'uso', k.uso)))
    from wa_mensagem m
    join wa_conversa c on c.id = m.conversa_id
    join wa_canal k on k.id = c.canal_id
    where wa_busca_texto(m.texto, m.anexo, m.leitura) like '%' || replace(replace(q, '%', ''), '_', '\_') || '%'
      and (p_uso is null or k.uso = p_uso)
      and (p_comercial is null or k.comercial = p_comercial)
      and (p_canal is null or k.slug = p_canal)
      and (not p_arquivos or m.tipo = 'midia')
    order by m.quando desc
    limit least(greatest(coalesce(p_limite, 60), 1), 200);
end $$;
revoke all on function wa_procurar(text, text, boolean, text, boolean, int) from public, anon;
grant execute on function wa_procurar(text, text, boolean, text, boolean, int) to authenticated;

insert into schema_migrations(arquivo) values ('0143_wa_procurar.sql') on conflict do nothing;
