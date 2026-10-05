-- QUANTAS VEZES JA SE LIGOU PARA ESTE CLIENTE (05/10/2026)
--
-- O Derek pediu para ver se a ligacao e a 1a, 2a, 3a... e poder montar
-- lista so de primeira call. **E a contagem que muda a conversa**: a
-- primeira ligacao e apresentacao, a quinta e outra coisa -- ou se
-- insiste de um jeito diferente, ou se para de insistir.
--
-- **O numero e CONTADO, nao digitado.** Ninguem anota "foi a terceira"
-- com o telefone na orelha; o que se faz e apertar o botao de ligar, e
-- e isso que o sistema sabe ver. Campo digitado aqui ficaria em branco
-- como o resto do que se pede para preencher depois.
--
-- **Conta tentativa, nao conversa.** O sistema nao sabe se atenderam,
-- e fingir que sabe seria pior: "4a call" significa que se tentou
-- quatro vezes, que e exatamente o que faz decidir se vale a quinta.

alter table lead
  add column ligacoes int not null default 0,
  add column ultima_ligacao_em timestamptz;

create index lead_ligacoes on lead (ligacoes) where excluido_em is null;

comment on column lead.ligacoes is
  'Quantas vezes se tentou ligar por aqui. Contado pelo botao, nunca digitado.';
