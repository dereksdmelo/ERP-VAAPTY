# Relatório: pré-vendas e WhatsApp (agente, 08/11/2026)
Testes: quadro 48 ok, agendamento 27 ok; escopo acusa setCats (FinLancamentos, falso positivo novo do hook useCategoriasFin) — lista do CLAUDE.md desatualizada (setComp não é mais acusado).

ALTO
1. "Chegou" de visita de Recuperação não marca compareceu: api/atendimento.js:1866 devolve ja_existia quando atual.atendimento_id existe, sem PATCH de status/nome/carro, sem aviso no grupo, sem registrarNaFila. O lead de recuperação (08/11) nasce com atendimento_id → fica AGENDADO para sempre, vira "veio?", nunca conta como veio, Ações cobram eternamente; leadQueVeio também não corrige (filtra atendimento_id=is.null). Conserto: fazer o PATCH mesmo com atendimento_id.
2. Ações "Passou a hora e ninguém marcou" dispara 1 h ANTES: api/atendimento.js:3034-3035 compara agendado_para (parede rotulada UTC) com instante real −2h → folga real −1h. Terceira cópia da regra da armadilha +3 (decisão 51). Conserto: comparar texto com texto como jaPassou (index.html:15798) ou helper agoraParede() único.

MÉDIO
3. Ligar lê window.storage.get como síncrono (index.html:16887): `de` vira Promise; "lembra a última escolha" (decisão 52) nunca funcionou.
4. Lead "Já vendeu" guarda agendado_para (17818-17826, 18057-18063); funil continua contando como agendado (funil.js ~262); "voltar para a fila" (16611) volta com hora velha. Servidor deve zerar e gravar remarcacoes {de, perdido:true}.
5. "Esperando resposta" com duas regras: funil.js:253 ignora lida_em/nao_lida (0105) vs conversaEsperando (atendimento.js:1243).
6. Caixa de Conversas lê só 60 (atendimento.js:3395; tela não manda limite, 1023) e "Não respondidas" só entre elas; "Todas 60" parece total. Filtro esperando=1 no servidor + carregar mais.
7. Busca do quadro engole erro (17260, 17264 catch vazio) e diz "Nada com esse nome" → cria duplicado.
8. Equipe que falha ao carregar (16539 catch vazio) deixa "Chegou" mudo (select vazio, botão apagado sem explicação).
9. Três "não veio" diferentes: grade 18425 e Ações 16466 zeram confirmado_em; lista fora da semana (18580/18622) não zera e pergunta quando voltar. Servidor deve zerar confirmado_em/por no ramo nao_compareceu.
10. Etapa do lead em dois vocabulários: ESTAGIO (10379, Conversas) vs etapaDoLead (16873); SEL do servidor (3458) não devolve origem/proximo_contato.
11. Origem derivada do canal: três mapas fixos diferentes no servidor (2880, 3293, 3325); canal novo vira "outro". Deveria ser coluna wa_canal.origem.
12. Enter duplo cria lead duas vezes (17849-17858 sem guarda de salvando; 17209-17216); dedupe só por telefone.
13. Agenda da semana falha calada em vieram/fluxo (18209, 18214) → "0 vieram".

BAIXO
14. AtendimentoDaConversa.agendar grava volta_em com catch vazio (10631).
15. horaCurta usa fuso do navegador (28097-28101) vs diaDaMensagem SP.
16. maisDias/semanaDe dependem do fuso local (15842-15844, 18192-18199).
17. Rollback de "marcar lida" não restaura nao_lida (10965-10970).
18. Agendar das Ações/Conversa/remarcar não limpa proximo_contato (16528, 10749, 18602/18609).
19. Prévia das conversas com teto ids*8 (3410): grupo movimentado rouba a prévia das outras.
20. <Pendente> em Números do WhatsApp diz que a ponte "só ESCUTA" (11640) — falso desde 22/10.
21. registrarLigacao com falha engolida em 16522, 17790, 18596 — a contagem de calls mente para menos.
22. Telefone em query string (10611 do-telefone&tel=, 1024 busca=, lead q=) → logs do Cloudflare. POST.
23. Efeitos da semana sem flag vivo (18209-18214).
24. PorQueExcluir.aoExcluir sem try (17807-17811).
25. NovaConversa aceita 12/13 dígitos sem conferir 55 (1072 vs 3195); acao=nova não confere uso do número.
26. −3h hardcoded em index.html:15795 e api/atendimento.js:2748, 2777 (+ o do achado 2).
27. ferramentas-escopo falsos positivos desatualizados.

Sem problema: Chegou nos 3 caminhos → JanelaChegou → compareceu idempotente; remarcacoes em todo "não veio"; !inner ok; gatilho wa_resposta_le existe; TelaConversas com key por área; pollings com vivo+clearTimeout; arrasto com fallback; ESC por z-index; jaPassou por parede; "veio?" só depois da hora; horários de config_loja; CONFIG_LOJA_PADRAO igual nas 3 cópias; nenhum componente dentro de componente.
Tabela "regra em dois lugares": etapa do lead (diferente Conversas×quadro), já passou (diferente, bug), esperando (diferente atendimento.js×funil.js), chave de telefone (igual, 4 cópias), horários (igual, 3 cópias), origem por canal (3 mapas diferentes), fora da região (diferente, documentado), hoje (igual, hojeEmSP 574 e hojeSP 27072 duplicados), sair de agendado derruba data (quadro sim p/ Novo/Agendar; servidor não).
