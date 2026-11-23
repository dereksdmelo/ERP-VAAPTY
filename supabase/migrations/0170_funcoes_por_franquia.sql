-- 0170 · As funções que passam por cima da regra também separam a franquia (23/11/2026, decisão 79).
--
-- Funções `security definer` rodam como dono e não passam pela `franquia_isola` (0169). Das 81 que existem, estas
-- são as que um usuário LOGADO chama e que liam ou mexiam em dado de qualquer franquia:
--   * listas — passam a filtrar pela franquia de quem chama: agenda_ultimo_sinal, negociadores_com_login,
--     wa_procurar, fin_investidores_mes, mkt_estado, mkt_token;
--   * por id — recusam o registro de outra franquia: ia_estado_conversa, gravar_resumo_ia, marcar_feedback_lido,
--     fila_estornar, fila_penalizar, fila_repassar, nfse_reservar_numero, renomear_pessoa, unificar_atendimentos;
--   * a tela da sala (sem login, pela chave do link) — tv_painel e tv_agenda leem só a franquia do painel;
--   * mkt_conexao — a conta de anúncios era uma por plataforma no banco inteiro; passa a ser uma por franquia.
-- O corpo de cada função é o que está NO BANCO (sete delas tinham versão mais nova que o repositório), com a
-- franquia acrescentada. Com uma franquia só, nada muda para ninguém.
--
-- O que fica para a etapa seguinte: as funções do servidor (ponte, IA, cron, links de assinatura e DUT), que
-- precisam herdar a franquia do canal ou do registro ao gravar; as numerações por ano (recibo, DUT, NFS-e) e as
-- linhas únicas (config_loja, painel_tv, empresa).
--
-- Mensagens com acento vão em U&'' — o editor do painel estraga acento colado.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------- listas ----------

create or replace function agenda_ultimo_sinal(p_dia date)
returns table (perfil_id uuid, ultimo timestamptz, tipo text)
language sql security definer stable set search_path = public as $$
  select distinct on (a.perfil_id) a.perfil_id, a.feito_em, a.tipo
    from agenda a
   where e_equipe() and a.dia = p_dia and a.feito_em is not null
     and a.franquia_id = minha_franquia()
   order by a.perfil_id, a.feito_em desc;
$$;

create or replace function negociadores_com_login()
returns table (id uuid, nome text)
language sql security definer stable set search_path = public as $$
  select p.id, p.nome from perfil p
   where e_equipe() and p.ativo and p.papel = 'negociador'
     and p.franquia_id = minha_franquia()
   order by p.nome;
$$;

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
    where c.franquia_id = minha_franquia()
      and wa_busca_texto(m.texto, m.anexo, m.leitura) like '%' || replace(replace(q, '%', ''), '_', '\_') || '%'
      and (p_uso is null or k.uso = p_uso)
      and (p_comercial is null or k.comercial = p_comercial)
      and (p_canal is null or k.slug = p_canal)
      and (not p_arquivos or m.tipo = 'midia')
    order by m.quando desc
    limit least(greatest(coalesce(p_limite, 60), 1), 200);
end $$;

create or replace function fin_investidores_mes(p_comp date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not e_financeiro() then raise exception 'apenas o financeiro' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'investidor', to_jsonb(i), 'saldo_hoje', round(fin_inv_saldo(i.id, hoje), 2),
      'juros', fin_inv_juros_de(i, p_comp)) order by i.tipo desc, i.nome)
    from fin_investidor i where i.franquia_id = minha_franquia()), '[]'::jsonb);
end $$;

-- A conta de anúncios: uma por plataforma POR FRANQUIA.
alter table mkt_conexao drop constraint if exists mkt_conexao_pkey;
alter table mkt_conexao add primary key (franquia_id, plataforma);

create or replace function mkt_conectar(p_plataforma text, p_conta text, p_token text, p_nome text)
returns void language plpgsql security definer set search_path = public as $$
declare fr uuid := minha_franquia();
begin
  if not e_gerente() then raise exception '%', U&'s\00F3 o gerente conecta a conta de an\00FAncios' using errcode = '42501'; end if;
  if fr is null then raise exception 'sem franquia' using errcode = '42501'; end if;
  if p_token is null or p_token = '' then
    delete from mkt_conexao where plataforma = p_plataforma and franquia_id = fr;
    return;
  end if;
  insert into mkt_conexao (franquia_id, plataforma, conta, token, nome) values (fr, p_plataforma, p_conta, p_token, p_nome)
  on conflict (franquia_id, plataforma) do update set conta = excluded.conta, token = excluded.token, nome = excluded.nome,
    conectado_por = auth.uid(), conectado_em = now();
end $$;

create or replace function mkt_estado()
returns table (plataforma text, conta text, nome text, conectado_em timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not (e_gerente() or e_financeiro()) then raise exception 'sem acesso' using errcode = '42501'; end if;
  return query select m.plataforma, m.conta, m.nome, m.conectado_em from mkt_conexao m where m.franquia_id = minha_franquia();
end $$;

create or replace function mkt_token(p_plataforma text)
returns table (conta text, token text) language plpgsql security definer set search_path = public as $$
begin
  if not (e_gerente() or e_financeiro()) then raise exception 'sem acesso' using errcode = '42501'; end if;
  return query select m.conta, m.token from mkt_conexao m where m.plataforma = p_plataforma and m.franquia_id = minha_franquia();
end $$;

-- ---------- por id ----------

create or replace function ia_estado_conversa(p_conversa uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare cv wa_conversa%rowtype; ca wa_canal%rowtype; humano timestamptz;
begin
  if not e_equipe() then raise exception 'sem acesso' using errcode = '42501'; end if;
  select * into cv from wa_conversa where id = p_conversa and franquia_id = minha_franquia();
  if cv.id is null then return null; end if;
  select * into ca from wa_canal where id = cv.canal_id;
  if cv.grupo then return jsonb_build_object('estado', 'grupo'); end if;
  if not (ca.ativo and ca.ia_responde and ca.ia_desde is not null) then
    return jsonb_build_object('estado', 'numero_sem_ia', 'modo', cv.ia_modo);
  end if;
  if cv.ia_modo = 'desligada' then return jsonb_build_object('estado', 'desligada', 'modo', cv.ia_modo); end if;
  select max(h.quando) into humano from wa_mensagem h
   where h.conversa_id = cv.id and h.eco
     and h.quando >= greatest(now() - interval '12 hours', case when cv.ia_modo = 'ligada' then cv.ia_ligada_em else '-infinity'::timestamptz end)
     and not exists (select 1 from ia_resposta r2 where r2.conversa_id = cv.id and r2.wa_ids ? h.wa_id)
     and not exists (select 1 from ia_retomada rt where rt.wa_ids ? h.wa_id);
  if humano is not null then
    return jsonb_build_object('estado', 'pausada', 'modo', cv.ia_modo, 'ate', humano + interval '12 hours');
  end if;
  return jsonb_build_object('estado', 'ligada', 'modo', cv.ia_modo);
end $$;

create or replace function gravar_resumo_ia(p_atendimento uuid, p_texto text, p_modelo text) returns boolean as $$
declare linhas integer;
begin
  if not e_gerente() then return false; end if;
  update negociacao_viva
     set resumo_ia        = left(coalesce(p_texto, ''), 4000),
         resumo_ia_em     = now(),
         resumo_ia_modelo = left(coalesce(p_modelo, ''), 80)
   where atendimento_id = p_atendimento and franquia_id = minha_franquia();
  get diagnostics linhas = row_count;
  return linhas > 0;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

create or replace function marcar_feedback_lido(alvo uuid)
returns void as $$
  update revisao set lida_em = now()
   where atendimento_id = alvo
     and lida_em is null
     and exists (
       select 1 from atendimento a
        where a.id = alvo
          and a.franquia_id = minha_franquia()
          and (a.negociador_id = auth.uid() or a.negociador_id is null)
     );
$$ language sql security definer set search_path = public, pg_temp;

create or replace function fila_estornar(p_evento uuid) returns boolean
language plpgsql security definer set search_path to 'public' as $function$
declare e fila_evento%rowtype; v_meta uuid;
begin
 if not e_gerente() then raise exception '%', U&'S\00F3 o gerente desfaz.'; end if;
 select * into e from fila_evento where id = p_evento and franquia_id = minha_franquia() for update;
 if e.id is null or not e.penalizado or e.estornado_em is not null then return false; end if;
 update fila_evento set estornado_em = now() where id = e.id;
 select id into v_meta from negociador where perfil_id = e.perfil_id order by ativo desc limit 1;
 if v_meta is not null then
 update desempenho set perdeu_atendimento = greatest(0, perdeu_atendimento - 1), atualizado_em = now()
 where negociador_id = v_meta and competencia = date_trunc('month', e.dia)::date;
 end if;
 return true;
end; $function$;

create or replace function fila_penalizar(p_evento uuid) returns boolean
language plpgsql security definer set search_path to 'public' as $function$
declare e fila_evento%rowtype; v_meta uuid; v_comp date;
begin
 if not e_equipe() then return false; end if;
 select * into e from fila_evento where id = p_evento and franquia_id = minha_franquia() for update;
 if e.id is null or e.tipo <> 'vez' or e.resposta not in ('passou','expirou') or e.penalizado then return false; end if;
 select id into v_meta from negociador where perfil_id = e.perfil_id order by ativo desc limit 1;
 update fila_evento set penalizado = true where id = e.id;
 if v_meta is null then return true; end if;
 v_comp := date_trunc('month', e.dia)::date;
 insert into desempenho (negociador_id, competencia, perdeu_atendimento) values (v_meta, v_comp, 1)
 on conflict (negociador_id, competencia) do update set perdeu_atendimento = desempenho.perdeu_atendimento + 1, atualizado_em = now();
 return true;
end; $function$;

create or replace function fila_repassar(p_atendimento uuid, p_para uuid, p_nome text) returns boolean
language plpgsql security definer set search_path to 'public' as $function$
begin
 if not e_equipe() then return false; end if;
 if not exists (select 1 from fila_evento where atendimento_id = p_atendimento and tipo = 'vez'
                  and resposta in ('passou','expirou') and franquia_id = minha_franquia()) then return false; end if;
 update atendimento set negociador_id = p_para, negociador_nome = coalesce(nullif(btrim(p_nome), ''), negociador_nome)
  where id = p_atendimento and franquia_id = minha_franquia();
 return found;
end; $function$;

create or replace function nfse_reservar_numero(p_nfse uuid)
returns table(serie text, numero bigint)
language plpgsql security definer set search_path to 'public' as $function$
#variable_conflict use_column
declare s text; n bigint; amb text;
begin
 if not (e_financeiro() or e_gerente()) then raise exception 'sem acesso' using errcode = '42501'; end if;
 select x.numero_dps, x.serie, x.ambiente into n, s, amb from nfse x where x.id = p_nfse and x.franquia_id = minha_franquia();
 if amb is null then raise exception '%', U&'nota n\00E3o encontrada'; end if;
 if n is not null then return query select s, n; return; end if;
 if amb = 'producao' then
 update empresa set nfse_proximo_producao = nfse_proximo_producao + 1 where id = 1
 returning nfse_serie_producao, nfse_proximo_producao - 1 into s, n;
 else
 update empresa set nfse_proximo_restrita = nfse_proximo_restrita + 1 where id = 1
 returning nfse_serie_restrita, nfse_proximo_restrita - 1 into s, n;
 end if;
 update nfse set serie = s, numero_dps = n where id = p_nfse;
 return query select s, n;
end $function$;

create or replace function renomear_pessoa(p_colaborador uuid, p_nome text) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
 c colaborador%rowtype;
 novo text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
 velhas text[]; outras text[]; minhas text[];
 n_at int := 0; n_es int := 0; n_doc int := 0; n_lead int := 0; n_ind int := 0; n_msg int := 0; x int;
 fr uuid;
begin
 if not (e_gerente() or e_financeiro()) then raise exception '%', U&'s\00F3 o gerente ou o financeiro renomeia' using errcode = '42501'; end if;
 if length(novo) < 2 then raise exception 'Escreva o nome.'; end if;
 select * into c from colaborador where id = p_colaborador and franquia_id = minha_franquia();
 if c.id is null then raise exception '%', U&'Ficha n\00E3o encontrada.'; end if;
 fr := c.franquia_id;
 select coalesce(array_agg(distinct k), '{}') into outras from (
 select nome_chave(p.nome) k from perfil p where p.id is distinct from c.perfil_id and p.franquia_id = fr
 union select nome_chave(n.nome) from negociador n where n.id is distinct from c.negociador_id and n.franquia_id = fr
 union select nome_chave(o.nome_sistema) from colaborador o where o.id <> c.id and o.nome_sistema is not null and o.franquia_id = fr
 ) t where k <> '';
 if nome_chave(novo) = any(outras) then raise exception '%', format(U&'J\00E1 existe outra pessoa com o nome "%s". Escolha um nome que s\00F3 ela tenha.', novo); end if;
 select coalesce(array_agg(distinct k), '{}') into velhas from (
 select nome_chave(c.nome_sistema) k
 union select nome_chave(p.nome) from perfil p where p.id = c.perfil_id
 union select nome_chave(n.nome) from negociador n where n.id = c.negociador_id
 ) t where k <> '';
 select coalesce(array_agg(k), '{}') into minhas from unnest(velhas) k where not (k = any(outras));
 update colaborador set nome_sistema = novo where id = c.id;
 if c.perfil_id is not null then update perfil set nome = novo where id = c.perfil_id; end if;
 if c.negociador_id is not null then update negociador set nome = novo where id = c.negociador_id; end if;
 update atendimento set negociador_nome = novo
 where franquia_id = fr and negociador_nome is distinct from novo
 and ((c.perfil_id is not null and negociador_id = c.perfil_id) or nome_chave(negociador_nome) = any(minhas));
 get diagnostics n_at = row_count;
 update estoque set negociador_nome = novo where franquia_id = fr and negociador_nome is distinct from novo and nome_chave(negociador_nome) = any(minhas);
 get diagnostics n_es = row_count;
 update documento set negociador = novo where franquia_id = fr and negociador is distinct from novo and nome_chave(negociador) = any(minhas);
 get diagnostics n_doc = row_count;
 update lead set negociador_nome = novo where franquia_id = fr and negociador_nome is distinct from novo and nome_chave(negociador_nome) = any(minhas);
 get diagnostics n_lead = row_count;
 update lead set agendado_por_nome = novo where franquia_id = fr and agendado_por_nome is distinct from novo and nome_chave(agendado_por_nome) = any(minhas);
 get diagnostics x = row_count; n_lead := n_lead + x;
 update indicacao set negociador_nome = novo where franquia_id = fr and negociador_nome is distinct from novo and nome_chave(negociador_nome) = any(minhas);
 get diagnostics n_ind = row_count;
 update wa_mensagem set enviado_por_nome = novo
 where franquia_id = fr and enviado_por_nome is distinct from novo
 and ((c.perfil_id is not null and enviado_por = c.perfil_id) or nome_chave(enviado_por_nome) = any(minhas));
 get diagnostics n_msg = row_count;
 return jsonb_build_object('nome', novo, 'atendimentos', n_at, 'carros', n_es, 'documentos', n_doc,
 'leads', n_lead, 'indicacoes', n_ind, 'mensagens', n_msg,
 'ambiguos', (select coalesce(array_agg(k), '{}') from unnest(velhas) k where k = any(outras)));
end $function$;

-- unificar_atendimentos: só o começo muda (os dois atendimentos têm de ser da franquia de quem chama); o resto do
-- corpo é o do banco, aplicado por substituição para não reescrever 80 linhas à mão.
do $$
declare d text;
begin
  select pg_get_functiondef('public.unificar_atendimentos(uuid, uuid)'::regprocedure) into d;
  if position('minha_franquia()' in d) = 0 then
    d := replace(d,
      'select * into f from atendimento where id = p_fica;',
      'select * into f from atendimento where id = p_fica and franquia_id = minha_franquia();');
    d := replace(d,
      'select * into s from atendimento where id = p_sai;',
      'select * into s from atendimento where id = p_sai and franquia_id = minha_franquia();');
    if position('minha_franquia()' in d) = 0 then raise exception 'unificar_atendimentos: trecho esperado nao achado'; end if;
    execute d;
  end if;
end $$;

-- ---------- a tela da sala (sem login) ----------

create or replace function tv_painel(p_token text)
returns jsonb
language plpgsql security definer set search_path = public stable as $$
declare
  cfg painel_tv;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  ini date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  fim date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) + interval '1 month - 1 day')::date;
  v jsonb;
begin
  select * into cfg from painel_tv where id = 1;
  if cfg.token is null or p_token is null or length(p_token) < 20 or cfg.token <> p_token then
    raise exception '%', U&'link da tela inv\00E1lido' using errcode = '42501';
  end if;

  with neg as (
    select nome, sem_acento_maiusc(nome) as k, coalesce(meta_valor, 0) as meta
      from negociador where ativo and papel = 'negociador' and franquia_id = cfg.franquia_id),
  vend as (
    select sem_acento_maiusc(e.negociador_nome) as k, count(*) as carros,
           sum(coalesce(e.valor_venda, 0) - coalesce(e.valor_compra, 0)
               - coalesce((select sum(coalesce(c.realizado, c.previsto, 0)) from estoque_custo c where c.estoque_id = e.id), 0)) as rent
      from estoque e
     where e.franquia_id = cfg.franquia_id and e.situacao = 'vendido'
       and ((e.vendido_em between ini and fim) or (e.vendido_em is null and e.entrou_em between ini and fim))
     group by 1),
  ats as (
    select sem_acento_maiusc(a.negociador_nome) as k, count(*) as fluxo,
           count(*) filter (where a.status = 'fechado') as fechados,
           count(*) filter (where a.data = hoje) as fluxo_hoje,
           count(*) filter (where a.data = hoje and a.status = 'fechado') as fechados_hoje
      from atendimento a where a.franquia_id = cfg.franquia_id and a.data between ini and fim group by 1),
  entrou as (
    select e.id, e.criado_em, coalesce(nullif(e.negociador_nome, ''), U&'\2014') as negociador,
           coalesce(ve.marca_modelo, '') as carro
      from estoque e left join veiculo ve on ve.id = e.veiculo_id
     where e.franquia_id = cfg.franquia_id
       and e.criado_em >= (ini::timestamp at time zone 'America/Sao_Paulo')
       and coalesce(e.natureza, 'compra') = 'compra' and e.situacao <> 'baixado'
     order by e.criado_em desc limit 30)
  select jsonb_build_object(
    'agora', now(), 'hoje', hoje, 'inicio', ini, 'fim', fim,
    'config', cfg.config,
    'meta_loja', (select valor from meta_loja where competencia = ini and franquia_id = cfg.franquia_id),
    'pessoas', (select coalesce(jsonb_agg(jsonb_build_object(
        'nome', n.nome, 'meta', n.meta, 'feito', coalesce(v.rent, 0), 'carros', coalesce(v.carros, 0),
        'fluxo', coalesce(a.fluxo, 0), 'fechados', coalesce(a.fechados, 0),
        'fluxo_hoje', coalesce(a.fluxo_hoje, 0), 'fechados_hoje', coalesce(a.fechados_hoje, 0))
        order by coalesce(v.rent, 0) desc), '[]'::jsonb)
      from neg n left join vend v on v.k = n.k left join ats a on a.k = n.k),
    'loja', jsonb_build_object(
      'feito', (select coalesce(sum(rent), 0) from vend),
      'carros', (select coalesce(sum(carros), 0) from vend),
      'fluxo', (select coalesce(sum(fluxo), 0) from ats),
      'fechados', (select coalesce(sum(fechados), 0) from ats),
      'fluxo_hoje', (select coalesce(sum(fluxo_hoje), 0) from ats),
      'fechados_hoje', (select coalesce(sum(fechados_hoje), 0) from ats)),
    'entradas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'quando', criado_em, 'negociador', negociador, 'carro', carro)), '[]'::jsonb) from entrou)
  ) into v;
  return v;
end;
$$;

create or replace function tv_agenda(p_token text)
returns jsonb
language plpgsql stable security definer set search_path to 'public' as $function$
declare
 cfg painel_tv;
 agora timestamp := (now() at time zone 'America/Sao_Paulo');
 hoje date := agora::date;
 seg date := case when extract(isodow from hoje) = 7 then hoje + 1 else hoje - ((extract(isodow from hoje)::int) - 1) end;
 v jsonb;
begin
 select * into cfg from painel_tv where id = 1;
 if cfg.token is null or p_token is null or length(p_token) < 20 or cfg.token <> p_token then
 raise exception '%', U&'link da tela inv\00E1lido' using errcode = '42501';
 end if;
 with atuais as (
 select (l.agendado_para at time zone 'UTC') as quando, coalesce(nullif(l.carro, ''), '') as carro,
 coalesce(l.agendado_por_nome, '') as agendou,
 case
 when l.status = 'perdido' then 'cancelou'
 when a.status = 'fechado' then 'fechou'
 when l.status = 'compareceu' or l.atendimento_id is not null then 'veio'
 when l.status = 'nao_compareceu' then 'naoVeio'
 when (l.agendado_para at time zone 'UTC') < agora then 'passou'
 when l.status = 'confirmado' then 'confirmado'
 else 'agendado' end as estado
 from lead l
 left join atendimento a on a.id = l.atendimento_id
 where l.franquia_id = cfg.franquia_id and l.agendado_para is not null and l.excluido_em is null
 and l.status in ('agendado', 'confirmado', 'compareceu', 'nao_compareceu', 'perdido')
 and (l.agendado_para at time zone 'UTC')::date between seg and seg + 5),
 antigos as (
 select ((r->>'de')::timestamptz at time zone 'UTC') as quando, coalesce(nullif(l.carro, ''), '') as carro,
 coalesce(l.agendado_por_nome, '') as agendou,
 case when (r->>'nao_veio')::boolean is true
 and not (l.agendado_para is not null and l.agendado_para > (r->>'de')::timestamptz) then 'naoVeio'
 else 'remarcou' end as estado
 from lead l, jsonb_array_elements(case when jsonb_typeof(l.remarcacoes) = 'array' then l.remarcacoes else '[]'::jsonb end) r
 where l.franquia_id = cfg.franquia_id and l.excluido_em is null and r ? 'de'
 and ((r->>'de')::timestamptz at time zone 'UTC')::date between seg and seg + 5
 and not (l.agendado_para is not null and l.agendado_para = (r->>'de')::timestamptz)),
 tudo as (select * from atuais union all select * from antigos)
 select jsonb_build_object('hoje', hoje, 'segunda', seg,
 'itens', coalesce(jsonb_agg(jsonb_build_object(
 'dia', t.quando::date, 'hora', to_char(t.quando, 'HH24:MI'),
 'carro', t.carro, 'estado', t.estado, 'agendou', t.agendou)
 order by t.quando), '[]'::jsonb))
 into v from tudo t;
 return v;
end;
$function$;

notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0170_funcoes_por_franquia.sql') on conflict do nothing;
