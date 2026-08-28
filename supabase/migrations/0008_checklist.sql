-- =====================================================================
-- 0008 — check list digital e anexos do negócio
--
-- O check list era papel: o negociador preenchia, o cliente escrevia os
-- dados bancários e o administrativo conferia depois, tudo na mesma
-- folha. Agora é registro, com duas mãos e carimbo de quem conferiu.
--
-- Uma linha por atendimento — daí o unique. Check list é o resumo do
-- negócio, não um evento que se repete como o documento impresso.
--
-- ATENÇÃO — dado bancário entra aqui. Conta e chave PIX de cliente são
-- dado pessoal sensível ao ponto de fraude: quem tiver acesso consegue
-- desviar pagamento. A RLS abaixo é o que separa isso de um vazamento,
-- e a conversa com o jurídico sobre retenção continua pendente.
-- =====================================================================

create table checklist (
  id             uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null unique references atendimento(id) on delete cascade,

  /* ---- o negociador confere na entrega ---- */
  recibo_compra_venda    boolean not null default false,
  segunda_via_dut        boolean not null default false,
  licenciamento_atual    boolean not null default false,
  transferencia          boolean not null default false,
  emplacamento_mercosul  boolean not null default false,
  outros_itens           boolean not null default false,
  comprovante_residencia boolean not null default false,
  copia_cnh_titular      boolean not null default false,
  manual_chave_copia     boolean not null default false,

  /* ---- a conta do negócio ---- */
  valor_venda     numeric(12,2),
  valor_cautelar  numeric(12,2),
  valor_debitos   numeric(12,2),
  valor_quitacao  numeric(12,2),
  comissao_vaapty numeric(12,2),
  valor_cliente   numeric(12,2),   -- o líquido que sai para o cliente

  /* ---- para onde o dinheiro vai ---- */
  banco_favorecido text,
  banco_documento  text,           -- CPF ou CNPJ do favorecido
  banco_nome       text,
  banco_agencia    text,
  banco_conta      text,
  banco_tipo       text,           -- corrente ou poupança
  banco_pix        text,

  /* ---- o administrativo confere depois ---- */
  adm_entrada        boolean not null default false,
  adm_saida          boolean not null default false,
  adm_debitos        boolean not null default false,
  adm_quitacao       boolean not null default false,
  adm_outros         boolean not null default false,
  adm_laudo_cautelar boolean not null default false,
  -- Quem conferiu e quando. Sem isso, "conferido" não responde a
  -- pergunta que importa quando algo dá errado: conferido por quem.
  adm_conferido_por  uuid references perfil(id),
  adm_conferido_em   timestamptz,

  observacoes text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index checklist_atendimento_idx on checklist (atendimento_id);

create trigger checklist_atualizado
  before update on checklist
  for each row execute function toca_atualizado_em();

/* ---------------------------------------------------------------------
 * Anexos: os documentos digitalizados depois do fechamento
 *
 * Bucket separado do de fotos porque o conteúdo é outro: aqui entram
 * CRLV, comprovante de residência, CNH, laudo cautelar, comprovante de
 * pagamento. Aceita PDF, que o bucket de fotos não aceita.
 * ------------------------------------------------------------------ */

create table anexo (
  id             uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references atendimento(id) on delete cascade,

  caminho text not null,          -- dentro do bucket
  nome    text,                   -- como o arquivo se chamava
  tipo    text,                   -- content-type
  bytes   int,
  rotulo  text,                   -- o que é: CRLV, laudo, comprovante…

  enviado_por uuid references perfil(id),
  criado_em   timestamptz not null default now()
);

create index anexo_atendimento_idx on anexo (atendimento_id, criado_em desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos-veiculo',
  'documentos-veiculo',
  false,
  10485760,                        -- 10 MB: laudo cautelar escaneado passa de 5
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

/* ---------------------------------------------------------------------
 * Segurança
 *
 * Mesma regra do resto: equipe com perfil ativo lê e escreve. O que
 * separa o administrativo do negociador é a tela, não a política — a
 * casa é pequena e todo mundo já vê o mesmo CRM.
 *
 * Se um dia o dado bancário precisar ficar só com o financeiro, é aqui
 * que muda: um `using (papel_atual() in ('gerente','prep'))` na
 * checklist resolve, mas quebra o preenchimento pelo negociador.
 * ------------------------------------------------------------------ */

alter table checklist enable row level security;
alter table anexo     enable row level security;

create policy checklist_equipe on checklist
  for all to authenticated using (e_equipe()) with check (e_equipe());

create policy anexo_equipe on anexo
  for all to authenticated using (e_equipe()) with check (e_equipe());
