# Relatório: segurança da API (agente, 08/11/2026)

ALTO
1. RPCs da ponte executáveis pela chave anônima (pública via ?recurso=config): wa_receber (0055:106-109), wa_receber_grupo (0104:67), wa_numero (0056:52), wa_lead_avanca (0098:193), wa_canais_para_acordar (0072:32), wa_estado. Sem p_segredo. Externo injeta mensagem falsa em conversa real e a Flávia responde ao cliente real; cria lead e agendamento falso (agenda + TV); troca telefone de canal. ia_*/placa_cache_*/lojista_aviso_*/tv_* fazem certo com ia_chave_ok(p_segredo). Conserto: p_segredo nas sete; o handler da ponte e o despertador já têm o segredo.
2. ?recurso=tatica (api/atendimento.js:288-310) gasta a chave da Anthropic com qualquer "Bearer x": tokenDe só confere formato (:30-33) e a rota nunca vai ao banco. Proxy de LLM anônimo pago pela Vaapty. Conserto: leitura barata pelo token antes (perfil?select=id&limit=1) ou ler a transcrição do banco.

MÉDIO
3. dut-anexo (api/foto.js:1082-1140) grava no Storage com a chave de serviço ANTES de conferir o token do pedido (:1116 upload, :1125 dut_anexar confere). Anônimo escreve 10 MB por chamada; se o DELETE falhar fica órfão (:1137 catch vazio). Conferir token antes (RPC dut_token_ok).
4. /api/importar não confere papel no servidor (importar.js:101-123): qualquer login da equipe insere 500 linhas por chamada em atendimento/veiculo/proposta. Tela esconde, servidor não. Conferir gerente como atendimento.js:3517.
5. dut_estado enumerável (protocolo sequencial) devolve placa, pendência livre e rastreio dos Correios (0090; checklist.js:661-669), sem rate limit. Segundo fator barato + mascarar rastreio + limite por IP.
6. Mensagens cruas do PostgREST/Storage voltam ao navegador em ~30 catches (atendimento.js:197-216, 3674-3719, 3905; checklist.js:344-357, 1098-1121, 1197; financeiro.js:3017; funil.js:347; fipe.js:284; foto.js:78-93, 1642; veiculo.js:864, 949; documento.js:507, 608, 790). Nomes de política/constraint/coluna e PGRST100 com a query refletida. Traduzir code→frase fixa; detalhe só no console.error.
7. ?recurso=zapsign (documento.js:191-260): conteúdo/PDF/signatários vêm 100% do corpo; qualquer login manda documento arbitrário a qualquer e-mail/telefone pela conta ZapSign da Vaapty (phishing com a marca; custo). Gerar PDF no servidor ou exigir signatário = cliente do atendimento + papel.

BAIXO
8. /api/constructor pendura a requisição para sempre (worker/index.js:77,105: ROTAS["constructor"] === Object; `espera` nunca resolve). Object.hasOwn + Promise.race com timeout 504.
9. Exceção não tratada devolve e.message cru (worker/index.js:149,151).
10. /api/fipe é relé anônimo: tokenDe só confere formato (fipe.js:77-80,162).
11. Busca sem encodeURIComponent em atendimento.js:1776-1777, :3832 e checklist.js:1005 (& % # + injetam parâmetros no PostgREST / PGRST100).
12. Sem rate limit em webhooks/rotas públicas; webhook ZapSign amplifica chamada autenticada ao ZapSign por POST anônimo; dut_criar em laço; ?nova=1 em /api/placa fura o cache e queima as 20 consultas com UMA placa.
13. Corpo lido inteiro (worker/index.js:43 sem teto) e base64 decodificado antes do limite (foto.js:1102-1108, 1201-1207, 1245-1251, 880-886, 1016-1018; documento.js:230) → 100 MB derruba a instância (Error 1102).
14. SUPABASE_SERVICE_KEY carregada em documento.js:17 e veiculo.js:18 só para limpar() — quatro arquivos em vez dos dois documentados.
15. marcar_contrato_assinado(tok) anon-callable: quem tiver o doc token (mostrado à equipe) carimba "assinado" sem o ZapSign.

Conferido e correto: token nunca em variável de módulo; checagens de gerente/adm/financeiro no servidor nos lugares listados (wa, flavia, fila, unificar, senha/pessoa, vistos, esteira, transferências, DUT fila, exclusão de documento); IP de cf-connecting-ip; sem eval/redirect/SSRF; sem console.log de segredo; in.()/eq. validados; viva limita transcrição 120 KB e ficha 600 KB; 405 com Allow; ordem token→Storage respeitada em todos os caminhos autenticados do foto.js e perfil.js.
