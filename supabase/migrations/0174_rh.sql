-- 0174 · RH: captar, organizar e reter talentos (23/11/2026, decisão 80).
--
-- O Derek: "um módulo para RH. O objetivo é captar os talentos, currículos, responder teste DISC, procurar pessoas
-- interessadas em trabalhar na Vaapty Joinville, organizar e reter esses talentos."
--
-- Quatro peças:
--   rh_vaga            as vagas (abertas ou não, publicadas ou não no "Trabalhe conosco")
--   rh_candidato       a pessoa interessada — com ou sem vaga (sem vaga = banco de talentos), o DISC e a etapa
--   rh_anexo           o currículo e o que mais ela mandar (bucket documentos-veiculo, pasta rh/)
--   rh_evento          o histórico: candidatura, ligação, entrevista, mudança de etapa, nota
--   rh_acompanhamento  a retenção: conversa, feedback, pulso (humor), risco de saída — por colaborador (0079)
--
-- **Quem lê é o RH** (`e_rh()`: o gerente ou quem tem `perfil.rh`). Currículo, telefone e o que se anota numa
-- entrevista são dado pessoal; a equipe inteira não precisa ler.
--
-- **O candidato não tem login.** A página pública (`trabalhe.html`) entra pelas funções estreitas abaixo, pela chave
-- anônima — a régua do DUT (0057) e da assinatura (0048): token em hash, prazo curto, e cada função só sabe fazer uma
-- coisa. A chave de serviço só toca o Storage, no api/foto.js (decisão 9).
--
-- **Tabela nova nasce com franquia_id** (decisão 79): padrão `minha_franquia()` (sem login fica nulo e o insert falha
-- alto, em vez de cair calado em Joinville), a política restritiva `franquia_isola` da 0169, e as funções públicas
-- recebem a franquia pelo slug do link (`?f=`), como o DUT.

set lock_timeout = '3s';
set statement_timeout = '60s';

alter table perfil add column if not exists rh boolean not null default false;
comment on column perfil.rh is 'Entra no RH: vagas, candidatos, currículos, DISC e retenção. Gerente sempre entra.';

create or replace function e_rh()
returns boolean as $$
  select coalesce((select rh or papel = 'gerente' from perfil where id = auth.uid() and ativo), false);
$$ language sql stable security definer set search_path = public, pg_temp;

/* O telefone como chave: DDD + oito últimos, com ou sem o 55 e o nono dígito. A `wa_chave_fone` (0148) só lê número
 * com o 55 na frente, que é como o WhatsApp manda; quem digita no formulário escreve "47 99999-9999". */
create or replace function rh_chave_fone(t text) returns text language sql immutable as $$
  select case when length(d) >= 10 then substr(d, 1, 2) || right(d, 8) end
    from (select case when length(x) >= 12 and left(x, 2) = '55' then substr(x, 3) else x end d
            from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') x) a) b
$$;

-- ---------------------------------------------------------------- vagas
create table if not exists rh_vaga (
  id           uuid primary key default gen_random_uuid(),
  franquia_id  uuid not null default minha_franquia() references franquia(id),
  titulo       text not null,
  setor        text not null default 'negociacao'
               check (setor in ('negociacao', 'prevendas', 'administrativo', 'gestao', 'outro')),
  descricao    text,
  requisitos   text,
  oferecemos   text,      -- remuneração, benefícios, horário: o que a pessoa lê para decidir
  modalidade   text,      -- "Presencial em Joinville", "PJ", "CLT"…
  perfil_disc  text,      -- o perfil que costuma dar certo na função ("DI", "SC"…); compara com o do candidato
  aberta       boolean not null default true,
  publica      boolean not null default true,   -- aparece no "Trabalhe conosco"
  criado_por   uuid references perfil(id),
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ----------------------------------------------------------- candidatos
create table if not exists rh_candidato (
  id              uuid primary key default gen_random_uuid(),
  franquia_id     uuid not null default minha_franquia() references franquia(id),
  vaga_id         uuid references rh_vaga(id) on delete set null,
  nome            text not null,
  telefone        text,
  email           text,
  cidade          text,
  bairro          text,
  nascimento      date,
  linkedin        text,
  experiencia     text,
  formacao        text,
  pretensao       text,
  disponibilidade text,
  -- De onde a pessoa veio: é o que diz em que canal vale a pena divulgar.
  origem          text not null default 'site'
                  check (origem in ('site', 'indicacao', 'instagram', 'facebook', 'linkedin', 'indeed', 'whatsapp',
                                    'busca_ativa', 'colaborador', 'outro')),
  indicado_por    text,
  mensagem        text,
  -- As etapas nomeiam o que falta fazer (a régua do quadro da pré-venda, decisão 51).
  etapa           text not null default 'novo'
                  check (etapa in ('novo', 'triagem', 'entrevista', 'teste', 'proposta', 'contratado',
                                   'banco', 'reprovado', 'desistiu')),
  motivo          text,
  nota            smallint check (nota between 1 and 5),
  tags            text[] not null default '{}',
  responsavel_id  uuid references perfil(id),
  proximo_contato date,
  entrevista_em   timestamptz,
  -- O DISC: as quatro notas de 0 a 100, o perfil ("DI") e as respostas, para refazer a conta se a régua mudar.
  disc_d          smallint, disc_i smallint, disc_s smallint, disc_c smallint,
  disc_perfil     text,
  disc_respostas  jsonb,
  disc_em         timestamptz,
  -- LGPD: a pessoa marcou que autoriza guardar o currículo para esta e outras vagas.
  consentimento_em timestamptz,
  colaborador_id  uuid references colaborador(id) on delete set null,
  token_hash      text,
  token_ate       timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);
create index if not exists rh_candidato_etapa on rh_candidato (etapa, criado_em desc);
create index if not exists rh_candidato_fone on rh_candidato (rh_chave_fone(telefone));
create index if not exists rh_candidato_token on rh_candidato (token_hash) where token_hash is not null;

create table if not exists rh_anexo (
  id           uuid primary key default gen_random_uuid(),
  franquia_id  uuid not null default minha_franquia() references franquia(id),
  candidato_id uuid not null references rh_candidato(id) on delete cascade,
  caminho      text not null,
  nome         text,
  tipo         text,
  bytes        int,
  rotulo       text not null default 'Currículo',
  enviado_por  uuid references perfil(id),
  criado_em    timestamptz not null default now()
);
create index if not exists rh_anexo_cand on rh_anexo (candidato_id, criado_em desc);

create table if not exists rh_evento (
  id           uuid primary key default gen_random_uuid(),
  franquia_id  uuid not null default minha_franquia() references franquia(id),
  candidato_id uuid not null references rh_candidato(id) on delete cascade,
  tipo         text not null default 'nota'
               check (tipo in ('candidatura', 'nota', 'ligacao', 'whatsapp', 'entrevista', 'etapa', 'disc', 'anexo')),
  texto        text,
  por          uuid references perfil(id),
  por_nome     text,
  em           timestamptz not null default now()
);
create index if not exists rh_evento_cand on rh_evento (candidato_id, em desc);

-- ------------------------------------------------------------- retenção
create table if not exists rh_acompanhamento (
  id             uuid primary key default gen_random_uuid(),
  franquia_id    uuid not null default minha_franquia() references franquia(id),
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  tipo           text not null default 'conversa'
                 check (tipo in ('conversa', 'feedback', 'pulso', 'elogio', 'alerta', 'desligamento')),
  humor          smallint check (humor between 1 and 5),     -- o pulso: como a pessoa está
  enps           smallint check (enps between 0 and 10),     -- "indicaria a Vaapty para um amigo trabalhar?"
  risco          text check (risco in ('baixo', 'medio', 'alto')),
  texto          text,
  proximo_em     date,
  por            uuid references perfil(id),
  por_nome       text,
  em             timestamptz not null default now()
);
create index if not exists rh_acomp_colab on rh_acompanhamento (colaborador_id, em desc);

alter table rh_vaga           enable row level security;
alter table rh_candidato      enable row level security;
alter table rh_anexo          enable row level security;
alter table rh_evento         enable row level security;
alter table rh_acompanhamento enable row level security;

do $$
declare t text;
begin
  foreach t in array array['rh_vaga', 'rh_candidato', 'rh_anexo', 'rh_evento', 'rh_acompanhamento'] loop
    execute format('drop policy if exists rh_gere on public.%I', t);
    execute format('create policy rh_gere on public.%I for all to authenticated using (e_rh()) with check (e_rh())', t);
    execute format('drop policy if exists franquia_isola on public.%I', t);
    execute format('create policy franquia_isola on public.%I as restrictive for all to authenticated '
                   'using (franquia_id = (select coalesce(nullif(auth.jwt() ->> ''franquia_id'', '''')::uuid, minha_franquia()))) '
                   'with check (franquia_id = (select coalesce(nullif(auth.jwt() ->> ''franquia_id'', '''')::uuid, minha_franquia())))', t);
  end loop;
end $$;

-- O currículo chega em Word muitas vezes. O bucket aceitava PDF e imagem (0008) e áudio/vídeo (0063).
update storage.buckets
   set allowed_mime_types = (select array(select distinct unnest(coalesce(allowed_mime_types, '{}') || array[
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])))
 where id = 'documentos-veiculo' and allowed_mime_types is not null;

-- =================================================== as funções do público
-- As vagas que aparecem no "Trabalhe conosco". Só o que a pessoa precisa para decidir — nada de quem criou.
create or replace function rh_vagas_publicas(p_franquia text default null)
returns table (id uuid, titulo text, setor text, descricao text, requisitos text, oferecemos text, modalidade text)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id, v.titulo, v.setor, v.descricao, v.requisitos, v.oferecemos, v.modalidade
    from rh_vaga v
   where v.aberta and v.publica and v.franquia_id = franquia_do_slug(p_franquia)
   order by v.criado_em desc;
$$;

/* A candidatura. Quem já se candidatou com o mesmo telefone (DDD + oito últimos, `rh_chave_fone`) não vira
 * outra pessoa: a linha é atualizada com o que veio, e a vaga nova fica no histórico. Quem estava no banco, reprovado
 * ou tinha desistido volta para "novo" — se escreveu de novo, quer ser olhado de novo. O token vale duas horas, para o
 * currículo e o DISC subirem em seguida. */
create or replace function rh_candidatar(p_token_hash text, p_franquia text, p_dados jsonb)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_fr   uuid := franquia_do_slug(p_franquia);
  v_nome text := nullif(trim(p_dados ->> 'nome'), '');
  v_fone text := nullif(trim(p_dados ->> 'telefone'), '');
  v_mail text := nullif(lower(trim(p_dados ->> 'email')), '');
  v_vaga uuid;
  v_vtit text;
  v_id   uuid;
  v_orig text := coalesce(nullif(p_dados ->> 'origem', ''), 'site');
  v_nasc date;
begin
  if v_fr is null then raise exception '%', U&'loja n\00E3o encontrada' using errcode = 'P0001'; end if;
  if v_nome is null then raise exception 'informe o nome' using errcode = 'P0001'; end if;
  if v_fone is null and v_mail is null then
    raise exception '%', U&'informe o WhatsApp ou o e-mail' using errcode = 'P0001';
  end if;
  if v_orig not in ('site', 'indicacao', 'instagram', 'facebook', 'linkedin', 'indeed', 'whatsapp', 'outro') then
    v_orig := 'outro';
  end if;
  begin v_nasc := nullif(p_dados ->> 'nascimento', '')::date; exception when others then v_nasc := null; end;

  begin v_vaga := nullif(p_dados ->> 'vaga_id', '')::uuid; exception when others then v_vaga := null; end;
  if v_vaga is not null then
    select titulo into v_vtit from rh_vaga where id = v_vaga and franquia_id = v_fr and aberta;
    if v_vtit is null then v_vaga := null; end if;
  end if;

  select c.id into v_id from rh_candidato c
   where c.franquia_id = v_fr
     and ((v_fone is not null and rh_chave_fone(c.telefone) = rh_chave_fone(v_fone))
       or (v_mail is not null and lower(c.email) = v_mail))
   order by c.criado_em desc limit 1;

  if v_id is null then
    insert into rh_candidato (franquia_id, vaga_id, nome, telefone, email, cidade, bairro, nascimento, linkedin,
                              experiencia, formacao, pretensao, disponibilidade, origem, indicado_por, mensagem,
                              consentimento_em, token_hash, token_ate)
    values (v_fr, v_vaga, left(v_nome, 120), left(v_fone, 40), left(v_mail, 160),
            left(nullif(p_dados ->> 'cidade', ''), 80), left(nullif(p_dados ->> 'bairro', ''), 80), v_nasc,
            left(nullif(p_dados ->> 'linkedin', ''), 200), left(nullif(p_dados ->> 'experiencia', ''), 4000),
            left(nullif(p_dados ->> 'formacao', ''), 400), left(nullif(p_dados ->> 'pretensao', ''), 120),
            left(nullif(p_dados ->> 'disponibilidade', ''), 200), v_orig,
            left(nullif(p_dados ->> 'indicado_por', ''), 120), left(nullif(p_dados ->> 'mensagem', ''), 2000),
            now(), nullif(p_token_hash, ''), now() + interval '2 hours')
    returning id into v_id;
  else
    update rh_candidato c set
      nome = left(v_nome, 120),
      telefone = coalesce(left(v_fone, 40), c.telefone),
      email = coalesce(left(v_mail, 160), c.email),
      cidade = coalesce(left(nullif(p_dados ->> 'cidade', ''), 80), c.cidade),
      bairro = coalesce(left(nullif(p_dados ->> 'bairro', ''), 80), c.bairro),
      nascimento = coalesce(v_nasc, c.nascimento),
      linkedin = coalesce(left(nullif(p_dados ->> 'linkedin', ''), 200), c.linkedin),
      experiencia = coalesce(left(nullif(p_dados ->> 'experiencia', ''), 4000), c.experiencia),
      formacao = coalesce(left(nullif(p_dados ->> 'formacao', ''), 400), c.formacao),
      pretensao = coalesce(left(nullif(p_dados ->> 'pretensao', ''), 120), c.pretensao),
      disponibilidade = coalesce(left(nullif(p_dados ->> 'disponibilidade', ''), 200), c.disponibilidade),
      indicado_por = coalesce(left(nullif(p_dados ->> 'indicado_por', ''), 120), c.indicado_por),
      mensagem = coalesce(left(nullif(p_dados ->> 'mensagem', ''), 2000), c.mensagem),
      vaga_id = coalesce(v_vaga, c.vaga_id),
      etapa = case when c.etapa in ('banco', 'reprovado', 'desistiu') then 'novo' else c.etapa end,
      consentimento_em = now(),
      token_hash = nullif(p_token_hash, ''), token_ate = now() + interval '2 hours',
      atualizado_em = now()
     where c.id = v_id;
  end if;

  insert into rh_evento (franquia_id, candidato_id, tipo, texto)
  values (v_fr, v_id, 'candidatura',
          case when v_vtit is not null then 'Candidatou-se pelo site à vaga ' || v_vtit
               else U&'Cadastrou-se pelo site no banco de talentos' end);
  return v_id;
end;
$$;

-- O que o link sabe: o primeiro nome (para a página cumprimentar) e se o DISC já foi feito. Nada mais.
create or replace function rh_token(p_token_hash text)
returns table (id uuid, primeiro_nome text, disc_feito boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, split_part(c.nome, ' ', 1), c.disc_em is not null
    from rh_candidato c
   where c.token_hash = p_token_hash and p_token_hash is not null and c.token_ate > now()
   limit 1;
$$;

/* O resultado do DISC. A conta é feita no servidor (regras/disc.js) a partir das respostas; quem chamar esta função
 * direto com notas inventadas só mente sobre o próprio teste, e as respostas ficam guardadas para conferir. */
create or replace function rh_disc_gravar(p_token_hash text, p_d int, p_i int, p_s int, p_c int, p_perfil text, p_respostas jsonb)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_fr uuid;
begin
  select c.id, c.franquia_id into v_id, v_fr from rh_candidato c
   where c.token_hash = p_token_hash and p_token_hash is not null and c.token_ate > now() limit 1;
  if v_id is null then return false; end if;
  update rh_candidato set
    disc_d = greatest(0, least(100, p_d)), disc_i = greatest(0, least(100, p_i)),
    disc_s = greatest(0, least(100, p_s)), disc_c = greatest(0, least(100, p_c)),
    disc_perfil = left(p_perfil, 4), disc_respostas = p_respostas, disc_em = now(), atualizado_em = now()
   where id = v_id;
  insert into rh_evento (franquia_id, candidato_id, tipo, texto)
  values (v_fr, v_id, 'disc', 'Respondeu o teste DISC: perfil ' || left(p_perfil, 4));
  return true;
end;
$$;

-- O currículo que a página pública sobe. Até cinco arquivos por pessoa por esse caminho.
create or replace function rh_anexar(p_token_hash text, p_caminho text, p_nome text, p_tipo text, p_bytes int)
returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_fr uuid;
begin
  select c.id, c.franquia_id into v_id, v_fr from rh_candidato c
   where c.token_hash = p_token_hash and p_token_hash is not null and c.token_ate > now() limit 1;
  if v_id is null then return false; end if;
  if (select count(*) from rh_anexo where candidato_id = v_id and enviado_por is null) >= 5 then return false; end if;
  if p_caminho !~ ('^rh/' || v_id::text || '/') then return false; end if;
  insert into rh_anexo (franquia_id, candidato_id, caminho, nome, tipo, bytes, rotulo)
  values (v_fr, v_id, p_caminho, left(p_nome, 200), left(p_tipo, 120), p_bytes, U&'Curr\00EDculo');
  insert into rh_evento (franquia_id, candidato_id, tipo, texto)
  values (v_fr, v_id, 'anexo', U&'Enviou o curr\00EDculo: ' || coalesce(left(p_nome, 120), 'arquivo'));
  return true;
end;
$$;

/* A equipe para a retenção. A ficha do colaborador (0079) é do financeiro, com CPF e conta; o RH precisa só de quem é,
 * a função e desde quando está na casa. Esta função devolve isso e nada mais, para quem é do RH. */
create or replace function rh_equipe()
returns table (id uuid, nome text, funcao text, telefone text, inicio_em date, desligado_em date,
               motivo_desligamento text, tipo_contrato text, perfil_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, coalesce(nullif(c.nome_completo, ''), p.nome, n.nome), c.funcao, c.telefone, c.inicio_em,
         c.desligado_em, c.motivo_desligamento, c.tipo_contrato, c.perfil_id
    from colaborador c
    left join perfil p on p.id = c.perfil_id
    left join negociador n on n.id = c.negociador_id
   where e_rh() and c.franquia_id = minha_franquia()
   order by c.desligado_em nulls first, coalesce(nullif(c.nome_completo, ''), p.nome, n.nome);
$$;

revoke all on function rh_vagas_publicas(text), rh_candidatar(text, text, jsonb), rh_token(text),
  rh_disc_gravar(text, int, int, int, int, text, jsonb), rh_anexar(text, text, text, text, int), rh_equipe() from public;
grant execute on function rh_vagas_publicas(text), rh_candidatar(text, text, jsonb), rh_token(text),
  rh_disc_gravar(text, int, int, int, int, text, jsonb), rh_anexar(text, text, text, text, int) to anon, authenticated;
grant execute on function rh_equipe(), e_rh() to authenticated;

-- O gerente entra no RH sem marcar nada; a marca é para a pessoa do RH que não é gerente.
notify pgrst, 'reload schema';
insert into schema_migrations(arquivo) values ('0174_rh.sql') on conflict do nothing;
