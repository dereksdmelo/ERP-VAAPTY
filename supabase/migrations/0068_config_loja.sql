-- A CONFIGURACAO DA LOJA E DA IA DE ATENDIMENTO (17/10/2026)
--
-- A Vaapty vai trocar a Ana e a Camila (Intermedicar) por uma IA
-- propria, a Flavia. O Derek decidiu no mesmo dia: *a loja abre 8h30
-- mas os agendamentos comecam as 9h; sabado se atende das 9h as 13h;
-- o nome da IA e os horarios precisam ser configuraveis, sem deploy*.
-- Ver ia/base-atendimento-lead.md, secao 7.
--
-- **Uma linha so, e e por isso que `id` e travado em 1.** Isto e a
-- configuracao de UMA loja; duas linhas obrigariam toda leitura a
-- decidir qual vale, e a resposta erraria no dia em que alguem
-- inserisse a segunda.
--
-- **Abrir e agendar sao colunas diferentes.** A loja abre as 8h30
-- para quem passar; o primeiro horario marcado e 9h, para a equipe
-- estar pronta quando o agendado chega. Uma coluna so faria a IA
-- mentir numa das duas frases ("a loja abre as..." e os horarios
-- oferecidos) -- o desencontro entre a Ana e a Camila.
--
-- **Tres grupos iguais (seg-sex, sabado, domingo), e dia fechado e
-- `primeiro` nulo.** Domingo nasce fechado; abrir um domingo e
-- preencher as tres colunas, sem migracao nova. O check exige o grupo
-- inteiro ou nada: horario de primeiro sem ultimo e configuracao que
-- nenhuma tela sabe ler.
--
-- **E o agendador da tela le daqui tambem** (decisao 59 do CLAUDE.md).
-- O `HORARIOS` fixo oferecia 9h-18h todos os dias, inclusive sabado as
-- 16h com a loja fechada. Se a IA e a tela lerem de lugares
-- diferentes, a pre-venda e a Flavia marcam em horarios que a outra
-- nao oferece.

create table if not exists config_loja (
  id smallint primary key default 1 check (id = 1),

  ia_nome text not null default 'Flávia' check (length(btrim(ia_nome)) between 1 and 40),

  semana_abre     time,
  semana_primeiro time,
  semana_ultimo   time,

  sabado_abre     time,
  sabado_primeiro time,
  sabado_ultimo   time,

  domingo_abre     time,
  domingo_primeiro time,
  domingo_ultimo   time,

  intervalo_min int not null default 30 check (intervalo_min between 10 and 120),

  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references perfil(id),

  constraint config_loja_semana check (
    (semana_abre is null and semana_primeiro is null and semana_ultimo is null)
    or (semana_abre is not null and semana_primeiro is not null and semana_ultimo is not null
        and semana_primeiro <= semana_ultimo)),
  constraint config_loja_sabado check (
    (sabado_abre is null and sabado_primeiro is null and sabado_ultimo is null)
    or (sabado_abre is not null and sabado_primeiro is not null and sabado_ultimo is not null
        and sabado_primeiro <= sabado_ultimo)),
  constraint config_loja_domingo check (
    (domingo_abre is null and domingo_primeiro is null and domingo_ultimo is null)
    or (domingo_abre is not null and domingo_primeiro is not null and domingo_ultimo is not null
        and domingo_primeiro <= domingo_ultimo))
);

comment on table config_loja is
  'Uma linha: nome da IA de atendimento e horarios da loja. A IA e o agendador da pre-venda leem daqui.';
comment on column config_loja.semana_abre is
  'Hora em que a loja abre de segunda a sexta. Diferente do primeiro agendamento.';
comment on column config_loja.semana_primeiro is
  'Primeiro horario oferecido para agendamento, seg-sex. Nulo = fechado.';
comment on column config_loja.intervalo_min is
  'Minutos entre um horario oferecido e o seguinte.';

-- Os valores de 17/10/2026. `on conflict do nothing`: rodar de novo
-- nao desfaz o que o gerente ja editou.
insert into config_loja (id, ia_nome,
  semana_abre, semana_primeiro, semana_ultimo,
  sabado_abre, sabado_primeiro, sabado_ultimo,
  intervalo_min)
values (1, 'Flávia',
  '08:30', '09:00', '18:00',
  '09:00', '09:00', '13:00',
  30)
on conflict (id) do nothing;

alter table config_loja enable row level security;

-- A equipe le: o agendador abre para quem faz pre-venda e para o
-- negociador. So o gerente escreve, como a meta da loja (0018).
drop policy if exists config_loja_leitura on config_loja;
create policy config_loja_leitura on config_loja
  for select to authenticated using (e_equipe());

drop policy if exists config_loja_gerente on config_loja;
create policy config_loja_gerente on config_loja
  for all to authenticated using (e_gerente()) with check (e_gerente());
