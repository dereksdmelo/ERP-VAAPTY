-- O BUCKET PASSA A ACEITAR AUDIO E VIDEO (06/10/2026)
--
-- O Derek mostrou tres vezes a mesma coisa: o audio de voz e o CRLV em
-- PDF que chegam na conversa nao abriam. O PDF ja era aceito -- o que
-- faltava era guardar. O audio nao: o bucket da 0008 nasceu para
-- documento de veiculo e so aceitava PDF e imagem.
--
-- **Audio de negociacao e conteudo de trabalho.** O cliente manda nota
-- de voz dizendo o que quer pelo carro, e isso vale tanto quanto o
-- texto -- hoje some.
--
-- O limite de 10 MB nao muda, e a ponte recusa antes do que passa.
-- Tipo fora da lista continua sendo recusado COM NOME, na funcao, em
-- vez de voltar erro cru do Storage no meio de uma conversa.

update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg', 'image/png', 'image/webp', 'image/gif',
     'application/pdf',
     'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/wav',
     'video/mp4', 'video/3gpp', 'video/quicktime'
   ]
 where id = 'documentos-veiculo';
