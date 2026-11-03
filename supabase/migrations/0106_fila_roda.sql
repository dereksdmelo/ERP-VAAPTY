-- =====================================================================
-- 0106 — A fila da vez vira RODA, com registro
--
-- O Derek, em 03/11/2026: "A fila da vez é definida no início do dia,
-- de acordo com o índice AT. Se uma pessoa estiver atendendo na hora
-- que fora a vez dela, pula momentaneamente a vez dela, e depois de 10
-- minutos que ela saiu do atendimento ela volta… a pessoa da vez deve
-- aparecer automaticamente quando a pré-vendas anota que um cliente
-- chegou… e o negociador da vez e o segundo da vez devem receber
-- notificação como POP UP". E as respostas: pedido de negociador
-- específico NÃO conta; quem chega atrasado vai para o FIM da fila; o
-- que libera é o botão "encerrar atendimento"; os 30 minutos sem
-- resposta continuam valendo; quem não aceita ou não responde passa a
-- vez e ganha um "perdeu atendimento"; depois das 18h é só quem está na
-- loja, sem ponto negativo; e o gerente precisa poder corrigir.
--
-- Até aqui a vez era recalculada do zero a cada leitura (0085, 0103).
-- Uma RODA precisa de memória — onde o ponteiro está, quem ficou devendo
-- a vez —, e essa memória é o REGISTRO DO DIA: cada evento grava quem
-- foi, por quê, e para onde o ponteiro foi. O estado é a soma dos
-- eventos (regras/fila.js); não há coluna "ponteiro" para alguém
-- esquecer de atualizar.
-- =====================================================================

-- A ordem do dia, congelada no primeiro cliente (o índice muda quando
-- alguém fecha um carro; a ordem do dia não). Quem chega depois entra no
-- fim, na ordem em que chegou.
create table if not exists fila_dia (
  dia          date primary key,
  ordem        jsonb not null default '[]'::jsonb,
  congelada_em timestamptz not null default now()
);
alter table fila_dia enable row level security;
drop policy if exists fila_dia_equipe on fila_dia;
create policy fila_dia_equipe on fila_dia for all to authenticated using (e_equipe()) with check (e_equipe());

create table if not exists fila_evento (
  id             uuid primary key default gen_random_uuid(),
  dia            date not null,
  criado_em      timestamptz not null default now(),
  -- vez          recebeu um cliente pela fila (via: roda, credito,
  --              todos_ocupados, repasse)
  -- pulou        estava atendendo na vez dele: fica devendo a vez
  -- perdeu       não estava na fila na vez dele: perde essa volta
  -- especifico   o cliente pediu este negociador / já era dele: não conta
  -- fora_da_vez  atendeu sem ser a vez (a tela registra; o gerente olha)
  -- correcao     o gerente pôs a vez em alguém
  -- credito      o gerente devolveu uma vez a alguém
  tipo           text not null check (tipo in ('vez','pulou','perdeu','especifico','fora_da_vez','correcao','credito')),
  perfil_id      uuid references perfil(id) on delete set null,
  nome           text,
  atendimento_id uuid references atendimento(id) on delete set null,
  -- Para onde o ponteiro da roda foi depois deste evento.
  prox           uuid references perfil(id) on delete set null,
  via            text,
  motivo         text,
  -- A chamada (só no tipo "vez"): aceitou, passou ou expirou.
  resposta       text check (resposta in ('aceitou','passou','expirou')),
  respondido_em  timestamptz,
  penalizado     boolean not null default false,
  estornado_em   timestamptz,
  por            uuid default auth.uid()
);
create index if not exists fila_evento_dia on fila_evento (dia, criado_em);
alter table fila_evento enable row level security;
drop policy if exists fila_evento_equipe on fila_evento;
create policy fila_evento_equipe on fila_evento for all to authenticated using (e_equipe()) with check (e_equipe());

/* O PONTO NEGATIVO. "Perdeu atendimento" mora em `desempenho` (0013),
 * que só o gerente escreve; quem passa a vez é o negociador, e quem nota
 * que a chamada venceu é qualquer tela da equipe. Daí esta função
 * estreita: só sabe somar 1 em perdeu_atendimento do mês, e só para uma
 * chamada que de fato terminou em "passou" ou "expirou" e ainda não foi
 * contada. */
create or replace function fila_penalizar(p_evento uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare e fila_evento%rowtype; v_meta uuid; v_comp date;
begin
  if not e_equipe() then return false; end if;
  select * into e from fila_evento where id = p_evento for update;
  if e.id is null or e.tipo <> 'vez' or e.resposta not in ('passou','expirou') or e.penalizado then return false; end if;
  select id into v_meta from negociador where perfil_id = e.perfil_id order by ativo desc limit 1;
  update fila_evento set penalizado = true where id = e.id;
  if v_meta is null then return true; end if;
  v_comp := date_trunc('month', e.dia)::date;
  insert into desempenho (negociador_id, competencia, perdeu_atendimento)
  values (v_meta, v_comp, 1)
  on conflict (negociador_id, competencia)
  do update set perdeu_atendimento = desempenho.perdeu_atendimento + 1, atualizado_em = now();
  return true;
end;
$$;

-- A correção do gerente: desfaz o ponto de uma chamada.
create or replace function fila_estornar(p_evento uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare e fila_evento%rowtype; v_meta uuid;
begin
  if not e_gerente() then raise exception 'Só o gerente desfaz.'; end if;
  select * into e from fila_evento where id = p_evento for update;
  if e.id is null or not e.penalizado or e.estornado_em is not null then return false; end if;
  update fila_evento set estornado_em = now() where id = e.id;
  select id into v_meta from negociador where perfil_id = e.perfil_id order by ativo desc limit 1;
  if v_meta is not null then
    update desempenho set perdeu_atendimento = greatest(0, perdeu_atendimento - 1), atualizado_em = now()
     where negociador_id = v_meta and competencia = date_trunc('month', e.dia)::date;
  end if;
  return true;
end;
$$;

/* O REPASSE. Quem passou a vez, ou deixou a chamada vencer, perde o
 * cliente para o próximo — e o atendimento é dele, então a RLS não deixa
 * outra pessoa mudar o negociador. Só vale para atendimento cuja
 * chamada terminou mal. */
create or replace function fila_repassar(p_atendimento uuid, p_para uuid, p_nome text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not e_equipe() then return false; end if;
  if not exists (select 1 from fila_evento where atendimento_id = p_atendimento and tipo = 'vez' and resposta in ('passou','expirou')) then
    return false;
  end if;
  update atendimento set negociador_id = p_para, negociador_nome = coalesce(nullif(btrim(p_nome), ''), negociador_nome)
   where id = p_atendimento;
  return found;
end;
$$;

revoke all on function fila_penalizar(uuid) from public;
revoke all on function fila_estornar(uuid) from public;
revoke all on function fila_repassar(uuid, uuid, text) from public;
grant execute on function fila_penalizar(uuid) to authenticated;
grant execute on function fila_estornar(uuid) to authenticated;
grant execute on function fila_repassar(uuid, uuid, text) to authenticated;

/* O QUE LIBERA É O BOTÃO. Até aqui "atendendo" acabava quando o status
 * virava um de fim (fechado, perdido…) — e o negociador que fechou o
 * carro ficava livre na fila com o cliente ainda na mesa assinando
 * papel. Desde a 0106 só o "encerrar atendimento" (atendimento_fim_em)
 * libera. Os de hoje que já tinham status de fim são dados por
 * encerrados agora, para ninguém ficar preso por um atendimento que já
 * terminou pela regra antiga. */
update atendimento set atendimento_fim_em = now()
 where data = (now() at time zone 'America/Sao_Paulo')::date
   and atendimento_fim_em is null
   and status::text not in ('cliente_na_loja','aberto','aguardando','aguardando_propostas','em_negociacao','baixar_expectativa');
