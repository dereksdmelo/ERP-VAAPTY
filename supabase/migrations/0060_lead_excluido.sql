-- EXCLUIR LEAD E ESCONDER, NAO APAGAR (05/10/2026)
--
-- O Derek pediu exclusao "com justificativa, e fica numa lista oculta
-- de excluidos". As duas metades do pedido sao a decisao:
--
-- **Nao apaga.** Lead e a origem do funil; linha que some leva junto a
-- conversao do canal e o historico de quem ja falou com a loja -- e
-- numero que muda sozinho, sem ninguem saber por que, e numero que
-- deixa de ser lido. Esconder resolve o que incomoda (a fila suja) sem
-- destruir o que explica.
--
-- **A justificativa e obrigatoria**, e e ela que separa limpeza de
-- faxina. Sem motivo escrito, "excluir" vira o botao que se aperta
-- para tirar da tela -- a mesma armadilha que o motivo de "perdido"
-- evita (decisao 27). Com o motivo, da para responder depois: estamos
-- excluindo engano de digitacao ou estamos excluindo cliente dificil?

alter table lead
  add column excluido_em    timestamptz,
  add column excluido_por   uuid references perfil(id),
  add column excluido_motivo text;

-- A fila normal le por este indice; o excluido sai dela e so aparece
-- em quem for procurar.
create index lead_vivos on lead (status, criado_em desc) where excluido_em is null;

comment on column lead.excluido_motivo is
  'Por que saiu da lista. Obrigatorio na exclusao -- sem ele, excluir vira o botao de limpar a tela.';
