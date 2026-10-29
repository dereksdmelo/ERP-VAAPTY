-- =====================================================================
-- 0092 — A transferência dos carros vendidos aos lojistas
--
-- O Derek, em 28/10/2026: "um controle pra se certificar que todos os
-- carros, dentro do prazo de 3 meses que nós damos para os lojistas,
-- sejam transferidos… em vermelho quais já passaram de 3 meses. Com
-- opção de configurar uma automação pelo telefone do adm para avisar os
-- lojistas automaticamente quando vencer os 3 meses e também quando
-- estiver faltando 2 meses, 1 mês, 2 semanas e 1 semana… assim que o
-- lojista faz a compra… um whats da adm com um link pra quando ele quiser
-- preencher o DUT ou qualquer dúvida… e mandar o CRLV do veículo".
--
-- **O prazo conta da data da VENDA** (`estoque.vendido_em`). Carro da
-- planilha antiga não tem o dia; a tela estima pela data da compra e diz
-- que é estimativa — mas a automação só fala com lojista sobre data que
-- existe. Mensagem a um cliente com prazo inventado é pior que nenhuma.
--
-- **Cada aviso sai uma vez por carro** (`aviso_lojista`, único por
-- carro e tipo), e só o estágio MAIS RECENTE que chegou: ligar a
-- automação com um carro de 80 dias manda "faltam 2 semanas", não as
-- quatro mensagens atrasadas de uma vez.
--
-- **Nasce desligado.** É mensagem que a loja manda primeiro, por número
-- ligado por QR (decisão 64): ritmo de gente e teto por dia, no banco.
-- =====================================================================

alter table estoque
  add column if not exists transferido_em  date,
  add column if not exists transferido_por uuid references perfil(id),
  add column if not exists transferido_obs text;

alter table config_loja
  add column if not exists lojista_lembretes   boolean not null default false,
  add column if not exists lojista_boas_vindas boolean not null default false,
  add column if not exists lojista_crlv        boolean not null default false;

create table if not exists aviso_lojista (
  id         uuid primary key default gen_random_uuid(),
  estoque_id uuid not null references estoque(id) on delete cascade,
  tipo       text not null check (tipo in ('boas_vindas', 'crlv', 'd2m', 'd1m', 'd2s', 'd1s', 'venceu')),
  estado     text not null check (estado in ('enviado', 'falhou')),
  telefone   text,
  texto      text,
  erro       text,
  wa_id      text,
  criado_em  timestamptz not null default now(),
  unique (estoque_id, tipo)
);
alter table aviso_lojista enable row level security;
drop policy if exists aviso_lojista_le on aviso_lojista;
create policy aviso_lojista_le on aviso_lojista for select to authenticated using (e_equipe());
-- As boas-vindas e o CRLV saem do clique de quem confirmou a venda, com
-- o token dele; os lembretes, do cron, pela função estreita abaixo.
drop policy if exists aviso_lojista_grava on aviso_lojista;
create policy aviso_lojista_grava on aviso_lojista for insert to authenticated with check (e_equipe());

/* O próximo lembrete de prazo a mandar, ou nada. O ritmo mora aqui,
 * como na retomada da 0084: segunda a sábado, 9h às 18h em Joinville,
 * no máximo 30 por dia, e um a cada 90 segundos ou mais. */
create or replace function lojista_aviso_proximo(p_segredo text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  v_agora timestamp := now() at time zone 'America/Sao_Paulo';
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_canal text;
  v_ultima timestamptz;
  v_dia int;
  v jsonb;
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  if not coalesce((select lojista_lembretes from config_loja where id = 1), false) then return null; end if;
  if extract(isodow from v_agora) = 7 or v_agora::time < '09:00' or v_agora::time >= '18:00' then return null; end if;
  select slug into v_canal from wa_canal
   where not comercial and ativo and telefone is not null
   order by (slug ~* 'adm' or nome ~* 'adm') desc, slug limit 1;
  if v_canal is null then return null; end if;
  select max(criado_em), count(*) filter (where (criado_em at time zone 'America/Sao_Paulo')::date = v_hoje)
    into v_ultima, v_dia from aviso_lojista where tipo in ('d2m', 'd1m', 'd2s', 'd1s', 'venceu');
  if v_dia >= 30 then return null; end if;
  if v_ultima is not null and v_ultima > now() - interval '90 seconds' then return null; end if;

  select jsonb_build_object('estoque_id', x.id, 'tipo', x.tipo, 'canal', v_canal,
           'placa', x.placa, 'carro', x.carro, 'nome', x.nome, 'telefone', x.telefone,
           'vendido_em', x.vendido_em, 'prazo', x.prazo)
    into v
    from (
      select e.id, ve.placa, coalesce(ve.marca_modelo, '') as carro, c.nome, c.telefone, e.vendido_em,
             (e.vendido_em + interval '3 months')::date as prazo,
             case
               when v_hoje >= (e.vendido_em + interval '3 months')::date then 'venceu'
               when v_hoje >= (e.vendido_em + interval '3 months')::date - 7 then 'd1s'
               when v_hoje >= (e.vendido_em + interval '3 months')::date - 14 then 'd2s'
               when v_hoje >= (e.vendido_em + interval '2 months')::date then 'd1m'
               when v_hoje >= (e.vendido_em + interval '1 month')::date then 'd2m'
             end as tipo
        from estoque e
        join comprador c on c.id = e.comprador_id
        left join veiculo ve on ve.id = e.veiculo_id
       where e.situacao = 'vendido' and coalesce(e.natureza::text, '') <> 'indicacao'
         and e.transferido_em is null and e.vendido_em is not null
         and length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 10
    ) x
   where x.tipo is not null
     and not exists (select 1 from aviso_lojista a where a.estoque_id = x.id and a.tipo = x.tipo)
   order by x.vendido_em
   limit 1;
  return v;
end;
$$;
revoke all on function lojista_aviso_proximo(text) from public;
grant execute on function lojista_aviso_proximo(text) to anon, authenticated;

create or replace function lojista_aviso_gravar(p_segredo text, p_estoque uuid, p_tipo text, p_estado text,
                                                p_telefone text, p_texto text, p_erro text, p_wa_id text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  insert into aviso_lojista (estoque_id, tipo, estado, telefone, texto, erro, wa_id)
  values (p_estoque, p_tipo, p_estado, p_telefone, p_texto, left(p_erro, 500), p_wa_id)
  on conflict (estoque_id, tipo) do nothing;
end;
$$;
revoke all on function lojista_aviso_gravar(text, uuid, text, text, text, text, text, text) from public;
grant execute on function lojista_aviso_gravar(text, uuid, text, text, text, text, text, text) to anon, authenticated;
