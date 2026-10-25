-- =====================================================================
-- 0079 — A ficha do colaborador: documento, contrato, entrada e saída
--
-- O Derek, em 24/10/2026, na tela de Equipe: *"quando clicasse na
-- pessoa da equipe tivesse a opção de colocar os dados da pessoa
-- completos do documento, anexar documentos, anexar contrato de
-- prestação de serviços, marcar data do início do trabalho e data em
-- que foi desligado — isso vai ajudar a ligar com a parte de pagamento
-- de equipe no financeiro"*.
--
-- **Uma ficha por PESSOA, não por cadastro.** A mesma pessoa já existe
-- em até três lugares: o login (`perfil`, 0004), a meta (`negociador`,
-- 0010) e a folha (`fin_funcionario`, 0021). Esta tabela não repete
-- nenhum deles: guarda o que é da pessoa e aponta para os três. Os dois
-- primeiros são únicos — uma ficha por login, uma por meta.
--
-- **Dado sensível, porta estreita.** CPF, RG, endereço e conta bancária
-- de funcionário são dado que, vazado, vira fraude. Ler e escrever é só
-- de quem é do financeiro ou gerente (`e_financeiro()`, 0021) — o
-- negociador não lê nem a própria ficha por aqui.
--
-- O arquivo do documento mora no bucket privado `documentos-veiculo`
-- (0008), na pasta `equipe/`, e passa pelo `api/foto.js` como todo
-- arquivo da casa (decisão 9): bucket novo seria política nova e mais
-- um lugar para o papel se perder (decisão 23).
-- =====================================================================

create table if not exists colaborador (
  id                  uuid primary key default gen_random_uuid(),
  perfil_id           uuid unique references perfil(id) on delete set null,
  negociador_id       uuid unique references negociador(id) on delete set null,
  fin_funcionario_id  uuid references fin_funcionario(id) on delete set null,

  nome_completo  text,
  cpf            text,
  rg             text,
  nascimento     date,
  telefone       text,
  email          text,
  endereco       text,
  cidade         text,
  uf             text,
  cep            text,

  pix            text,
  banco          text,
  agencia        text,
  conta          text,

  funcao               text,
  tipo_contrato        text check (tipo_contrato is null or tipo_contrato in ('pj', 'clt', 'estagio', 'autonomo', 'outro')),
  inicio_em            date,
  desligado_em         date,
  motivo_desligamento  text,
  observacoes          text,

  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references perfil(id)
);

create table if not exists colaborador_anexo (
  id             uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  caminho        text not null,
  nome           text,
  tipo           text,
  bytes          int,
  rotulo         text,
  enviado_por    uuid references perfil(id),
  criado_em      timestamptz not null default now()
);
create index if not exists colaborador_anexo_idx on colaborador_anexo (colaborador_id, criado_em desc);

alter table colaborador enable row level security;
alter table colaborador_anexo enable row level security;

drop policy if exists colaborador_financeiro on colaborador;
create policy colaborador_financeiro on colaborador for all using (e_financeiro()) with check (e_financeiro());
drop policy if exists colaborador_anexo_financeiro on colaborador_anexo;
create policy colaborador_anexo_financeiro on colaborador_anexo for all using (e_financeiro()) with check (e_financeiro());
