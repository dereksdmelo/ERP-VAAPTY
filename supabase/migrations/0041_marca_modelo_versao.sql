-- =====================================================================
-- 0041 — Marca, modelo e versão deixam de ser uma string só
--
-- A 0001 guardou `marca_modelo`: "VOLKSWAGEN POLO COMFORT. 200 TSI 1.0
-- FLEX 12V AUT." numa coluna só. Serviu enquanto o destino era texto —
-- o descritivo do WhatsApp imprime a linha inteira e ninguém precisa
-- das partes.
--
-- **O Shinkai precisa das partes.** A tela deles tem três selects
-- ligados à FIPE em tempo real (MARCA, MODELO, ANO/COMBUSTÍVEL), e a
-- documentação do Mateus diz, textualmente, que mandar `marca`,
-- `modelo` e `versao` separados é melhor. Mandando a string única os
-- três campos ficam vazios do lado de lá — foi o que o Derek viu em
-- 11/09/2026: "está indo sem os dados do carro".
--
-- **Partir a string no servidor não resolve.** "Land Rover Range Rover
-- Evoque" e "Alfa Romeo Giulia" têm marca de duas palavras, e o
-- primeiro token erra as duas — o mesmo tropeço dos canais de preço
-- (decisão 8) e do `marca_modelo` inteiro (decisão 36). Quem sabe
-- separar é a fonte: tanto a consulta de placa quanto a tabela FIPE
-- oficial já devolvem marca e modelo em campos próprios. O que
-- faltava era coluna para guardar.
--
-- `marca_modelo` continua, e continua sendo o que o descritivo
-- imprime: ela é a linha que o lojista lê, e montá-la de três pedaços
-- a cada uso criaria uma segunda verdade sobre o nome do carro.
-- =====================================================================

alter table veiculo
  add column if not exists marca  text,
  add column if not exists modelo text,
  add column if not exists versao text;

comment on column veiculo.marca is
  'Marca como a fonte a devolve (FIPE ou consulta de placa). Nunca derivada de marca_modelo por corte de token.';
comment on column veiculo.modelo is
  'Modelo sem a marca e sem a versao. Ex.: "POLO".';
comment on column veiculo.versao is
  'Versao/acabamento. Ex.: "COMFORT. 200 TSI 1.0 FLEX 12V AUT.".';
