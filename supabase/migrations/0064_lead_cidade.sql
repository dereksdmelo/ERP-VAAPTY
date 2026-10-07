-- DE ONDE O CLIENTE VEM (07/10/2026)
--
-- O Diego: *"o cliente que tá fora do range precisa de um tratamento
-- específico, talvez uma lista de 'fora do range'"*. Range aqui é
-- DISTÂNCIA: quem mora longe demais não vai atravessar o estado para
-- sentar na mesa, e trabalhar esse lead como os outros é gastar
-- ligação numa visita que não vai acontecer.
--
-- **O sistema não sabia onde ninguém mora.** O lead tem nome,
-- telefone, carro e origem — e mais nada. O DDD seria o palpite de
-- graça, e é um palpite RUIM: o 47 cobre de Joinville a Itajaí e
-- Blumenau, que são 90 km, e quem mudou de cidade carrega o número
-- antigo. Chutar a cidade pelo DDD poria "perto" em quem está longe,
-- que é o erro que esta lista existe para evitar.
--
-- Então é campo digitado: a pré-venda já pergunta isso na ligação, e
-- a IA já pergunta na conversa. Vazio quer dizer "ainda não
-- perguntaram", que é diferente de "é daqui" — e é por isso que a
-- coluna aceita nulo e a lista de fora não inclui quem está em
-- branco. Mesma régua do visto nulo da decisão 30.

alter table lead add column if not exists cidade text;

comment on column lead.cidade is
  'Cidade do cliente, digitada por quem atendeu. Nulo = ninguém perguntou ainda.';
