-- =====================================================================
-- 0074 — A hora em que o cliente chegou, e o aviso no grupo
--
-- O Derek, em 22/10/2026: o "Chegou" do agendamento abre uma janela com
-- quem atende, o nome do cliente e o carro, e a data e a hora do
-- momento — editáveis, para quem registra depois. E a loja manda no
-- grupo de atendimento do WhatsApp:
--
--     NOME: DJONATHAN
--     VEÍCULO: KWID
--     DATA: 22/10
--     TIAGO ATENDEU
--
-- `chegada_em` existe porque `data` é só o dia. A hora de chegada até
-- aqui morava na ficha da Abordagem (`f.chegada`), que é área de
-- trabalho do aparelho (decisão 44): a pré-venda marcava "chegou" e a
-- hora se perdia até o negociador digitá-la de novo.
--
-- O aviso é configuração, como o resto da loja (decisão 59): QUAL
-- número manda e PARA QUAL grupo. O grupo é guardado pelo id do
-- WhatsApp (`...@g.us`), que não muda quando alguém renomeia o grupo;
-- o nome vai junto só para a tela mostrar o que foi escolhido.
-- =====================================================================

alter table atendimento add column if not exists chegada_em timestamptz;

alter table config_loja add column if not exists aviso_canal text;
alter table config_loja add column if not exists aviso_grupo text;
alter table config_loja add column if not exists aviso_grupo_nome text;
