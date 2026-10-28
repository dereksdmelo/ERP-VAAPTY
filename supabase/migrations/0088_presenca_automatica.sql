-- =====================================================================
-- 0088 — A presença vem do uso, não do botão
--
-- O Derek, em 28/10/2026: *"ao abrir a tela que estava aberta no perfil
-- dele o sistema reconhece que o negociador está na loja,
-- automaticamente vai pra fila da vez. Se ele não responder o que está
-- fazendo no momento ou não estiver em atendimento, o sistema desativa
-- a vez dele dentro de 30 minutos."*
--
-- Então a presença da 0085 passa a ter três sinais, e quem decide se a
-- pessoa está na fila é a conta no servidor (decisão 67), não uma
-- coluna gravada:
--
--   * `abriu_em` — a última vez que o sistema foi aberto por ela hoje.
--     Abrir dá trinta minutos de fila.
--   * a última resposta ao lembrete "o que você está fazendo agora?"
--     (a agenda da 0046) — cada resposta renova os trinta minutos;
--   * estar atendendo, que segura a pessoa na fila sem prazo nenhum.
--
-- `saida_manual` separa o "Saí" apertado à mão do sumir por silêncio: o
-- primeiro vale até a pessoa dizer que voltou — abrir o sistema em
-- casa à noite não a põe de volta na fila. O segundo se desfaz sozinho
-- na próxima resposta.
-- =====================================================================

alter table presenca add column if not exists abriu_em timestamptz;
alter table presenca add column if not exists saida_manual boolean not null default false;

-- A RLS da 0046 deixa cada um ler só a PRÓPRIA agenda (o gerente lê
-- todas). A fila é calculada com o token de quem olha, então sem isto
-- um negociador veria todos os colegas "sem resposta" e fora da fila.
-- Esta função devolve só a HORA e o TIPO da última resposta de cada um
-- no dia — o que a pessoa escreveu continua sendo só dela.
create or replace function agenda_ultimo_sinal(p_dia date)
returns table (perfil_id uuid, ultimo timestamptz, tipo text)
language sql security definer stable set search_path = public as $$
  select distinct on (a.perfil_id) a.perfil_id, a.feito_em, a.tipo
    from agenda a
   where e_equipe() and a.dia = p_dia and a.feito_em is not null
   order by a.perfil_id, a.feito_em desc;
$$;
revoke all on function agenda_ultimo_sinal(date) from public;
grant execute on function agenda_ultimo_sinal(date) to authenticated;
