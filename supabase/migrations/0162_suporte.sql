-- =====================================================================
-- 0162 — Suporte e melhorias: o pedido sai de qualquer tela
--
-- O Derek, em 19/11/2026: um botão no canto, em qualquer tela, "sugestão
-- de melhoria ou suporte do sistema"; tira um print, a pessoa risca com
-- um lápis onde é o problema e escreve o que precisa mudar. E: "um agente
-- faz todas as melhorias que forem bugs ou coisas que precisa resolver, e
-- me consulta quando for alguma mudança grande".
--
-- Por isso o pedido tem duas marcas além do texto: a SITUAÇÃO (a fila) e a
-- CLASSE (bug, pequena, grande), que é o que separa o que o agente resolve
-- sozinho do que espera o Derek ("aguardando_derek").
--
-- Quem escreve o pedido é quem o fez, e só como si mesmo. Cada um lê os
-- seus (para ver a resposta); o gerente lê e responde todos. O print fica
-- no bucket privado `documentos-veiculo`, em `suporte/` (decisão 9: a
-- linha pelo token, a chave só no Storage).
-- =====================================================================

create table if not exists suporte_pedido (
  id             uuid primary key default gen_random_uuid(),
  perfil_id      uuid default auth.uid() references perfil(id) on delete set null,
  nome           text,
  tipo           text not null default 'problema' check (tipo in ('problema', 'melhoria')),
  texto          text not null check (length(texto) between 3 and 4000),
  tela           text,
  endereco       text,
  navegador      text,
  print_caminho  text,
  situacao       text not null default 'novo'
                 check (situacao in ('novo', 'em_andamento', 'aguardando_derek', 'feito', 'recusado')),
  classe         text check (classe in ('bug', 'pequena', 'grande')),
  resposta       text,
  respondido_em  timestamptz,
  commit_feito   text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists suporte_pedido_fila on suporte_pedido (situacao, criado_em desc);
create index if not exists suporte_pedido_quem on suporte_pedido (perfil_id, criado_em desc);

alter table suporte_pedido enable row level security;

drop policy if exists suporte_grava on suporte_pedido;
create policy suporte_grava on suporte_pedido for insert to authenticated
  with check (perfil_id = auth.uid());

drop policy if exists suporte_le on suporte_pedido;
create policy suporte_le on suporte_pedido for select to authenticated
  using (perfil_id = auth.uid() or e_gerente());

drop policy if exists suporte_responde on suporte_pedido;
create policy suporte_responde on suporte_pedido for update to authenticated
  using (e_gerente()) with check (e_gerente());
