-- OS TRÊS NÚMEROS, E O NÚMERO QUE SÓ O QR SABE (01/10/2026)
--
-- `wa_receber()` (0055) recusa canal que não existe, de propósito: a
-- ponte não inventa canal. Então os três têm que estar aqui antes de
-- alguém ler um QR -- o principal da loja e os dois que a IA atende
-- (pedido do Derek).
--
-- E QUAL NÚMERO cada canal virou, só se sabe depois do QR. O telefone
-- vem da ponte, que é servidor sem token: o PATCH pela chave anônima
-- bate na RLS da 0054 e volta 0 linhas **em silêncio** -- a coluna
-- ficaria vazia para sempre e ninguém saberia por quê. Daí a função
-- estreita, mesmo remédio da 0055: ela só sabe gravar o telefone de um
-- canal, e nada mais.

-- LITERAL COM ACENTO VAI EM ESCAPE `U&`, e não é frescura: colar
-- este arquivo no editor SQL do painel estraga byte não-ASCII no
-- caminho, e o nome entra gravado torto -- foi o que aconteceu com
-- este mesmo canal. O escape é ASCII puro e atravessa igual pelos dois
-- caminhos.
--
-- `ana` e `camila` já tinham sido criadas à mão no painel; ficam aqui
-- para que um banco novo nasça igual ao que está no ar, sem ninguém
-- precisar lembrar.
insert into wa_canal (slug, nome, telefone, atendente, ativo) values
  ('loja',   U&'Loja \2014 n\00FAmero principal', '', 'humano', true),
  ('ana',    'IA Ana',           '', 'ia',     true),
  ('camila', 'IA Camila',        '', 'ia',     true)
on conflict (slug) do nothing;

-- Os dois canais genéricos foram meus, e são sobra: os números da IA
-- são a Ana e a Camila. Saem enquanto ainda não têm conversa nenhuma.
delete from wa_canal
 where slug in ('ia1', 'ia2')
   and not exists (select 1 from wa_conversa c where c.canal_id = wa_canal.id);

create or replace function wa_numero(p_canal text, p_telefone text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_canal, '') = '' or coalesce(p_telefone, '') = '' then
    return false;
  end if;
  update wa_canal set telefone = p_telefone
   where slug = p_canal and coalesce(telefone, '') <> p_telefone;
  return true;
end;
$$;

revoke all on function wa_numero(text, text) from public;
grant execute on function wa_numero(text, text) to anon, authenticated;
