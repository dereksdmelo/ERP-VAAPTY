# Diagnóstico do sistema — 08/11/2026

Varredura só de leitura: nada foi alterado no código nem no banco. Os relatórios completos, com arquivo e linha de cada achado, estão em `diagnostico/` (00 a 09). Este arquivo é a leitura de gestor: o que importa e em que ordem resolver.

**Lacuna:** a auditoria de robustez dos handlers (limites de linhas, fire-and-forget, timeouts, N+1) foi interrompida pelo limite de uso e **não tem relatório**. Os achados de teto de 1.000 linhas do financeiro (`diagnostico/07`) cobrem parte dela. O resto está pendente.

## O que já está bom
- Todas as 66 tabelas têm RLS ligado, e o Security Advisor do Supabase não aponta erro (0 erros, 115 avisos, quase todos "função definer executável por anon").
- Nenhum segredo no repositório. A `SUPABASE_SERVICE_KEY` fica confinada ao Storage e à troca de senha, e a ordem "token do usuário primeiro, chave depois" está certa em todos os caminhos autenticados.
- Sem `eval`, sem SSRF, sem `dangerouslySetInnerHTML`. A TV da sala escapa tudo e não mostra dado de cliente.
- Funções da IA, do cache de placa e dos avisos a lojistas exigem segredo. O conserto do problema nº 1 abaixo é copiar esse padrão para as funções do WhatsApp.
- Fuso de hora de parede coerente na maior parte do código, sem float em dinheiro, 9 testes que leem a fonte e passam.

## Prioridade 0 — fazer primeiro

| # | Problema | Por que dói | Conserto | Onde |
|---|---|---|---|---|
| 1 | **Funções do WhatsApp no banco aceitam a chave anônima pública sem segredo** (`wa_receber`, `wa_receber_grupo`, `wa_estado`, `wa_numero`, `wa_canal_grupos`, `wa_canais_para_acordar`, `wa_lead_avanca`) | Qualquer pessoa injeta mensagem "do cliente", cria lead e agendamento falso e faz a Flávia responder a um número qualquer pelo WhatsApp da loja. O segredo da ponte só protege o caminho pelo Node, não o banco | `p_segredo` + `ia_chave_ok` nas 7 funções (o padrão já existe nas `ia_*`) | 01 A3, 02 #1, 09 #1 |
| 2 | **A IA ficou fora 5 dias sem ninguém saber** (29/10 a 03/11: 4.064 falhas "chave inválida") | Clientes da TV sem resposta. A tela dizia "respondendo". 401/403 é tratado como erro passageiro e a mesma mensagem é tentada a cada minuto | Tarja vermelha em Números do WhatsApp; aviso ao gerente pelo WhatsApp do adm na 3ª falha seguida; 401/403 pausa a fila até a chave mudar | 06 C1 |
| 3 | **HTML dos documentos sem escape** (`ou()` em ~70 pontos) **e o visor do gerente em iframe sem `sandbox`** | O nome do cliente pode vir do perfil do WhatsApp. Script no nome roda na origem do ERP e rouba a sessão de quem abre o documento (escalada negociador → gerente). Atinge também a página pública de assinatura | `escHtml()` em todo o bloco de documentos; `sandbox` no visor; servidor recusa `<script` e `on*=` | 01 A1, 05 A1 |
| 4 | **Transferência entre contas nunca funciona** | O ramo `transferir` está depois do POST genérico e fica inalcançável. Desde 19/10 nenhuma transferência banco → caixinha gravou | Mover o bloco para antes do POST genérico | 07 #1 |
| 5 | **Folha: salário com centavos é multiplicado por 100** ao focar e sair do campo | Grava R$ 151.875 no lugar de 1.518,75 e a "linha salva manda" | `defaultValue` com `centavosBR` e leitura por `numeroBR` | 07 #4 |
| 6 | **Títulos do contrato não nascem quando o negociador fecha o carro** | A RLS do financeiro recusa e o `catch {}` esconde. Só nascem quando gerente ou financeiro toca o carro | Função `security definer` estreita ou fila que o financeiro sincroniza; parar de engolir o erro | 07 #3 |
| 7 | **Teto de 1.000 linhas do PostgREST** em saldo, fluxo, fechamento, DRE de vários meses e rede 2 da importação | Com 4.290 lançamentos, saldo e "fica negativo em" saem errados sem aviso | Filtrar por data no servidor e paginar com `Range`, ou somar no banco | 07 #2 |
| 8 | **Publicação: `main` está 277 commits atrás e o workflow publica também em push para `main`** | Um merge ou PR "para fechar a migração" faz um hotfix velho sobrescrever a produção, sem erro em lugar nenhum | `branches: [cloudflare]` no workflow e proteger a branch | 08 C1 |
| 9 | **Sem registro de migrações aplicadas** (123 arquivos, 4 editados depois de criados) | Ninguém sabe o que está no banco | Migração `schema_migrations` e a convenção de cada migração nova se registrar | 08 C2 |
| 10 | **O CI não roda o teste que prova que o `index.html` transpila**, nem `node --check` nas rotas | Um erro de JSX ou de sintaxe vai ao ar e derruba o sistema inteiro | Colocar os 9 testes e o `--check` na Action | 08 A1, A2 |

## Prioridade 1 — esta semana ou a próxima

**Segurança e acesso**
- `checklist` (conta e PIX do cliente) é lido, alterado e apagado por qualquer login da equipe. Dá para trocar o PIX direto no PostgREST. (09 #2)
- `DELETE` em `veiculo` por qualquer login apaga em cascata o carro vendido, os custos e os recebimentos conciliados. Trocar `cascade` por `restrict` e liberar o delete só para o gerente. (09 #3)
- Estoque, custos e comprador são editáveis por toda a equipe, inclusive o `valor_venda` que paga a comissão. Mensagens, documentos, anexos e fotos também podem ser apagados por qualquer login. (09 #6, #7)
- `/api/atendimento?recurso=tatica` gasta a chave da Anthropic com qualquer `Bearer x`, e `/api/fipe` virou relé aberto, porque `tokenDe` só confere o formato do cabeçalho. `/api/importar` não confere papel. (02 #2, #4, #10)
- A assinatura eletrônica aceita hash, texto do aceite e evidências vindos do navegador, sem recalcular no servidor. O pilar de integridade hoje é uma declaração do signatário. (01 A2)
- O `PONTE_SEGREDO` dá acesso a `/_auth`, que devolve a sessão inteira do WhatsApp. Um segredo vazado equivale a clonar o número. (06 A6)
- DUT público: protocolo sequencial enumerável (placa, "o que falta" e rastreio dos Correios), criação sem limite, upload no Storage antes de conferir o token. (01 M2, M5; 02 #3, #5)
- Logout deixa o estado e o `localStorage` no aparelho: o próximo usuário abre dentro do atendimento do anterior. (05 A2)
- A renovação de sessão não é deduplicada. Com 4 chamadas paralelas e token vencido, a sessão válida cai. (05 A3)
- Sem cabeçalhos de segurança, e CDN sem versão fixa e sem `integrity`. O Babel é sempre a última versão, então um release ou um incidente do unpkg derruba o sistema inteiro sem nenhum commit. (01 M3, M4)

**Perda silenciosa de dado e de cliente**
- A transcrição é apagada ao "Retomar a escuta" depois de recarregar ou de abrir no outro aparelho. (04 #1)
- Primeira volta da sincronização sem base: a cópia velha do celular é enviada por cima da correção feita no computador. (04 #2)
- O check list grava o objeto inteiro, o mesmo defeito corrigido no bloco do cliente em 03/11. O último a salvar apaga o PIX do outro. (04 #7)
- Falha da ponte ou JSON fora do formato queima a mensagem do cliente para sempre. A reserva `redigindo` fica órfã quando o cron é interrompido. (06 A1, A4)
- Mídia sem limite de tamanho derruba o container da ponte em laço. (06 C2)
- O "Chegou" de uma visita de Recuperação não marca o lead como compareceu (recurso de hoje). A lista "Passou a hora" das Ações acende uma hora antes. (03 #1, #2)
- A Flávia confirma um horário fora da lista e a agenda não recebe nada. O leitor agenda frases como "você tinha agendado… e não veio?". (06 A2, A3)
- O descritivo do WhatsApp imprime R$ 2.850.050,00 para 28.500,50, e o pneu "Médio" volta como "Medio". (04 #3, #6)

**Financeiro**
- Baixa à mão faz o OFX duplicar quando a data do banco difere. A identificação automática no extrato não tem como desfazer. Apagar linha ligada a título perde o título. (07 #6 a #8)
- "Sem categoria" entra no lucro de três jeitos diferentes. A Rentabilidade da tela corta em 300 vendidos e o DRE conta 1.000. (07 #5, #9)
- Parcelamento perde centavos e pula de mês no dia 31. Juntar pessoas da folha apaga folhas gravadas. (07 #10, #11, #15)

**Operação**
- Sem alerta de falha nenhuma. Sem backup do Storage (o banco tem backup diário no plano Pro). Sem staging. Sem procedimento de rotação de segredos. (08 A4 a A6)

## Prioridade 2 — melhorias de robustez e manutenção
- **Entrega:** o `index.html` tem 1,78 MB (478 KB comprimido), é baixado inteiro a cada abertura e o Babel o transpila no celular. Passo 1: `no-cache` + ETag e resposta 304. Passo 2: pré-transpilar na Action, mantendo a fonte única. (08 A8)
- **Documentação:** o `CLAUDE.md` tem 350 KB, a decisão 67 aparece duas vezes, as 15 referências `index.html:NNN` conferidas estão todas erradas e há contradições: emLoja em 3 h ou 4 h, "ponte só escuta", "teto de 12 funções", Vercel. O `README.md` é do protótipo de agosto. O `PENDENCIAS.md` tem pelo menos 12 itens já resolvidos e cerca de 15 abertos que não estão lá. (08 A9, M1, M2)
- **Uma regra, um lugar:** semanas da casa (4 cópias), `hojeAqui` (8), regras de "esperando resposta", etapa do lead, origem por canal (3 mapas diferentes), leitura de número (5 regras). (03, 04, 07, 08)
- **Banco:** índice único em `veiculo(atendimento_id)` (já existe 1 duplicado), índices nas FKs de joins frequentes, `check` em valores e estados, `agendado_para` como `timestamp` sem fuso, colunas de auditoria que ninguém grava, `search_path` com `pg_temp`, políticas sem `to authenticated`. (09 #13 a #23)
- **Dívida de tela:** 119 `catch` vazios, `VaaptyAponte` com 3.098 linhas num único `<script>`, 8 efeitos de carga sem guarda `vivo`.
- **Produto:** feriados (a Flávia oferece 20/11, 25/12 e 01/01), lembretes que o prompt promete e não existem, o lembrete do Meu dia ignora o horário da loja, o `<Pendente>` de Números diz que a ponte "só escuta".

## Dados do banco que merecem atenção agora
- 229 leads agendados em outubro, com hora no passado e sem desfecho.
- 534 dos 595 carros vendidos sem `vendido_em`.
- 4 carros de novembro sem valor de compra.
- 271 atendimentos dos últimos 90 dias sem negociador (em novembro: 0 de 64).
- 60 de 193 documentos sem conteúdo gravado.
- Tabela `ERPVAAPPTY` vazia, que pode ser apagada.
- O número "negociadores" ainda está como `comercial` e sem telefone. Para a caixa de negociação funcionar, marque o uso como "Negociação" e leia o QR.
- 1 par de fichas duplicadas no mesmo atendimento.

## Sugestão de ordem de execução (cada passo é pequeno)
1. Um commit só com o workflow (`branches`, testes e `node --check` na CI). Zero risco.
2. Migração `0124`: segredo nas 7 funções `wa_*`, junto com o ajuste das chamadas no Node e no cron. Fazer e testar com cuidado.
3. Alerta da IA e pausa da fila em 401 (só ia/atender.js e a tarja de Números).
4. `escHtml` nos documentos e `sandbox` no visor.
5. Os três bugs de dinheiro que já estão provados: transferência, centavos da folha e `brlC` do descritivo.
6. Migração de RLS: `checklist`, `delete` de veiculo/mensagem/documento e `update` de estoque.
7. Paginação com `Range` no `supa()` do financeiro.

Posso executar na ordem acima, um passo por vez, com você aprovando cada um.

---

## Situação das correções (feitas em 08/11/2026, ainda sem publicar)

**Já aplicado no banco de produção** (aditivo ou conferido):
- `0124` sobrecargas das 7 funções `wa_*` com `p_segredo` (as antigas continuam abertas até o passo 3 abaixo).
- `0125` acessos mais estreitos: `checklist` (dono, adm, financeiro, gerente), `delete` de veículo, documento, conversa e mensagem só do gerente, cascatas `estoque.veiculo_id` e `fin_recebimento.estoque_id` trocadas por `restrict`.
- `0126` tabela `schema_migrations` com as 126 migrações registradas.

**Corrigido no código, esperando publicação:**
- Workflow só publica a branch `cloudflare`; CI roda os 8 testes, a sintaxe do `index.html` e `node --check` de api/worker/ia/regras.
- Segredo nas chamadas `wa_*` (Node, cron, ponte, despertador).
- Escape do HTML dos documentos (`escDoc`), `sandbox` no visor, servidor recusa `<script`/manipuladores.
- Transferência entre contas (ramo inalcançável), centavos da Folha, `brlC` do descritivo, `numeroBR` no Shinkai, pneu "Médio".
- IA: pausa a fila em 401/403/5xx, não queima a mensagem quando a ponte cai, `max_tokens` 1200; tarja vermelha em Números do WhatsApp.
- `supa()` do financeiro pagina além de 1.000 linhas.
- Parcelamento: centavos na última parcela e dia 31.
- `tatica` e `fipe` validam o token no banco; `importar` só gerente; `/api/constructor` e erro cru do Worker.
- Renovação de sessão sem corrida; logout limpa atendimento aberto e tela; transcrição não é apagada ao retomar a escuta (guarda começo e fim).
- "Chegou" de visita de Recuperação marca o lead como compareceu; "Passou a hora" deixa de acender uma hora antes.

**Passo 3 da 0124 (depois de publicar):** trancar as funções `wa_*` antigas, com os `revoke` que estão comentados no fim de `0124_wa_exige_segredo.sql`.

**Não feito (precisa de decisão ou é maior):**
- Títulos do contrato quando o negociador fecha (precisa de função estreita no banco).
- Sincronização com base guardada no aparelho (achado 2 do atendimento), check list gravando campo a campo, `estoque` editável só pelo financeiro (quebra `puxarDoChecklist`).
- Mídia sem teto na ponte (exige republicar a ponte), `/_auth` com segredo próprio, assinatura recalculando hash no servidor.
- DUT público (segundo fator, limite), cabeçalhos de segurança, versões fixas e `integrity` dos CDNs, ETag, pré-compilação.
- Backup do Storage, staging, alerta ativo por WhatsApp, reescrita de CLAUDE.md/README/PENDENCIAS.
- Achados de robustez dos handlers (auditoria interrompida).
