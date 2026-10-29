-- =====================================================================
-- 0097 — Em que categoria do DRE cada parte da folha entra
--
-- O Derek, em 28/10/2026: "a folha não está prevista como Prestação de
-- serviços e sim como não categorizada… uma parte é categorizada como
-- prestação de serviços, outra como comissão e outra como bonificação…
-- é até importante poder configurar isso na aba folha".
--
-- Uma linha só (id travado em 1, como a `config_loja` da 0068), do
-- financeiro: é ele quem decide o plano de contas. O DRE projetado usa
-- as três para pôr a folha prevista na categoria certa e para saber o
-- que dela já foi lançado.
-- =====================================================================

create table if not exists fin_config (
  id                     int primary key default 1 check (id = 1),
  folha_cat_salario      uuid references fin_categoria(id),
  folha_cat_comissao     uuid references fin_categoria(id),
  folha_cat_bonificacao  uuid references fin_categoria(id),
  atualizado_em          timestamptz not null default now()
);
alter table fin_config enable row level security;
drop policy if exists fin_config_acesso on fin_config;
create policy fin_config_acesso on fin_config for all to authenticated using (e_financeiro()) with check (e_financeiro());
insert into fin_config (id) values (1) on conflict (id) do nothing;
