-- 0129 — Plano de contas numerado, em grupos (08/11/2026, o Derek: "estruturar de forma mais
-- profissional, com numeração que faça sentido"). Dois níveis: grupo (1 dígito) > conta (X.NN).
--   2 Custos do negócio · 3 Pessoas · 4 Ocupação · 5 Comercial e marketing · 6 Administrativo
--   7 Financeiro · 8 Impostos sobre faturamento · 9 Fora do resultado (carros, sócios, transferência,
--   investimento, empréstimo). O 1 fica reservado às Receitas.
-- Nada é apagado nem renomeado: o histórico continua na mesma conta, que só ganha código e mãe.
-- Capital, Equipamento, Bens e Empréstimo passam para "Fora do resultado" (não são despesa).
create table if not exists fin_categoria_copia_20261108 as select * from fin_categoria;
alter table fin_categoria_copia_20261108 enable row level security;  -- sem política: só o painel lê
alter table fin_categoria add column if not exists codigo text;

insert into fin_categoria (nome, grupo, no_dre, ordem, ativa, pede_funcionario, tipo_custo)
select v.nome, 'despesa', v.dre, v.ordem, true, v.pf, v.tipo
  from (values
    ('Custos do negócio', true, 2000, false, 'variavel'), ('Ocupação', true, 4000, false, 'fixa'),
    ('Comercial e marketing', true, 5000, false, 'fixa'), ('Administrativo', true, 6000, false, 'fixa'),
    ('Financeiro', true, 7000, false, 'fixa'), ('Impostos sobre faturamento', true, 8000, false, 'variavel'),
    ('Fora do resultado', false, 9000, false, 'fora'),
    ('FGTS', true, 3090, true, 'fixa'), ('Contabilidade', true, 6020, false, 'fixa'),
    ('Jurídico', true, 6030, false, 'fixa'), ('RH e recrutamento', true, 6040, false, 'fixa')
  ) v(nome, dre, ordem, pf, tipo)
 where not exists (select 1 from fin_categoria c where c.nome = v.nome);

do $$
declare m record;
begin
  for m in select * from (values
    -- nome, código, código da mãe, tipo_custo, no_dre
    ('Custos do negócio','2',null,'variavel',true), ('Pessoas','3',null,'fixa',true), ('Ocupação','4',null,'fixa',true),
    ('Comercial e marketing','5',null,'fixa',true), ('Administrativo','6',null,'fixa',true), ('Financeiro','7',null,'fixa',true),
    ('Impostos sobre faturamento','8',null,'variavel',true), ('Fora do resultado','9',null,'fora',false),
    ('Cartorio','2.01','2','variavel',true), ('Despachante','2.02','2','variavel',true), ('Cautelar','2.03','2','variavel',true),
    ('Consultas','2.04','2','variavel',true), ('Motoboy','2.05','2','variavel',true), ('Uber','2.06','2','variavel',true),
    ('Correio','2.07','2','variavel',true), ('Combustivel','2.08','2','variavel',true), ('M.Veiculo','2.09','2','variavel',true),
    ('Manutenção','2.10','2','variavel',true), ('Prejuizo','2.11','2','variavel',true),
    ('Prestação de Serviço','3.01','3','fixa',true), ('Comissão','3.02','3','fixa',true), ('Bonificação','3.03','3','fixa',true),
    ('Vale','3.04','3','fixa',true), ('Rescisão','3.05','3','fixa',true), ('Provisões','3.06','3','fixa',true),
    ('INSS','3.07','3','fixa',true), ('IRRF','3.08','3','fixa',true), ('FGTS','3.09','3','fixa',true),
    ('Confraternização','3.10','3','fixa',true), ('Uniformes','3.11','3','fixa',true),
    ('Aluguel','4.01','4','fixa',true), ('Luz','4.02','4','fixa',true), ('Agua','4.03','4','fixa',true), ('Internet','4.04','4','fixa',true),
    ('Limpeza','4.05','4','fixa',true), ('Segurança','4.06','4','fixa',true), ('Copa','4.07','4','fixa',true),
    ('MKT','5.01','5','fixa',true), ('Feirão','5.02','5','fixa',true), ('Brinde','5.03','5','fixa',true),
    ('Decoração','5.04','5','fixa',true), ('Meta','5.05','5','fixa',true),
    ('Honorario','6.01','6','fixa',true), ('Contabilidade','6.02','6','fixa',true), ('Jurídico','6.03','6','fixa',true),
    ('RH e recrutamento','6.04','6','fixa',true), ('Sistema','6.05','6','fixa',true), ('Escritorio','6.06','6','fixa',true),
    ('Papelaria','6.07','6','fixa',true), ('Seguro','6.08','6','fixa',true), ('Bancario','6.09','6','fixa',true), ('Outro','6.99','6','fixa',true),
    ('Juros','7.01','7','fixa',true), ('Crédito','7.02','7','fixa',true),
    ('Simples','8.01','8','variavel',true),
    ('Negociação','9.01','9','fora',false), ('Retirada','9.02','9','fora',false), ('Transferência','9.03','9','fora',false),
    ('Saldo','9.04','9','fora',false), ('Bens','9.05','9','fora',false), ('Equipamento','9.06','9','fora',false),
    ('Capital','9.07','9','fora',false), ('Empréstimo','9.08','9','fora',false)
  ) as t(nome, cod, mae, tipo, dre)
  loop
    update fin_categoria c set codigo = m.cod, tipo_custo = m.tipo, no_dre = m.dre,
           ordem = (split_part(m.cod,'.',1)::int * 1000) + coalesce(nullif(split_part(m.cod,'.',2),'')::int, 0) * 10,
           pai_id = (select p.id from fin_categoria p where p.codigo = m.mae and p.pai_id is null limit 1)
     where c.nome = m.nome;
  end loop;
end $$;
-- a mãe de cada grupo precisa de código antes de ser achada: roda de novo para as contas
do $$
declare m record;
begin
  for m in select c.id, split_part(c.codigo,'.',1) as g from fin_categoria c where c.codigo like '%.%' loop
    update fin_categoria set pai_id = (select p.id from fin_categoria p where p.codigo = m.g and p.codigo not like '%.%' limit 1) where id = m.id;
  end loop;
end $$;
insert into schema_migrations(arquivo) values ('0129_plano_de_contas_numerado.sql') on conflict do nothing;
