-- 0015 — o aviso de que o contrato foi assinado
--
-- O ZapSign chama nosso webhook quando o contrato é assinado, e essa
-- chamada não tem login: ele não conhece o token do usuário. Sem isso
-- resolvido, só havia dois caminhos, os dois ruins:
--
--   1. usar a SUPABASE_SERVICE_KEY na função do webhook — ela passa por
--      cima da RLS inteira, e a decisão da casa é que ela só existe
--      para o Storage, dentro do api/foto.js;
--   2. abrir a tabela `atendimento` para o papel anônimo — pior ainda,
--      porque lá dentro tem nome, telefone e CPF de cliente.
--
-- A saída é uma função estreita: ela só sabe fazer uma coisa, marcar
-- como assinado um contrato cujo token já existe. Não lê, não lista,
-- não apaga, e não aceita token que ninguém gravou antes.

create or replace function marcar_contrato_assinado(tok text)
returns boolean as $$
declare
  achou int;
begin
  if tok is null or length(trim(tok)) < 10 then
    return false;
  end if;

  update atendimento
     set contrato_assinado_em = coalesce(contrato_assinado_em, now()),
         atualizado_em = now()
   where contrato_zapsign_token = tok;

  get diagnostics achou = row_count;
  return achou > 0;
end;
$$ language plpgsql security definer set search_path = public;

-- Só esta função, e só ela, fica ao alcance de quem chega sem login.
revoke all on function marcar_contrato_assinado(text) from public;
grant execute on function marcar_contrato_assinado(text) to anon, authenticated;

comment on function marcar_contrato_assinado(text) is
  'Chamada pelo webhook do ZapSign, que chega sem login. Só marca como assinado um contrato cujo token já foi gravado no envio.';
