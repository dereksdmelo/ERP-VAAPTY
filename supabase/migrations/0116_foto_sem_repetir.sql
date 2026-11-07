-- =====================================================================
-- 0116 — A mesma foto não entra duas vezes no mesmo carro
--
-- 07/11/2026, o Derek: "seleciona só uma foto e vai várias". No TDF2A27
-- as 19 fotos subiram às 16:07 e de novo às 17:10 — o celular guardava
-- como "a subir" as que terminaram depois de a tela ser fechada, e ao
-- reabrir mandou tudo outra vez. Eram 28 grupos repetidos em 5 dias.
-- `hash` é o SHA-256 do arquivo: o servidor devolve a foto que já existe
-- em vez de gravar outra, venha a repetida de onde vier (reabrir a tela,
-- dois aparelhos, o mesmo arquivo escolhido duas vezes).
-- =====================================================================

alter table foto add column if not exists hash text;
create unique index if not exists foto_hash_unico on foto (veiculo_id, hash) where hash is not null;
