-- A CAIXA DE ENTRADA DO WHATSAPP (01/10/2026)
--
-- O Derek vai ligar TRÊS números por QR code: o principal da loja e os
-- dois que as IAs atendem. A primeira entrega não é ferramenta, é
-- COLETA -- entender como o funil funciona de verdade antes de
-- construir em cima de suposição.
--
-- A ponte é a mesma da Camisetas Já (Baileys num container do
-- Cloudflare, sessão guardada no Durable Object). Ela é genérica: fala
-- com um `ERP_URL` qualquer por quatro rotas, e não sabe nada sobre
-- camiseta nem sobre carro.
--
-- **A `mensagem` da 0033 NÃO serve e não deve ser reaproveitada**: ela
-- é o chat interno entre gerente e negociador, com `de` apontando para
-- `perfil`. Aqui quem fala é gente de fora, que não tem login.

create table wa_canal (
  id          uuid primary key default gen_random_uuid(),
  -- O apelido que vira o nome do container na ponte. Sem espaço nem
  -- acento porque viaja na URL (`?canal=`).
  slug        text not null unique check (slug ~ '^[a-z0-9_-]{2,40}$'),
  nome        text not null,
  -- Preenchido quando o QR é lido; antes disso não se sabe o número.
  telefone    text,
  -- Quem atende: a loja ou uma das IAs. É o que vai permitir ler o
  -- funil separando o que a IA fez do que a pessoa fez -- a pergunta
  -- central do plano do Diego.
  atendente   text not null default 'humano' check (atendente in ('humano','ia')),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

-- Uma conversa por (canal, telefone do cliente). O mesmo cliente
-- falando com dois números são DUAS conversas, de propósito: a janela
-- de 24 h é por número, e juntar esconderia que ele procurou dois.
create table wa_conversa (
  id              uuid primary key default gen_random_uuid(),
  canal_id        uuid not null references wa_canal(id) on delete cascade,
  telefone        text not null,
  nome            text,
  -- Liga ao CRM quando houver. Fica NULO no começo: a conversa existe
  -- antes de alguém virar atendimento, e é justamente esse pedaço que
  -- hoje não é registrado em lugar nenhum.
  atendimento_id  uuid references atendimento(id) on delete set null,
  lead_id         uuid references lead(id) on delete set null,
  -- De qual anúncio veio, quando a primeira mensagem traz o
  -- `externalAdReply` (clique-para-WhatsApp). É o que vai permitir
  -- casar marketing com venda sem ninguém digitar origem.
  anuncio         jsonb,
  primeira_em     timestamptz not null default now(),
  ultima_em       timestamptz not null default now(),
  -- Recalculado a cada mensagem: serve para a fila "quem está
  -- esperando resposta agora", que é a tela de todo dia.
  ultima_de_fora  timestamptz,
  respondida_em   timestamptz,
  criado_em       timestamptz not null default now(),
  unique (canal_id, telefone)
);

create table wa_mensagem (
  id           uuid primary key default gen_random_uuid(),
  conversa_id  uuid not null references wa_conversa(id) on delete cascade,
  -- O id do WhatsApp. Único por conversa porque a ponte reentrega a
  -- mesma mensagem quando o container reinicia -- sem isto, cada
  -- religada duplicaria a conversa inteira.
  wa_id        text not null,
  -- true = saiu daqui (a loja ou a IA). false = o cliente mandou.
  eco          boolean not null default false,
  tipo         text not null check (tipo in ('texto','midia','botao','reacao')),
  texto        text,
  -- Mídia e botão viajam inteiros: o formato vem da ponte e pode
  -- crescer sem migration nova.
  anexo        jsonb,
  -- entregue / lida, que a ponte manda por outra rota.
  estado       text,
  quando       timestamptz not null,
  criado_em    timestamptz not null default now(),
  unique (conversa_id, wa_id)
);

create index wa_conversa_fila on wa_conversa (ultima_em desc);
create index wa_conversa_tel  on wa_conversa (telefone);
create index wa_mensagem_conv on wa_mensagem (conversa_id, quando);

alter table wa_canal     enable row level security;
alter table wa_conversa  enable row level security;
alter table wa_mensagem  enable row level security;

-- **CONVERSA DE CLIENTE É DADO PESSOAL, e a RLS nasce junto com a
-- tabela** -- não depois, quando já houver nove meses de conversa
-- dentro. Lê quem é da equipe; escreve quem é da equipe. O servidor
-- entra com a chave de serviço só pela ponte, que é porta fechada por
-- segredo compartilhado.
create policy wa_canal_le     on wa_canal    for select using (e_equipe());
create policy wa_canal_gere   on wa_canal    for all    using (e_gerente()) with check (e_gerente());
create policy wa_conversa_le  on wa_conversa for select using (e_equipe());
create policy wa_conversa_esc on wa_conversa for all    using (e_equipe()) with check (e_equipe());
create policy wa_mensagem_le  on wa_mensagem for select using (e_equipe());
create policy wa_mensagem_esc on wa_mensagem for all    using (e_equipe()) with check (e_equipe());
