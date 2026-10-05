-- NEM TODO NÚMERO É CANAL COMERCIAL (05/10/2026)
--
-- O Derek viu um lead que veio do "Administrativo da loja" e disse o
-- óbvio: aquele número não vira lead. Ele atende lojista, cartório e
-- despachante -- quem escreve ali não é cliente querendo vender carro,
-- e contar essas conversas no funil da pré-venda suja as duas pontas:
-- infla o volume e derruba a conversão de um canal que nunca teve a
-- intenção de converter.
--
-- Um sinalizador por canal, e não uma lista no código: a loja vai
-- cadastrar número novo sem pedir deploy (decisão 48), e quem cadastra
-- é quem sabe para que ele serve.

alter table wa_canal
  add column comercial boolean not null default true;

comment on column wa_canal.comercial is
  'Se as conversas deste número entram no funil da pré-venda e podem virar lead. '
  'Falso para números de operação (administrativo, cartório, despachante).';

update wa_canal set comercial = false where slug = 'administrativo-da-loja';
