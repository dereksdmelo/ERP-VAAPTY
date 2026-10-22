-- O QUE A IA LEU DE CADA MIDIA (22/10/2026)
--
-- O Derek: *"preciso que a IA consiga abrir fotos, videos e
-- principalmente documentos. e com isso consiga decifrar qual o carro
-- que o cliente esta se referindo"* -- e, no mesmo minuto, *"ela
-- precisa entender audio tambem"*.
--
-- **A leitura e feita UMA vez e fica na mensagem.** A Flavia redige
-- muitas vezes sobre a mesma conversa (cada ponto do treino, cada
-- "refazer"), e ler de novo a mesma foto a cada rascunho seria pagar
-- de novo pelo mesmo texto. Guardada aqui, ela tambem serve quando a
-- Flavia atender de verdade, e serve a tela de Conversas, que hoje
-- mostra "mandou um audio" sem dizer o que foi dito.
--
-- **E texto, nao estrutura.** O que importa e o modelo ler junto com
-- a conversa: "CRLV de um Onix LT 2019/2020 prata, placa ABC1D23".
-- Colunas de marca/modelo/ano pediriam decidir antes o que cada midia
-- pode conter -- e um audio de voz nao tem placa.
--
-- **Sem RLS nova:** a 0054 ja abre `wa_mensagem` para a equipe, e
-- quem pede a leitura e o gerente, no treino.

alter table wa_mensagem
  add column if not exists leitura        text,
  add column if not exists leitura_em     timestamptz,
  add column if not exists leitura_modelo text;

comment on column wa_mensagem.leitura is
  'O que a IA leu da midia: transcricao do audio, ou o carro e o documento que aparecem na foto. Sem CPF, RG, nome do dono nem RENAVAM.';
