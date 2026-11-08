# Conferência do banco em produção (08/11/2026, só leitura, via painel Supabase)

## Estrutura
- 67 tabelas em public, TODAS com RLS ligado. 3 sem política alguma (trancadas, acesso só por função): ERPVAAPPTY, servidor_chave, placa_cache.
- ERPVAAPPTY: 0 linhas, colunas id bigint + created_at. Lixo de criação pelo painel. Pode apagar.
- 0 colunas `timestamp without time zone` — tudo timestamptz. Bom.
- 55 funções SECURITY DEFINER; TODAS têm search_path fixado; TODAS executáveis por `anon` (padrão do Supabase: EXECUTE para public). Lista: abrir_link_assinatura, agenda_ultimo_sinal, ao_criar_usuario, ao_mudar_email, criar_link_assinatura, dut_anexar, dut_criar, dut_estado, e_adm, e_equipe, e_financeiro, e_gerente, fila_estornar, fila_penalizar, fila_repassar, fin_anota_mudanca, gravar_assinatura, gravar_resumo_ia, ia_chave_ok, ia_concluir, ia_contexto, ia_fila, ia_gravar_leitura, ia_lead_gravar, ia_leads_para_ler, ia_liberar, ia_midias, ia_reservar, ia_retomada_da_conversa, ia_retomada_gravar, ia_retomada_proximo, lead_marca_agendou, limpar_senha_provisoria, lojista_aviso_gravar, lojista_aviso_proximo, marcar_contrato_assinado, marcar_contrato_lojista_assinado, marcar_feedback_lido, negociadores_com_login, papel_atual, placa_cache_gravar, placa_cache_ler, proximo_recibo, tv_agenda, tv_painel, unificar_atendimentos, verificar_assinatura, wa_canais_para_acordar, wa_canal_grupos, wa_estado, wa_lead_avanca, wa_numero, wa_receber, wa_receber_grupo, wa_resposta_le.
  → cada uma precisa conferir algo (segredo/token/auth.uid()/papel). As que NÃO conferem são buraco com a chave anônima (ver relatório páginas públicas A3: wa_receber, wa_numero, wa_lead_avanca, wa_estado, wa_receber_grupo, wa_canais_para_acordar).
- Políticas "check true": só 2 (mensagem.mensagem_marca_lida, escuta_sessao_responde), ambas com USING restritivo — ok.
- FKs sem índice (~45): checklist.adm_conferido_por, anexo.enviado_por, negociador.perfil_id, estoque.atendimento_id, estoque.comprador_id, fin_lancamento.categoria_id, fin_lancamento.funcionario_id, lead.negociador_id, lead.atendimento_id, lead.indicacao_id, wa_conversa.atendimento_id, wa_conversa.lead_id, agenda.atendimento_id, dut_pedido.*_por, … Baixo impacto hoje (tabelas pequenas), mas estoque.atendimento_id, lead.atendimento_id, wa_conversa.lead_id e fin_lancamento.categoria_id entram em joins frequentes.
- Security Advisor do Supabase: 0 erros, 115 warnings, 6 info (lista dos warnings a ler).

## Volume
- 59 MB total. wa_mensagem 21 MB/49.636; fin_lancamento 4.290; wa_conversa 2.289; ia_falha 4.145 (1,5 MB); documento 193 (1,1 MB — conteúdo HTML); lead 1.673; negociacao_viva 255 (ficha 0,5 MB; transcrição ~0); agenda 2.047; foto 1.523; fin_favorecido 1.147; veiculo 1.089; estoque 670; atendimento 615 (90 d).
- perfis 16 (14 ativos, 5 gerentes ativos); auth.users 16.

## Integridade dos dados
- veiculo com atendimento_id repetido: 1 par (não há índice único). 624 veículos sem atendimento (importados/antigos).
- estoque: 0 duplicado por veiculo_id. Situações: em_estoque/vendido/baixado. 595 vendidos, 534 SEM vendido_em (89,7%: só 61 com data). 4 carros de novembro sem valor de compra. 3 custos de vendidos sem realizado.
- atendimentos sem negociador (id e nome vazios) nos últimos 90 d: 271 de 615 — concentrados em facebook/aberto=104, fluxo_loja/aberto=35, outro=20, google=16… Em NOVEMBRO: 0 de 64 (o problema é do passado/importação; hoje está certo).
- leads agendado/confirmado com hora marcada no passado (>1 dia) sem desfecho: 229 de 1.673, TODOS de 2026-10 (outubro inteiro ficou sem "veio/não veio"). Leads sem telefone: 0. Excluídos: 24.
- documento: 60 de 193 sem conteúdo (impressos antes da ficha existir).
- fin_lancamento efetivado sem categoria desde 01/10: 3. Títulos em aberto: 81.
- fotos sem hash: 1.497 de 1.523 (esperado: hash só desde 07/11).

## Incidente achado: a IA ficou 5 dias fora sem ninguém saber
- ia_falha: "IA 401 invalid x-api-key" de 29/10 20:59 a 03/11 17:41 — 29/10=6, 30/10=646, 31/10=649, 01/11=222, 02/11=842, 03/11=1699 (≈4.064 tentativas). Mais 49 "IA 403 Request not allowed" no mesmo intervalo.
- A fila tentou a mesma mensagem a cada minuto durante dias (sem backoff, sem marcar a mensagem como falha definitiva) e NENHUM aviso chegou a ninguém (só console.error do Worker). Clientes da TV ficaram sem resposta por ~5 dias.
- Última resposta da Flávia: 06/11 14:41. (Verificar se há cliente sem resposta desde então.)

## erro_tela (o que quebrou na tela, por ocorrência)
- 8x tela estoque: ContratoDoLojista rep_nome de null (07/11) — corrigido em 07/11.
- 8x tela leads + 3x pv_perdidos: "TypeError: c is not a function" (03–04/11) — causa não identificada no CLAUDE.md; conferir se ainda ocorre.
- 1x lojistas: setZap is not defined (05/11) — corrigido.
- 1x pv_agenda: doDia is not defined (28/10).

## Complementos
- Security Advisor (Supabase): "Public Can Execute SECURITY DEFINER Function" = 55 (todas); "Function Search Path Mutable" = 2 (toca_atualizado_em, sem_acento_maiusc); "RLS Policy Always True" = 2 (escuta_sessao, mensagem — ok, USING restringe).
- Conferência local (migrações, última versão de cada função) das DEFINER que NÃO conferem credencial nenhuma: wa_receber, wa_receber_grupo, wa_estado, wa_numero, wa_canal_grupos, wa_canais_para_acordar, proximo_recibo (qualquer anon consome numeração de recibo), dut_estado e verificar_assinatura (públicas por desenho), marcar_contrato_* (o token é a credencial — ok), ao_criar_usuario/ao_mudar_email/wa_resposta_le (triggers).
- Canais WhatsApp (wa_canal): administrativo-da-loja (operacao), ana, camila, loja (sem telefone — nunca ligou), negociadores (uso ainda 'comercial', sem telefone — o número da negociação não foi ligado nem marcado como 'negociacao'), prospeccao-ativa (IA responde), tv (IA responde). ia_retoma desligado em todos.
- Flávia: respostas por dia 03/11=7 04/11=15 05/11=15 06/11=5; nada desde 06/11 14:41; última mensagem de cliente no canal tv: 05/11 17:33. Nenhuma conversa de IA sem resposta (as 2 candidatas foram respondidas no mesmo minuto).
- Plano Supabase: PRO (badge no painel) — backup diário do banco incluso; o Storage NÃO entra no backup. Storage: fotos-veiculo 1.523 arquivos/386 MB; documentos-veiculo 3.656/779 MB (inclui wa/ mídia). Ambos privados.
- pg_stat_statements: nada anômalo; o topo é set_config do PostgREST e storage.objects.
- Índices únicos existentes: checklist(atendimento_id), estoque(veiculo_id), fin_funcionario(lower(nome)), fin_lancamento(conta_id,chave_extrato), fin_lancamento(conta_fixa_id,competencia) parcial, fin_lancamento(estoque_id,item_contrato) parcial, foto(veiculo_id,ordem), foto hash. atendimento: NENHUM. veiculo(atendimento_id): NENHUM (1 duplicado já existe).
- CDNs no index.html:10-13: tailwind sem versão, react@18/react-dom@18 flutuantes, @babel/standalone SEM versão. Nenhum escape de HTML no index.html (único `esc` é de CSV, 18957).
