-- A FLAVIA AO VIVO LE A MIDIA (23/10/2026)
--
-- O Derek, olhando o treino: *"como assim nao consegue abrir audio?
-- precisa conseguir ouvir audio"*. No treino ela ja lia (0073); ao
-- vivo, no numero da TV (0075), nao -- a leitura rodava com o token de
-- quem abre a tela, e o cron nao tem usuario. Com cliente de verdade,
-- ela pedia para escrever o que ele tinha acabado de falar.
--
-- **Duas funcoes estreitas, pelo mesmo segredo da 0075.** Uma devolve o
-- anexo das mensagens DO CLIENTE pedidas (e so midia), para o
-- api/foto.js baixar o arquivo com a chave de servico -- que continua
-- so la (decisao 9), e so para o que esta funcao devolveu. A outra grava
-- a leitura, e so na coluna da leitura.

create or replace function ia_midias(p_segredo text, p_ids uuid[])
returns table (id uuid, anexo jsonb)
language plpgsql security definer set search_path = public stable as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  return query
    select m.id, m.anexo from wa_mensagem m
     where m.id = any(p_ids) and m.eco = false and m.tipo = 'midia';
end;
$$;
revoke all on function ia_midias(text, uuid[]) from public;
grant execute on function ia_midias(text, uuid[]) to anon, authenticated;

create or replace function ia_gravar_leitura(p_segredo text, p_mensagem uuid, p_leitura text, p_modelo text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ia_chave_ok(p_segredo) then raise exception 'sem permissão' using errcode = '42501'; end if;
  update wa_mensagem
     set leitura = left(coalesce(p_leitura, ''), 1600), leitura_em = now(), leitura_modelo = p_modelo
   where id = p_mensagem and eco = false and tipo = 'midia';
end;
$$;
revoke all on function ia_gravar_leitura(text, uuid, text, text) from public;
grant execute on function ia_gravar_leitura(text, uuid, text, text) to anon, authenticated;
