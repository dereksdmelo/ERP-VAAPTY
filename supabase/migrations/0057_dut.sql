-- O DUT: O LOJISTA PEDE, O ADMINISTRATIVO ACOMPANHA (03/10/2026)
--
-- A Vaapty preenche o DUT/ATPV do carro que o lojista comprou e manda
-- reconhecer firma em cartório. Isso vivia num formulário do Google
-- com 1.278 respostas, e o acompanhamento eram DOIS comentários de
-- célula em 1.278 linhas -- na prática, não existia. Ninguém sabia
-- responder "o meu já saiu?" sem abrir a planilha e procurar.
--
-- São DOIS PEDIDOS DIFERENTES no mesmo formulário, e é por isso que
-- `tipo` existe: ou o lojista manda os dados e a Vaapty PREENCHE o
-- documento, ou ele manda a ATPV já preenchida e só quer o
-- RECONHECIMENTO. O segundo pula a etapa de preenchimento inteira, e
-- tratar os dois como um só faria metade da fila parecer atrasada.

create type dut_tipo      as enum ('preencher', 'reconhecer');
create type dut_situacao  as enum ('recebido', 'pendente', 'preenchido', 'reconhecido', 'entregue', 'cancelado');
create type dut_entrega   as enum ('retirada', 'envio');

create table dut_pedido (
  id uuid primary key default gen_random_uuid(),

  -- **O PROTOCOLO É O QUE O LOJISTA DITA NO WHATSAPP.** Um hash de
  -- timestamp não se dita; "DUT-2026-0184" sim. Sequencial por ano,
  -- como o recibo da 0042, e único -- é o índice que impede duas vias
  -- com o mesmo número quando dois pedidos chegam no mesmo segundo.
  protocolo text not null,
  ano       int  not null,

  tipo      dut_tipo     not null default 'preencher',
  situacao  dut_situacao not null default 'recebido',

  -- O carro e o comprador, como o formulário pede.
  placa     text not null,
  veiculo   text,
  comprador_nome     text,
  comprador_doc      text,
  comprador_rg       text,
  comprador_endereco text,
  valor_venda numeric(12,2),
  km          int,
  data_venda  date,

  -- Para onde vai o documento reconhecido. Vazio = retira na loja, que
  -- é como o formulário já dizia.
  entrega        dut_entrega not null default 'retirada',
  endereco_envio text,
  rastreio       text,

  -- Quem pediu. O lojista não tem login, então é texto -- e o WhatsApp
  -- é o que permite responder sem procurar o cadastro.
  lojista_nome  text,
  lojista_whats text,

  -- O caminho, carimbado pelo servidor a partir do token de quem
  -- marcou (nunca escolhido pela tela): é quem responde "conferido por
  -- quem" quando algo dá errado, a mesma lição da 0008.
  preenchido_em  timestamptz, preenchido_por  uuid references perfil(id),
  reconhecido_em timestamptz, reconhecido_por uuid references perfil(id),
  entregue_em    timestamptz, entregue_por    uuid references perfil(id),

  -- O que falta, quando a situação é `pendente`. Sem este campo,
  -- "pendente" não diz o que cobrar do lojista.
  pendencia   text,
  observacoes text,

  -- **O TOKEN É GUARDADO EM HASH, como senha.** Ele serve para a
  -- página pública anexar os arquivos logo depois de criar o pedido;
  -- vazamento do banco não entrega nenhum, e token perdido não se
  -- recupera -- cria-se outro pedido. Mesma regra da 0048.
  token_hash text,
  token_ate  timestamptz,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (ano, protocolo)
);
create index dut_pedido_fila  on dut_pedido (situacao, criado_em desc);
create index dut_pedido_placa on dut_pedido (placa);

create table dut_anexo (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references dut_pedido(id) on delete cascade,
  caminho text not null,
  nome    text,
  tipo    text,
  bytes   int,
  -- CNH, Comprovante de residência, ATPV preenchida, DUT reconhecido…
  rotulo  text,
  criado_em timestamptz not null default now()
);
create index dut_anexo_pedido on dut_anexo (pedido_id);

alter table dut_pedido enable row level security;
alter table dut_anexo  enable row level security;

-- Ler é da equipe: o negociador também recebe "cadê o DUT?" na mesa.
-- Escrever é do administrativo (ou do gerente), que é quem preenche e
-- leva ao cartório -- `e_adm()` cobre os dois (0012).
create policy dut_le    on dut_pedido for select using (e_equipe());
create policy dut_gere  on dut_pedido for all    using (e_adm()) with check (e_adm());
create policy duta_le   on dut_anexo  for select using (e_equipe());
create policy duta_gere on dut_anexo  for all    using (e_adm()) with check (e_adm());

/* O PEDIDO DO LOJISTA, QUE CHEGA SEM LOGIN.
 *
 * O lojista não tem conta aqui e nunca vai ter -- são dezenas de lojas
 * da rede. O caminho óbvio seria a `SUPABASE_SERVICE_KEY` numa rota
 * pública, o que abriria o banco inteiro a quem descobrisse a URL.
 * Em vez disso, esta função estreita: ela só sabe criar pedido, e é a
 * mesma forma do assinador público (0048) e da ponte (0055).
 *
 * **Quem trocar isto pela chave de serviço está desfazendo a decisão
 * 9.**
 */
create or replace function dut_criar(
  p_token_hash text,
  p_tipo       text,
  p_placa      text,
  p_veiculo    text,
  p_nome       text,
  p_doc        text,
  p_rg         text,
  p_endereco   text,
  p_valor      numeric,
  p_km         int,
  p_data       date,
  p_entrega    text,
  p_envio      text,
  p_lojista    text,
  p_whats      text
) returns table (id uuid, protocolo text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ano int := extract(year from (now() at time zone 'America/Sao_Paulo'));
  v_num int;
  v_prot text;
  v_id uuid;
  v_tentativas int := 0;
begin
  if coalesce(p_placa, '') = '' then
    raise exception 'informe a placa' using errcode = 'P0001';
  end if;

  loop
    v_tentativas := v_tentativas + 1;
    -- `max + 1` na aplicação daria dois pedidos com o mesmo número se
    -- dois lojistas enviassem no mesmo segundo; o unique derruba o
    -- segundo e o laço tenta de novo. Sequência do Postgres não serve
    -- porque o número zera a cada ano (mesma razão da 0042).
    select coalesce(max(substring(d.protocolo from '\d+$')::int), 0) + 1
      into v_num from dut_pedido d where d.ano = v_ano;
    v_prot := 'DUT-' || v_ano || '-' || lpad(v_num::text, 4, '0');
    begin
      insert into dut_pedido (protocolo, ano, tipo, placa, veiculo,
        comprador_nome, comprador_doc, comprador_rg, comprador_endereco,
        valor_venda, km, data_venda, entrega, endereco_envio,
        lojista_nome, lojista_whats, token_hash, token_ate)
      values (v_prot, v_ano,
        coalesce(nullif(p_tipo, '')::dut_tipo, 'preencher'),
        upper(regexp_replace(p_placa, '[^A-Za-z0-9]', '', 'g')), nullif(p_veiculo, ''),
        nullif(p_nome, ''), nullif(p_doc, ''), nullif(p_rg, ''), nullif(p_endereco, ''),
        p_valor, p_km, p_data,
        coalesce(nullif(p_entrega, '')::dut_entrega, 'retirada'), nullif(p_envio, ''),
        nullif(p_lojista, ''), nullif(p_whats, ''),
        nullif(p_token_hash, ''), now() + interval '2 hours')
      returning dut_pedido.id into v_id;
      exit;
    exception when unique_violation then
      if v_tentativas >= 5 then raise; end if;
    end;
  end loop;

  return query select v_id, v_prot;
end;
$$;

/* O ANEXO DO LOJISTA, também sem login.
 *
 * O arquivo já subiu ao Storage pelo `api/foto.js` -- que é o único
 * lugar com a chave de serviço (decisão 9). Esta função só grava a
 * linha, e só para quem apresentar o token daquele pedido, dentro da
 * janela. **A janela é curta de propósito**: o token serve para o
 * envio terminar, não para voltar depois.
 */
create or replace function dut_anexar(
  p_id uuid, p_token_hash text,
  p_caminho text, p_nome text, p_tipo text, p_bytes int, p_rotulo text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_ok boolean;
begin
  select true into v_ok from dut_pedido
   where id = p_id and token_hash is not null
     and token_hash = p_token_hash and token_ate > now();
  if not coalesce(v_ok, false) then return false; end if;

  insert into dut_anexo (pedido_id, caminho, nome, tipo, bytes, rotulo)
  values (p_id, p_caminho, nullif(p_nome, ''), nullif(p_tipo, ''), p_bytes, nullif(p_rotulo, ''));
  return true;
end;
$$;

/* "CADÊ O MEU?" -- a consulta pública pelo protocolo.
 *
 * Devolve o MÍNIMO: o estado e as datas. Nome, CPF, endereço e os
 * arquivos ficam fora -- quem tem um protocolo não pode ler o cadastro
 * do comprador de outra pessoa. Mesma régua da verificação pública da
 * assinatura (decisão 42), onde o código sozinho mostra o documento
 * mascarado.
 */
create or replace function dut_estado(p_protocolo text)
returns table (protocolo text, placa text, tipo text, situacao text,
               pendencia text, criado_em timestamptz,
               preenchido_em timestamptz, reconhecido_em timestamptz,
               entregue_em timestamptz, entrega text, rastreio text)
language sql
security definer
set search_path = public
as $$
  select p.protocolo, p.placa, p.tipo::text, p.situacao::text,
         p.pendencia, p.criado_em, p.preenchido_em, p.reconhecido_em,
         p.entregue_em, p.entrega::text, p.rastreio
    from dut_pedido p
   where upper(p.protocolo) = upper(trim(p_protocolo))
   limit 1;
$$;

revoke all on function dut_criar(text,text,text,text,text,text,text,text,numeric,int,date,text,text,text,text) from public;
revoke all on function dut_anexar(uuid,text,text,text,text,int,text) from public;
revoke all on function dut_estado(text) from public;
grant execute on function dut_criar(text,text,text,text,text,text,text,text,numeric,int,date,text,text,text,text) to anon, authenticated;
grant execute on function dut_anexar(uuid,text,text,text,text,int,text) to anon, authenticated;
grant execute on function dut_estado(text) to anon, authenticated;
