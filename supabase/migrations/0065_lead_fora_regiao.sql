-- FORA DA REGIAO, MARCADO PELA PESSOA (07/10/2026)
--
-- A 0064 deu ao lead a CIDADE, e "fora da regiao" saia dela: cidade
-- escrita e fora da lista da loja. O Diego usou o quadro e disse o que
-- faltava: *"falta ter o como colocar o lead no 'fora de regiao' --
-- botao acho que ja serve"*.
--
-- Na pratica a pre-venda sabe que o cliente e de longe antes de saber
-- o nome da cidade ("ele mora la pra Curitiba", "e de fora do estado")
-- e nao vai parar uma ligacao para digitar. Um botao basta.
--
-- **E uma marca, nao um segundo campo de cidade.** A regra do quadro
-- passa a ser: fora da regiao = marcado a mao OU cidade escrita que
-- nao e da regiao. Quem marcou a mao nao perde a marca ao digitar uma
-- cidade, e quem digitou uma cidade de longe nao precisa marcar nada.
--
-- `not null default false` e nao nulo: aqui NAO existe "ninguem
-- perguntou ainda" -- sem marca quer dizer que ninguem disse que e
-- longe, e e assim que a lista de fora fica so com quem alguem
-- decidiu. (A cidade em branco e outra coisa, e continua nula.)

alter table lead add column if not exists fora_regiao boolean not null default false;

comment on column lead.fora_regiao is
  'Marcado a mao: o cliente mora longe demais para vir a loja. Soma-se a cidade fora da lista.';
