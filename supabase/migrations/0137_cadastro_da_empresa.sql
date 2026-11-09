-- 0137 · O cadastro da empresa (09/11/2026, o Derek: "um lugar de cadastro da empresa… os dados da
-- nossa unidade, o logo, que vai servir pra todos os lugares onde aparece o logo, os documentos da
-- unidade, CNPJ, endereço e tudo o que for necessário pra aparecer nos contratos… vai ser uma base
-- importante pra quando começarmos a vender esse aplicativo pra outras unidades").
--
-- UMA LINHA (id = 1), como a config_loja (0068): é a unidade deste sistema. Os contratos leem daqui; o
-- que estiver vazio cai nos valores escritos até hoje, então nenhum papel muda até alguém editar.
-- A equipe lê (o negociador imprime contrato com estes dados); só o gerente escreve.
create table if not exists empresa (
  id int primary key default 1 check (id = 1),
  razao_social text, nome_fantasia text, nome_unidade text,
  cnpj text, inscricao_estadual text, inscricao_municipal text,
  logradouro text, numero text, complemento text, bairro text, cidade text, uf text, cep text,
  telefone text, whatsapp text, email text, site text,
  rep_nome text, rep_cpf text, rep_cargo text,
  banco text, agencia text, conta text, pix text, favorecido text,
  logo text check (logo is null or length(logo) < 700000),   -- data URL da imagem: os papéis a embutem
  atualizado_por uuid, atualizado_em timestamptz not null default now()
);
alter table empresa enable row level security;
drop policy if exists empresa_le on empresa;
create policy empresa_le on empresa for select to authenticated using (e_equipe());
drop policy if exists empresa_grava on empresa;
create policy empresa_grava on empresa for insert to authenticated with check (e_gerente());
drop policy if exists empresa_edita on empresa;
create policy empresa_edita on empresa for update to authenticated using (e_gerente()) with check (e_gerente());

-- Os papéis da unidade: contrato social, cartão CNPJ, alvará, certidões. O arquivo fica no bucket
-- privado (documentos-veiculo/empresa/), pelo api/foto.js; a linha é daqui. Lê a gerência e o
-- financeiro; grava e apaga o gerente.
create table if not exists empresa_anexo (
  id uuid primary key default gen_random_uuid(),
  caminho text not null, tipo text, bytes int, nome text, rotulo text,
  validade date,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now()
);
alter table empresa_anexo enable row level security;
drop policy if exists empresa_anexo_le on empresa_anexo;
create policy empresa_anexo_le on empresa_anexo for select to authenticated using (e_financeiro() or e_gerente());
drop policy if exists empresa_anexo_grava on empresa_anexo;
create policy empresa_anexo_grava on empresa_anexo for insert to authenticated with check (e_gerente());
drop policy if exists empresa_anexo_apaga on empresa_anexo;
create policy empresa_anexo_apaga on empresa_anexo for delete to authenticated using (e_gerente());
drop policy if exists empresa_anexo_edita on empresa_anexo;
create policy empresa_anexo_edita on empresa_anexo for update to authenticated using (e_gerente()) with check (e_gerente());

-- Os valores de hoje, para os papéis saírem idênticos.
insert into empresa (id, razao_social, nome_fantasia, nome_unidade, cnpj, logradouro, numero, bairro, cidade, uf, cep)
values (1, 'Vaapty Intermediação Veicular LTDA', 'Vaapty', 'VAAPTY JOINVILLE', '34.840.903/0001-00',
        'Rua Anita Garibaldi', '705', 'Anita Garibaldi', 'Joinville', 'SC', '89.203-300')
on conflict (id) do nothing;
