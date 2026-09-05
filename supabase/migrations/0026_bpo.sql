-- =====================================================================
-- 0026 — O que um BPO exige e a planilha nunca deu
--
-- Quatro coisas que fazem alguém preferir o Conta Azul, e que dá para
-- ter aqui melhor do que lá:
--
--   fin_favorecido   quem recebe, com CNPJ. O extrato do Itaú JÁ traz
--                    o documento na descrição — "BARBOSA CONSULTORIA
--                    LTDA 62.762.461/0001-59" — então o cadastro se
--                    monta sozinho, sem ninguém digitar.
--   série            parcelamento e conta fixa: um título vira doze,
--                    amarrados por `grupo_id`.
--   fin_log          quem mudou o quê. BPO responde por número, e
--                    número sem histórico não se defende.
--   fin_anexo        o boleto e a nota presos ao lançamento.
-- =====================================================================

create table fin_favorecido (
  id uuid primary key default gen_random_uuid(),
  nome      text not null,
  -- Só dígitos: o extrato escreve com ponto e barra, o cadastro do
  -- contador escreve sem, e os dois são a mesma empresa.
  documento text,
  tipo      text not null default 'fornecedor',   -- fornecedor | cliente | funcionario | socio
  observacao text,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index fin_favorecido_doc on fin_favorecido (documento) where documento is not null;
create unique index fin_favorecido_nome on fin_favorecido (lower(nome));

alter table fin_lancamento
  add column if not exists favorecido_id uuid references fin_favorecido(id),
  -- A série: 12 parcelas, ou o aluguel dos próximos 12 meses.
  add column if not exists grupo_id uuid,
  add column if not exists parcela  int,
  add column if not exists parcelas int;

create index if not exists fin_lanc_grupo_idx on fin_lancamento (grupo_id) where grupo_id is not null;
create index if not exists fin_lanc_favorecido_idx on fin_lancamento (favorecido_id) where favorecido_id is not null;

-- ---------------------------------------------------------------------
-- Histórico. Só dos campos que mudam um número ou um mês — anotar
-- toda mudança de descrição encheria a tabela e escondia o que importa.
-- ---------------------------------------------------------------------
create table fin_log (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid references fin_lancamento(id) on delete cascade,
  quem   uuid,
  quando timestamptz not null default now(),
  campo  text not null,
  de     text,
  para   text
);
create index fin_log_lanc_idx on fin_log (lancamento_id, quando desc);

create or replace function fin_anota_mudanca()
returns trigger as $$
declare
  campos text[] := array['debito','credito','competencia','categoria_id','situacao','conta_id','data','vencimento'];
  c text;
  antes text;
  depois text;
begin
  foreach c in array campos loop
    execute format('select ($1).%I::text, ($2).%I::text', c, c) into antes, depois using old, new;
    if antes is distinct from depois then
      insert into fin_log (lancamento_id, quem, campo, de, para)
      values (new.id, auth.uid(), c, antes, depois);
    end if;
  end loop;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists fin_lancamento_log on fin_lancamento;
create trigger fin_lancamento_log
  after update on fin_lancamento
  for each row execute function fin_anota_mudanca();

-- ---------------------------------------------------------------------
-- O boleto e a nota. Bucket próprio: documento fiscal não se mistura
-- com foto de carro, e o prazo de guarda é outro.
-- ---------------------------------------------------------------------
create table fin_anexo (
  id uuid primary key default gen_random_uuid(),
  lancamento_id uuid not null references fin_lancamento(id) on delete cascade,
  caminho text not null,
  nome    text,
  tipo    text,
  bytes   int,
  rotulo  text,                       -- boleto, nota fiscal, comprovante
  enviado_por uuid references perfil(id),
  criado_em timestamptz not null default now()
);
create index fin_anexo_lanc_idx on fin_anexo (lancamento_id, criado_em desc);

alter table fin_favorecido enable row level security;
alter table fin_log        enable row level security;
alter table fin_anexo      enable row level security;

create policy fin_favorecido_acesso on fin_favorecido for all to authenticated using (e_financeiro()) with check (e_financeiro());
create policy fin_anexo_acesso      on fin_anexo      for all to authenticated using (e_financeiro()) with check (e_financeiro());
-- O log é só de leitura: quem escreve é o gatilho, que roda como dono.
create policy fin_log_leitura on fin_log for select to authenticated using (e_financeiro());
