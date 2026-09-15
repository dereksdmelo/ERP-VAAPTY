-- =====================================================================
-- 0048 — Assinatura eletrônica própria
--
-- O Derek trouxe em 15/09/2026 a especificação do assinador que já
-- roda no ERP da Camisetas Já, escrita para ser reproduzida aqui. Ele
-- substitui a ZapSign (decisão 21) por um aceite eletrônico simples,
-- no sentido da Lei 14.063/2020 art. 4º, I, apoiado em três pilares:
--
--   1. ACEITE EXPRESSO   cláusula no contrato + caixa de ciência
--   2. TRILHA            quem, quando, de onde, em quê, o desenho
--   3. INTEGRIDADE       SHA-256 do arquivo, conferível publicamente
--
-- **Os três juntos, ou nenhum.** Cada um sozinho é frágil: trilha sem
-- aceite prova que alguém clicou, não que concordou; aceite sem hash
-- não impede trocar o PDF depois; hash sem trilha prova que o arquivo
-- não mudou, e nada sobre quem assinou.
--
-- ---------------------------------------------------------------------
-- O QUE MUDA EM RELAÇÃO À ESPECIFICAÇÃO, E POR QUÊ
--
-- O documento marca como **[recomendação]** o que o ERP não faz. Três
-- dessas recomendações são correções de fragilidades que ele mesmo
-- admite, e entram aqui desde o início:
--
-- **1. O link tem token aleatório de verdade.** Lá a URL é
-- `?orc=ORC-0123`, sequencial: quem chutar um código não formalizado
-- abre o pedido de outra pessoa e pode assiná-lo. O próprio documento
-- diz "não copie para o Vaapty". Aqui são 32 bytes de aleatório, e o
-- banco guarda **só o SHA-256** — como senha. Vazamento do banco não
-- entrega link nenhum.
--
-- **2. O código de verificação nasce no SERVIDOR.** Lá o navegador
-- escolhe o próprio identificador. Quem escolhe o número do protocolo
-- não pode ser quem é identificado por ele.
--
-- **3. O IP é lido da requisição, nunca informado pelo cliente.**
-- Evidência que a parte interessada digita não é evidência.
--
-- ---------------------------------------------------------------------
-- E A CHAVE DE SERVIÇO NÃO ENTRA AQUI
--
-- O signatário é um cliente sem login: o token dele não abre o banco.
-- A saída óbvia seria a `SUPABASE_SERVICE_KEY`, e ela passaria por
-- cima da RLS de todo o sistema numa rota **pública** — o oposto da
-- decisão 9.
--
-- Em vez disso, as três operações do público passam por funções
-- `security definer` estreitas, que só sabem fazer uma coisa cada e
-- exigem o token do link. Mesmo remédio da `marcar_contrato_assinado()`
-- (0015) e da senha (0032). **Quem trocar isso pela chave de serviço
-- está abrindo a tabela `atendimento` inteira — com CPF e telefone de
-- cliente — para uma rota sem login.**
-- =====================================================================

-- `digest()` e `gen_random_bytes()` vêm do pgcrypto. No Supabase ele
-- vive no esquema `extensions`, que já está no `search_path` das
-- funções abaixo.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- O convite
-- ---------------------------------------------------------------------
create table assinatura_link (
  id uuid primary key default gen_random_uuid(),

  -- O que se assina é um documento já emitido (0003): o HTML dele é o
  -- que o cliente lê e o que vira PDF. Sem isso haveria duas versões
  -- do mesmo contrato — a que foi impressa e a que foi assinada.
  documento_id uuid not null references documento(id) on delete cascade,

  -- **Nunca o token em claro.** Só o SHA-256 dele, como senha.
  token_sha256 text not null unique,

  -- Para quem foi mandado, e por onde. É o "posse do número" que
  -- sustenta o dossiê numa contestação.
  nome_esperado text,
  telefone_envio text,
  canal text not null default 'whatsapp',

  criado_por uuid references perfil(id),
  criado_em  timestamptz not null default now(),
  -- Validade curta: link de contrato que vale para sempre é link que
  -- alguém assina seis meses depois, quando o negócio já mudou.
  expira_em  timestamptz not null default (now() + interval '7 days'),
  usado_em   timestamptz,
  revogado_em timestamptz
);

create index assinatura_link_doc on assinatura_link (documento_id, criado_em desc);

-- ---------------------------------------------------------------------
-- A prova
-- ---------------------------------------------------------------------
create table assinatura (
  -- O protocolo, gerado pelo servidor. É o que se dita ao telefone.
  codigo text primary key,

  documento_id uuid not null references documento(id) on delete restrict,
  link_id      uuid references assinatura_link(id) on delete set null,

  -- **Hora do servidor, em UTC.** A do cliente entra também, à parte:
  -- quando as duas divergem muito, isso por si é informação.
  assinado_em  timestamptz not null default now(),
  hora_cliente text,
  fuso_cliente text,

  -- Quem disse que é.
  nome      text not null,
  documento text not null,              -- só dígitos
  email     text,
  telefone  text,

  -- De onde. O IP vem da requisição, não do corpo.
  ip         text,
  local      text,
  user_agent text,

  -- O texto EXATO da caixa que ele marcou. Sem isto, "ele aceitou" é
  -- uma afirmação sem lastro: ninguém sabe dizer aceitou o quê.
  aceite_texto text not null,

  -- Integridade. Dois hashes, e eles respondem coisas diferentes:
  -- o do PDF prova que o arquivo não mudou; o do HTML canônico prova
  -- que o CONTEÚDO apresentado era aquele, mesmo que o PDF seja
  -- regerado com outra fonte ou outra margem.
  pdf_sha256      char(64) not null,
  conteudo_sha256 char(64) not null,
  pdf_caminho     text,                 -- no bucket
  assinatura_png  text,                 -- o desenho, no bucket

  -- O dossiê inteiro, do jeito que foi montado. Guardar o JSON ao lado
  -- das colunas parece redundante e não é: as colunas servem à
  -- consulta, o JSON serve à prova, e ele não muda se um dia alguém
  -- acrescentar coluna.
  evidencias jsonb not null default '{}'::jsonb,

  criado_em timestamptz not null default now()
);

create index assinatura_doc on assinatura (documento_id, assinado_em desc);

comment on table assinatura is
  'Assinatura eletronica simples. O codigo e o protocolo publico; os dois hashes provam integridade.';

-- ---------------------------------------------------------------------
-- O log de segurança
--
-- Abertura de link, verificação, tentativa com token inválido. O ERP
-- não tem isto, e é o que responde "quantas vezes tentaram" quando
-- alguém contesta.
-- ---------------------------------------------------------------------
create table assinatura_evento (
  id bigserial primary key,
  quando timestamptz not null default now(),
  tipo   text not null,                 -- link_aberto | assinou | token_invalido | verificacao
  link_id uuid,
  codigo  text,
  ip text,
  user_agent text,
  detalhe jsonb not null default '{}'::jsonb
);
create index assinatura_evento_ip on assinatura_evento (ip, quando desc);
create index assinatura_evento_quando on assinatura_evento (quando desc);

-- ---------------------------------------------------------------------
-- RLS: a equipe vê, ninguém escreve direto
--
-- As três tabelas são registro, não rascunho. Quem grava são as
-- funções abaixo — inclusive para a equipe, porque assinatura editável
-- depois de gravada não prova nada.
-- ---------------------------------------------------------------------
alter table assinatura_link enable row level security;
alter table assinatura enable row level security;
alter table assinatura_evento enable row level security;

create policy assinatura_link_le on assinatura_link
  for select to authenticated using (e_equipe());
-- Criar o convite é da equipe; o token em claro nunca passa por aqui
-- (a função abaixo é que o gera e o devolve uma única vez).
create policy assinatura_link_revoga on assinatura_link
  for update to authenticated using (e_equipe()) with check (e_equipe());

create policy assinatura_le on assinatura
  for select to authenticated using (e_equipe());

-- O log é só de leitura, e só do gerente: ele tem IP de cliente.
create policy assinatura_evento_le on assinatura_evento
  for select to authenticated using (e_gerente());

-- ---------------------------------------------------------------------
-- 1. Criar o convite (equipe)
--
-- Devolve o token EM CLARO uma única vez — é a única chance de
-- copiá-lo. O banco guarda só o hash, então nem o gerente consegue
-- recuperar um link perdido: gera outro.
-- ---------------------------------------------------------------------
create or replace function criar_link_assinatura(
  p_documento uuid,
  p_nome      text default null,
  p_telefone  text default null,
  p_dias      int  default 7
) returns table (id uuid, token text, expira_em timestamptz) as $$
declare
  t text;
  novo assinatura_link%rowtype;
begin
  if not e_equipe() then
    raise exception 'Sem permissão.';
  end if;
  -- 32 bytes de aleatório do próprio Postgres, em hex.
  t := encode(gen_random_bytes(32), 'hex');

  insert into assinatura_link (documento_id, token_sha256, nome_esperado, telefone_envio,
                               criado_por, expira_em)
  values (p_documento, encode(digest(t, 'sha256'), 'hex'), nullif(btrim(coalesce(p_nome, '')), ''),
          nullif(btrim(coalesce(p_telefone, '')), ''), auth.uid(),
          now() + make_interval(days => greatest(1, least(60, coalesce(p_dias, 7)))))
  returning * into novo;

  return query select novo.id, t, novo.expira_em;
end;
$$ language plpgsql volatile security definer set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------
-- 2. Abrir o link (público, sem login)
--
-- Recebe o token em claro, confere o hash, e devolve o documento para
-- ler e assinar. **Não devolve nada que não esteja no papel**: nem o
-- id do atendimento, nem o do veículo, nem qualquer outra coisa da
-- tabela. Uma rota pública que devolve linha inteira é como CPF de
-- cliente vaza.
-- ---------------------------------------------------------------------
create or replace function abrir_link_assinatura(p_token text)
returns table (
  link_id uuid, documento_id uuid, tipo text, conteudo text,
  nome_esperado text, expira_em timestamptz, situacao text, codigo_existente text
) as $$
declare
  l assinatura_link%rowtype;
  a assinatura%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    return;
  end if;
  select * into l from assinatura_link
   where token_sha256 = encode(digest(p_token, 'sha256'), 'hex');
  if not found then
    return;
  end if;

  -- **Qualificar a coluna é obrigatório aqui.** `link_id` também é o
  -- nome de uma coluna de saída da função, e sem o prefixo o Postgres
  -- recusa: "column reference link_id is ambiguous". O primeiro teste
  -- de ponta a ponta pegou isso.
  select * into a from assinatura
   where assinatura.link_id = l.id
   order by assinatura.assinado_em desc limit 1;

  return query
  select l.id, l.documento_id,
         d.tipo::text,
         -- Documento já assinado ou link morto não devolve o conteúdo:
         -- quem tem o link não precisa mais lê-lo, e quem o achou
         -- depois não deve.
         case when a.codigo is not null or l.revogado_em is not null or l.expira_em < now()
              then null else d.conteudo end,
         l.nome_esperado, l.expira_em,
         case when a.codigo is not null then 'assinado'
              when l.revogado_em is not null then 'revogado'
              when l.expira_em < now() then 'expirado'
              else 'aberto' end,
         a.codigo
    from documento d
   where d.id = l.documento_id;
end;
$$ language plpgsql volatile security definer set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------
-- 3. Gravar a assinatura (público, com o token)
--
-- O código nasce AQUI, no servidor. Na especificação ele é sorteado
-- pelo navegador; quem é identificado por um número não pode ser quem
-- o escolhe.
--
-- O alfabeto é o mesmo da senha provisória (0032) — sem O/0 e sem
-- I/1/l —, porque este código é ditado ao telefone.
--
-- **Uso único, garantido pela transação.** O `update ... where
-- usado_em is null` só pega a linha uma vez; dois toques no botão, ou
-- dois aparelhos, produzem uma assinatura só.
-- ---------------------------------------------------------------------
create or replace function gravar_assinatura(
  p_token      text,
  p_nome       text,
  p_documento  text,
  p_email      text,
  p_telefone   text,
  p_aceite     text,
  p_pdf_sha    text,
  p_conteudo_sha text,
  p_pdf_caminho  text,
  p_png_caminho  text,
  p_ip         text,
  p_local      text,
  p_user_agent text,
  p_hora_cliente text,
  p_fuso_cliente text,
  p_evidencias jsonb default '{}'::jsonb
) returns table (codigo text, assinado_em timestamptz) as $$
declare
  l assinatura_link%rowtype;
  cod text;
  alfabeto text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
  nova assinatura%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Link inválido.';
  end if;
  if coalesce(btrim(p_nome), '') = '' or coalesce(btrim(p_documento), '') = '' then
    raise exception 'Informe nome e documento.';
  end if;
  if coalesce(btrim(p_aceite), '') = '' then
    raise exception 'Falta o aceite.';
  end if;
  if p_pdf_sha !~ '^[0-9a-f]{64}$' or p_conteudo_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash inválido.';
  end if;

  -- Pega o link e o marca como usado na mesma instrução: é isso que
  -- torna o uso único à prova de dois cliques.
  update assinatura_link
     set usado_em = now()
   where token_sha256 = encode(digest(p_token, 'sha256'), 'hex')
     and usado_em is null
     and revogado_em is null
     and expira_em > now()
  returning * into l;

  if not found then
    raise exception 'Este link não está mais válido.';
  end if;

  cod := 'VPT-';
  for i in 1..8 loop
    cod := cod || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
  end loop;

  insert into assinatura (
    codigo, documento_id, link_id, nome, documento, email, telefone,
    ip, local, user_agent, hora_cliente, fuso_cliente, aceite_texto,
    pdf_sha256, conteudo_sha256, pdf_caminho, assinatura_png, evidencias
  ) values (
    cod, l.documento_id, l.id, btrim(p_nome), regexp_replace(coalesce(p_documento, ''), '\D', '', 'g'),
    nullif(btrim(coalesce(p_email, '')), ''), nullif(btrim(coalesce(p_telefone, '')), ''),
    p_ip, p_local, left(coalesce(p_user_agent, ''), 400), p_hora_cliente, p_fuso_cliente,
    p_aceite, lower(p_pdf_sha), lower(p_conteudo_sha), p_pdf_caminho, p_png_caminho,
    coalesce(p_evidencias, '{}'::jsonb)
  ) returning * into nova;

  insert into assinatura_evento (tipo, link_id, codigo, ip, user_agent)
  values ('assinou', l.id, cod, p_ip, left(coalesce(p_user_agent, ''), 400));

  return query select nova.codigo, nova.assinado_em;
end;
$$ language plpgsql volatile security definer set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------
-- 4. Verificar (público, sem login nem token)
--
-- É a prova que o cliente mostra a terceiros, então ela é aberta. Mas
-- **aberta não é devassa**: quem tem só o código vê o documento
-- MASCARADO e não vê o IP nem o PDF. O documento inteiro e a trilha
-- completa ficam para quem prova posse — e isso é a recomendação 8.2.7
-- da especificação, que o ERP não segue: lá o código sozinho abre o
-- PDF inteiro e o IP completo.
-- ---------------------------------------------------------------------
create or replace function verificar_assinatura(p_codigo text)
returns table (
  codigo text, assinado_em timestamptz, nome text, documento_mascarado text,
  tipo text, pdf_sha256 text, conteudo_sha256 text, local text, dispositivo text
) as $$
  select a.codigo, a.assinado_em, a.nome,
         -- Três primeiros e dois últimos dígitos. O bastante para a
         -- pessoa se reconhecer, pouco para alguém montar um cadastro.
         case when length(a.documento) >= 5
              then left(a.documento, 3) || repeat('*', length(a.documento) - 5) || right(a.documento, 2)
              else repeat('*', length(a.documento)) end,
         d.tipo::text, a.pdf_sha256, a.conteudo_sha256, a.local,
         left(coalesce(a.user_agent, ''), 90)
    from assinatura a
    join documento d on d.id = a.documento_id
   where a.codigo = upper(btrim(p_codigo));
$$ language sql stable security definer set search_path = public, pg_temp;

-- ---------------------------------------------------------------------
-- Quem pode chamar o quê
--
-- As três públicas vão para `anon` porque o signatário não tem login —
-- as chamadas passam pela nossa função em `api/`, que fala com o
-- PostgREST usando a chave anônima. `criar_link_assinatura` fica fora:
-- criar convite é da equipe.
-- ---------------------------------------------------------------------
revoke all on function criar_link_assinatura(uuid, text, text, int) from public;
grant execute on function criar_link_assinatura(uuid, text, text, int) to authenticated;

revoke all on function abrir_link_assinatura(text) from public;
grant execute on function abrir_link_assinatura(text) to anon, authenticated;

revoke all on function gravar_assinatura(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb) from public;
grant execute on function gravar_assinatura(text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, jsonb) to anon, authenticated;

revoke all on function verificar_assinatura(text) from public;
grant execute on function verificar_assinatura(text) to anon, authenticated;
