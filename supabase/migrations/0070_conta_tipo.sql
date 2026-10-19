-- =====================================================================
-- 0070 — Conta não é só banco: a caixinha e o caixa da casa
--
-- O Derek, em 19/10/2026: "preciso poder cadastrar contas bancárias e
-- selecioná-las nos títulos financeiros… Caixinha — dinheiro que fica
-- na gaveta do financeiro; Caixa casa Derek — dinheiro que fica na
-- casa do Derek. Precisamos ter esse controle."
--
-- Dinheiro em espécie é conta como outra qualquer: tem saldo de
-- abertura (0021/decisão 58), lançamentos e títulos que saem dela. O
-- que muda é que não tem extrato — tudo nela é lançado à mão —, e é por
-- isso que o tipo existe: a tela esconde a importação de extrato onde
-- ela não faz sentido, e o casamento automático do extrato nunca baixa
-- um título marcado para sair da gaveta.
-- =====================================================================

alter table fin_conta add column if not exists tipo text not null default 'banco'
  check (tipo in ('banco', 'dinheiro'));

-- Para que serve a conta, em uma linha: "dinheiro que fica na casa do
-- Derek". Nome sozinho não diz onde o dinheiro está.
alter table fin_conta add column if not exists descricao text;
