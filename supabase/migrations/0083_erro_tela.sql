-- =====================================================================
-- 0083 — O erro de tela fica registrado
--
-- O Derek, em 28/10/2026: *"de vez em quando acontece isso, depois de
-- certo uso vou clicando e ele simplesmente apaga"* — tela branca. A
-- rede de proteção do `index.html` (`RedeDeErro`) agora mostra o erro
-- em vez de apagar o sistema; esta tabela guarda o que ela pegou, para
-- que achar a causa não dependa de alguém copiar a mensagem e mandar.
--
-- Quem escreve é quem viu o erro, e só como ele mesmo; quem lê é o
-- gerente. Não guarda dado do cliente: a mensagem e a pilha de
-- componentes são código, e a tela é o nome do destino.
-- =====================================================================

create table if not exists erro_tela (
  id         uuid primary key default gen_random_uuid(),
  perfil_id  uuid default auth.uid() references perfil(id) on delete set null,
  onde       text,
  mensagem   text,
  pilha      text,
  navegador  text,
  criado_em  timestamptz not null default now()
);
create index if not exists erro_tela_quando on erro_tela (criado_em desc);
alter table erro_tela enable row level security;
drop policy if exists erro_tela_grava on erro_tela;
create policy erro_tela_grava on erro_tela for insert to authenticated with check (perfil_id = auth.uid());
drop policy if exists erro_tela_le on erro_tela;
create policy erro_tela_le on erro_tela for select to authenticated using (e_gerente());
