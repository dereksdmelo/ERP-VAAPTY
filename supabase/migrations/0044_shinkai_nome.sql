-- =====================================================================
-- 0044 — O nome da pessoa no Shinkai
--
-- O envio de 11/09/2026 voltou com o aviso: `comprador_responsavel`
-- "TIAGO" não está na equipe da franquia. E não está mesmo — lá ele é
-- **Tiago Tisott**.
--
-- Há três listas de nomes para as mesmas pessoas:
--
--   `negociador` (Equipe e metas)  TIAGO, DIMAS, ANDRÉ BRUNO
--   `perfil` (quem tem login)      Thiago Santos de Souza, Pablo Soares
--   equipe do Shinkai              Tiago Tisott, Dimas Campos, André Bruno
--
-- **Casar pelo primeiro nome seria errado, não incompleto.** A equipe
-- deles tem "Tiago Tisott" E "Thiago Santos de Souza" — um negociador e
-- um gerente, duas pessoas. Um casamento por aproximação acertaria
-- Dimas, erraria Tiago, e o erro seria silencioso: o carro entra com o
-- responsável trocado e ninguém vê.
--
-- Então é cadastro, como o comprador da decisão 23: uma coluna onde se
-- escreve, uma vez por pessoa, o nome exato do outro lado. Vazia, o
-- envio usa o nome daqui e o aviso do Shinkai volta listando os nomes
-- válidos — que é como se descobre o que escrever aqui.
-- =====================================================================

alter table negociador add column if not exists shinkai_nome text;

comment on column negociador.shinkai_nome is
  'Nome EXATO desta pessoa na equipe da franquia no Shinkai. Vazio usa o nome daqui, e o envio devolve aviso com os nomes validos.';
