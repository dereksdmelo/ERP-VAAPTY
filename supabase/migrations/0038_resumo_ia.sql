-- =====================================================================
-- 0038 — O resumo da conversa, escrito pela IA
--
-- O painel do gestor mostrava a transcrição inteira. Meia hora de fala
-- em texto corrido, com as palavras que o reconhecimento de voz errou,
-- não é leitura de gestor: é arquivo. O Derek pediu o resumo, e disse
-- para usar a IA se fosse preciso — é preciso. Os "sinais" da decisão
-- 17 são busca por expressão e não resumem nada; resumir pede modelo.
--
-- **É cache, não histórico.** Uma linha por atendimento, sobrescrita,
-- como o resto da `negociacao_viva`. O resumo custa uma chamada paga;
-- guardar o resultado é o que impede o mesmo negócio de ser resumido
-- de novo toda vez que o gestor abre a tela. Enquanto a conversa está
-- viva o texto muda, e aí o gestor manda refazer — o botão diz de
-- quando é o resumo que está na tela.
--
-- **O modelo fica gravado junto.** Trocar `IA_MODELO` não precisa de
-- deploy (decisão 31), então sem esta coluna ninguém saberia com o quê
-- cada resumo foi escrito.
-- =====================================================================

alter table negociacao_viva
  add column if not exists resumo_ia        text,
  add column if not exists resumo_ia_em     timestamptz,
  add column if not exists resumo_ia_modelo text;

comment on column negociacao_viva.resumo_ia is
  'Resumo da conversa escrito por IA a pedido do gestor. Cache do último pedido, não histórico.';

-- ---------------------------------------------------------------------
-- Quem grava o resumo
--
-- A política de escrita da 0033 é do NEGOCIADOR: o espelho vem do
-- aparelho dele, e gerente escrevendo ali criaria estado que a tela do
-- negociador sobrescreve no segundo seguinte. Mas quem pede o resumo é
-- justamente o gerente, no painel.
--
-- Abrir `update` da tabela para o gerente resolveria e abriria junto a
-- transcrição, as rodadas e o valor fechado — RLS não separa coluna.
-- Então a saída é a mesma da `marcar_contrato_assinado()` (0015) e da
-- senha (0032): uma função que só sabe fazer esta coisa, e confere o
-- papel antes de fazer.
-- ---------------------------------------------------------------------
create or replace function gravar_resumo_ia(
  p_atendimento uuid,
  p_texto       text,
  p_modelo      text
) returns boolean as $$
declare
  linhas integer;
begin
  -- O papel é conferido aqui dentro, com o JWT de quem chamou: a
  -- função é `security definer`, então sem esta linha qualquer conta
  -- autenticada escreveria na linha de qualquer atendimento.
  if not e_gerente() then
    return false;
  end if;

  update negociacao_viva
     set resumo_ia        = left(coalesce(p_texto, ''), 4000),
         resumo_ia_em     = now(),
         resumo_ia_modelo = left(coalesce(p_modelo, ''), 80)
   where atendimento_id = p_atendimento;

  get diagnostics linhas = row_count;
  return linhas > 0;
end;
$$ language plpgsql volatile security definer set search_path = public, pg_temp;

revoke all on function gravar_resumo_ia(uuid, text, text) from public;
grant execute on function gravar_resumo_ia(uuid, text, text) to authenticated;
