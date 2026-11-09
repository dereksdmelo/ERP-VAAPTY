-- 0138 · Nota fiscal de serviço, direto na API nacional (09/11/2026, o Derek: "não dá pra criar a
-- nossa própria PlugNotas?… nota fiscal de serviço de intermediação de venda… pode começar a testar
-- pelo ambiente de testes"). Joinville emite só pelo Emissor Nacional desde 20/07/2026, e todo
-- município aderiu ao padrão nacional: uma API só serve a qualquer unidade.
--
-- O CERTIFICADO NÃO MORA AQUI. A chave privada e o certificado A1 são segredos do Worker (e o mTLS é
-- um binding da Cloudflare): nada disso passa pelo banco nem pelo navegador.

-- A configuração fiscal da unidade, no cadastro da empresa (0137).
alter table empresa add column if not exists ibge_municipio text default '4209102';      -- Joinville
alter table empresa add column if not exists opcao_simples text;        -- 1 não optante · 2 MEI · 3 ME/EPP
alter table empresa add column if not exists regime_especial text default '0';
alter table empresa add column if not exists nfse_ambiente text not null default 'restrita' check (nfse_ambiente in ('restrita', 'producao'));
-- Série e numeração POR AMBIENTE: o teste não gasta número da produção.
alter table empresa add column if not exists nfse_serie_restrita text not null default '900';
alter table empresa add column if not exists nfse_proximo_restrita bigint not null default 1;
alter table empresa add column if not exists nfse_serie_producao text not null default '1';
alter table empresa add column if not exists nfse_proximo_producao bigint not null default 1;
alter table empresa add column if not exists servico_ctribnac text default '100501';
alter table empresa add column if not exists servico_descricao text default 'Intermediação de venda de veículo automotor';
alter table empresa add column if not exists aliquota_iss numeric(5,2);

-- Cada nota é uma linha, do rascunho à emitida (ou rejeitada, ou cancelada).
create table if not exists nfse (
  id uuid primary key default gen_random_uuid(),
  ambiente text not null check (ambiente in ('restrita', 'producao')),
  serie text, numero_dps bigint,
  estoque_id uuid references estoque(id) on delete set null,
  lancamento_id uuid,
  tomador_tipo text check (tomador_tipo in ('cnpj', 'cpf')),
  tomador_doc text, tomador_nome text, tomador_email text,
  descricao text, valor numeric(12,2) not null check (valor > 0),
  competencia date,
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'enviando', 'emitida', 'rejeitada', 'cancelada')),
  chave_acesso text, numero_nfse text,
  dps_xml text, nfse_xml text, erros jsonb,
  emitida_em timestamptz, cancelada_em timestamptz,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now()
);
create unique index if not exists nfse_numero_unico on nfse (ambiente, serie, numero_dps) where numero_dps is not null;
create index if not exists nfse_estoque_idx on nfse (estoque_id);
alter table nfse enable row level security;
drop policy if exists nfse_fin on nfse;
create policy nfse_fin on nfse for all to authenticated using (e_financeiro() or e_gerente()) with check (e_financeiro() or e_gerente());

-- O número da DPS é reservado no banco, de uma vez: duas pessoas emitindo juntas não pegam o mesmo
-- número, e número usado não volta (a Receita recusa DPS repetida).
create or replace function nfse_reservar_numero(p_nfse uuid)
returns table (serie text, numero bigint) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare s text; n bigint; amb text;
begin
  if not (e_financeiro() or e_gerente()) then raise exception 'sem acesso' using errcode = '42501'; end if;
  select x.numero_dps, x.serie, x.ambiente into n, s, amb from nfse x where x.id = p_nfse;
  if amb is null then raise exception 'nota não encontrada'; end if;
  if n is not null then return query select s, n; return; end if;   -- já reservado: o mesmo, para reenviar
  if amb = 'producao' then
    update empresa set nfse_proximo_producao = nfse_proximo_producao + 1 where id = 1
      returning nfse_serie_producao, nfse_proximo_producao - 1 into s, n;
  else
    update empresa set nfse_proximo_restrita = nfse_proximo_restrita + 1 where id = 1
      returning nfse_serie_restrita, nfse_proximo_restrita - 1 into s, n;
  end if;
  update nfse set serie = s, numero_dps = n where id = p_nfse;
  return query select s, n;
end $$;
revoke all on function nfse_reservar_numero(uuid) from public, anon;
grant execute on function nfse_reservar_numero(uuid) to authenticated;
