-- =====================================================================
-- 0052 — Ouvir a mesa: o combinado da chamada
--
-- O gestor aperta "ouvir" e o áudio sai do celular do negociador
-- direto para o computador dele (WebRTC). **O som não passa por este
-- banco, nem pela Vercel, nem pelo Storage** — o que trafega aqui é só
-- o combinado da chamada: "quero ouvir, este é o meu endereço" de um
-- lado, "pode vir, este é o meu" do outro.
--
-- **Isso é o que mantém a frase do aceite verdadeira.** O cliente ouve
-- que o áudio não fica guardado depois (decisão 45); com o som indo de
-- ponta a ponta, não existe lugar onde ele pudesse ficar. Quem trocar
-- isto por áudio passando pelo servidor está desfazendo a promessa, e
-- aí volta a conversa com o jurídico.
--
-- **Sem trickle ICE, de propósito.** O jeito completo manda os
-- endereços candidatos aos pingos, conforme são descobertos, e exigiria
-- duas filas a mais aqui e polling nos dois lados. Esperar a descoberta
-- terminar e mandar tudo dentro do SDP custa uns dois segundos a mais
-- na conexão e derruba metade das peças móveis. São duas colunas de
-- texto, e é tudo.
--
-- **Uma sessão por vez, e ela morre.** O índice parcial garante que
-- não há duas abertas no mesmo atendimento — dois gestores pedindo ao
-- mesmo tempo fariam o celular responder a oferta errada.
-- =====================================================================

create table escuta_sessao (
  id uuid primary key default gen_random_uuid(),
  atendimento_id uuid not null references atendimento(id) on delete cascade,

  -- Quem pediu para ouvir. Nome não: quem ouviu a conversa de um
  -- cliente é pergunta que se responde com identidade, não com texto.
  --
  -- **`default auth.uid()`, e não um `select` no servidor.** Descobrir
  -- "quem sou eu" consultando `perfil` com `limit 1` já pôs OUTRA
  -- pessoa no campo uma vez (0047, a agenda). Quem sabe a resposta é o
  -- banco, que tem o token na mão.
  gestor_id uuid not null default auth.uid() references perfil(id),

  -- O combinado da chamada. `oferta` é escrita por quem pede;
  -- `resposta`, pelo aparelho que tem o microfone.
  oferta   text,
  resposta text,

  -- Por que não deu. Microfone ocupado pela transcrição, permissão
  -- negada, aparelho sem suporte: o gestor precisa LER isso, senão
  -- fica olhando para um botão que não acontece.
  erro text,

  criado_em    timestamptz not null default now(),
  encerrado_em timestamptz
);

comment on table escuta_sessao is
  'O combinado de uma chamada de áudio ao vivo entre o gestor e o aparelho do negociador. O som vai ponta a ponta e não passa por aqui.';

create unique index escuta_sessao_uma_aberta_idx
  on escuta_sessao (atendimento_id) where encerrado_em is null;

-- ---------------------------------------------------------------------
-- Quem pode o quê
--
-- Mesma régua da `negociacao_viva` (0033): o gerente e o dono do
-- atendimento, e mais ninguém. Ouvir a mesa do colega não é o que esta
-- tabela existe para permitir.
-- ---------------------------------------------------------------------
alter table escuta_sessao enable row level security;

create policy escuta_sessao_le on escuta_sessao
  for select to authenticated using (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = escuta_sessao.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)
    )
  );

-- Pedir para ouvir é do gerente, e `gestor_id` é conferido contra o
-- próprio token: sem isso alguém abre sessão assinada por outro.
create policy escuta_sessao_pede on escuta_sessao
  for insert to authenticated with check (
    e_gerente() and gestor_id = auth.uid()
  );

-- Responder é do aparelho que tem o microfone; encerrar é dos dois.
create policy escuta_sessao_responde on escuta_sessao
  for update to authenticated using (
    e_gerente() or exists (
      select 1 from atendimento a
       where a.id = escuta_sessao.atendimento_id
         and (a.negociador_id = auth.uid() or a.negociador_id is null)
    )
  ) with check (true);
