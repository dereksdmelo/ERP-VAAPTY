-- =====================================================================
-- 0086 — Quando a IA cai, a mensagem espera, e a retomada para
--
-- 28/10/2026, 13h27: o Derek mostrou a Scheila respondendo "Eu cancelei"
-- à retomada das 13h08 e ninguém respondendo. A fila estava certa; a API
-- da Anthropic é que recusava tudo desde 12h51 ("credit balance is too
-- low"). Duas coisas pioravam a queda:
--
-- 1. A mensagem que caía num erro DA IA (crédito, chave, limite, fora do
--    ar) ficava em ia_resposta como 'falhou', e o unique (mensagem_id)
--    nunca mais a deixava entrar na fila: voltando o crédito, a Scheila
--    continuaria sem resposta. Agora o cron LIBERA a reserva nesses
--    erros (ia_liberar) e a mensagem volta na volta seguinte — a janela
--    de 12 horas da fila continua sendo o limite.
-- 2. A retomada (0084) não depende da IA para mandar a abertura, então
--    seguia escrevendo para quem não veio, e cada resposta caía no
--    vazio. Agora toda falha da IA fica em ia_falha, e a retomada não
--    procura ninguém enquanto houver falha nos últimos 15 minutos.
-- =====================================================================

create table if not exists ia_falha (
  id        bigint generated always as identity primary key,
  quando    timestamptz not null default now(),
  erro      text
);
create index if not exists ia_falha_quando on ia_falha (quando desc);
alter table ia_falha enable row level security;
drop policy if exists ia_falha_le on ia_falha;
create policy ia_falha_le on ia_falha for select to authenticated using (e_equipe());

create or replace function ia_liberar(p_segredo text, p_id uuid, p_erro text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into ia_falha (erro) values (left(p_erro, 500));
  -- Só a reserva que ainda não mandou nada: o que saiu para o cliente
  -- nunca é desfeito.
  delete from ia_resposta where id = p_id and estado is distinct from 'enviada';
end;
$$;
revoke all on function ia_liberar(text, uuid, text) from public;
grant execute on function ia_liberar(text, uuid, text) to anon, authenticated;

-- As que já caíram pelo crédito hoje voltam para a fila.
delete from ia_resposta
 where estado = 'falhou' and criado_em >= now() - interval '12 hours'
   and erro ~ '^IA (400|401|403|429|5\d\d):';

-- A retomada da 0084, com a trava da IA fora do ar.
create or replace function ia_retomada_proximo(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_canal text;
  v_ultima timestamptz;
  v_hoje int;
  v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  select slug into v_canal from wa_canal where ia_retoma and ativo and telefone is not null order by slug limit 1;
  if v_canal is null then return null; end if;
  -- Segunda a sábado, 9h às 18h, em Joinville.
  if extract(isodow from v_agora) = 7 or v_agora::time < '09:00' or v_agora::time >= '18:00' then return null; end if;
  select max(criado_em), count(*) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = v_agora::date)
    into v_ultima, v_hoje from ia_retomada;
  if v_hoje >= 20 then return null; end if;
  -- IA fora do ar (0086): abrir conversa que ninguém vai responder é pior
  -- que não abrir.
  if exists (select 1 from ia_falha where quando > now() - interval '15 minutes') then return null; end if;
  -- 4 minutos e um pedaço que muda a cada volta: intervalo de gente.
  if v_ultima is not null and v_ultima > now() - make_interval(secs => 240 + (extract(minute from now())::int % 4) * 45) then return null; end if;

  select jsonb_build_object('lead_id', l.id, 'nome', l.nome, 'telefone', l.telefone, 'carro', l.carro,
                            'horario', f.horario, 'canal', v_canal)
    into v
    from lead l
    cross join lateral (
      select (r->>'de') as horario, (r->>'em')::timestamptz as em
        from jsonb_array_elements(coalesce(l.remarcacoes, '[]'::jsonb)) r
       where (r->>'nao_veio') = 'true' order by (r->>'em') desc limit 1
    ) f
   where l.status = 'nao_compareceu' and l.excluido_em is null
     and coalesce(l.fora_regiao, false) = false
     and length(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g')) >= 10
     and f.em >= now() - interval '30 days'
     and not exists (select 1 from ia_retomada rt where rt.lead_id = l.id)
     -- Atrasado ainda pode chegar: só depois de 3 horas do horário.
     and left(f.horario, 19)::timestamp < v_agora - interval '3 hours'
     -- Quem teve atendimento aberto no dia do horário ou depois VEIO —
     -- foi marcado "não veio" por engano (o Mauro, 28/10, estava a
     -- caminho). Perguntar "o que aconteceu?" a quem veio é o pior erro.
     and not exists (
       select 1 from atendimento a
        where right(regexp_replace(coalesce(a.cliente_telefone, ''), '\D', '', 'g'), 8) = right(regexp_replace(l.telefone, '\D', '', 'g'), 8)
          and a.data >= left(f.horario, 10)::date)
     and not exists (
       select 1 from wa_conversa c join wa_mensagem m on m.conversa_id = c.id
        where right(regexp_replace(c.telefone, '\D', '', 'g'), 8) = right(regexp_replace(l.telefone, '\D', '', 'g'), 8)
          and ((not m.eco and m.quando > now() - interval '24 hours')
               or (m.quando > now() - interval '30 days'
                   and m.texto ~* '(j[aá] vendi|vendi o carro|vendi ele|j[aá] foi vendido|parab[eé]ns pela venda|n[aã]o tenho mais o carro)')))
   order by f.em desc
   limit 1;
  return v;
end;
$$;
revoke all on function ia_retomada_proximo(text) from public;
grant execute on function ia_retomada_proximo(text) to anon, authenticated;
