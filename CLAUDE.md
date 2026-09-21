# CLAUDE.md

Orientação para o Claude Code trabalhar neste repositório.

## O que é

A Vaapty compra carros de pessoa física e repassa para uma rede de
lojistas. Este sistema é a ferramenta que o negociador usa no celular
durante o atendimento presencial: consulta a placa, monta a ficha do
veículo, registra as rodadas de negociação e gera as duas saídas que
alimentam a rede — o descritivo do WhatsApp e o JSON do Shinkai.

Em produção-leve. Uma página estática mais doze funções de servidor na
Vercel, com login por papel e Postgres no Supabase. Desde 16/09/2026 o
atendimento inteiro sincroniza entre o celular e o computador do
negociador (decisão 44); o que ainda depende de um botão é o bloco de
dados do cliente — ver PENDENCIAS.md.

```
index.html                       aplicação inteira (React 18 + Babel via CDN, sem build)
api/placa.js                     GET  — Placa Fipe: ?placa=, ?acao=cota, ?acao=desvalorizacao
api/veiculo.js                   POST /api/veiculo — grava a ficha · GET — as 20 últimas
api/foto.js                      POST/GET/PATCH/DELETE — imagens no Storage
api/documento.js                 POST/GET — registro dos documentos gerados
api/perfil.js                    GET  — quem sou eu; para gerente, a equipe
                                 ?recurso=config — URL e chave anônima (sem login)
api/financeiro.js                área restrita: lançamentos, DRE, carros, folha
api/atendimento.js               GET/POST/PATCH — a lista do CRM
                                 ?recurso=indicacoes — os leads da etapa E
                                 ?recurso=lead — pré-vendas e agendamentos
api/proposta.js                  GET/POST/PATCH/DELETE — ofertas dos lojistas
api/funil.js                     GET  — a aba PIPELINE: fluxo → venda por origem
api/importar.js                  POST — traz a planilha do CRM para o banco
api/fipe.js                      GET  — tabela FIPE oficial, para conferência
api/checklist.js                 GET/PUT — o check list digital do negócio
documentos.js                    CÓPIA MORTA: o que roda é o bloco colado no index.html
supabase/migrations/*.sql        esquema do banco, versionado
PENDENCIAS.md                    o que está em aberto e o que destrava cada coisa
```

Sem `package.json`, de propósito: nenhuma função usa biblioteca. O
Supabase é chamado pela API REST (PostgREST) com `fetch`. Manter assim
— dependência nova precisa de uma boa razão.

**Teto de 12 funções.** O plano Hobby da Vercel não aceita mais que isso
por deploy, e o build **falha inteiro** quando passa — foi o que
aconteceu com o arquivo 13. **Hoje são 12 — o teto.** Antes de criar arquivo novo
em `api/`, conte.** O corte que funcionou foi juntar por fonte: tudo que
fala com a Placa Fipe mora em `api/placa.js`, atrás de `?acao=`.

## Rodar e publicar

```bash
vercel dev
```

```bash
vercel --prod
```

Três variáveis de ambiente (Vercel → Settings → Environment Variables,
e um `.env` local para o `vercel dev`):

| variável | usada por |
|----------|-----------|
| `PLACAFIPE_TOKEN` | `api/placa.js` (placa, cota e desvalorizômetro) |
| `SUPABASE_URL` | todas as funções de dados |
| `SUPABASE_ANON_KEY` | `api/config.js` e as chamadas ao banco |
| `SUPABASE_SERVICE_KEY` | só `api/foto.js`, e só para o Storage |
| `ANTHROPIC_API_KEY` | `api/atendimento.js?recurso=tatica` — opcional; sem ela a leitura por IA fica desligada e as táticas por expressão seguem |
| `IA_MODELO` | opcional; padrão `claude-haiku-4-5-20251001`. Trocar de modelo não precisa de deploy |
| `IA_JANELA` | opcional; padrão 2500 caracteres do fim da conversa. É o que se paga por leitura |
| `SHINKAI_API_KEY` | `api/foto.js?recurso=shinkai` — sem ela o envio ao Shinkai fica desligado e a tela cai no JSON copiado |
| `SHINKAI_ORIGEM` | opcional; padrão `vaapty-joinville` |
| `TURN_URL`, `TURN_USUARIO`, `TURN_SENHA` | opcionais; o retransmissor de áudio para quando a conexão direta do "ouvir a mesa" não fecha (decisão 45). Sem elas vai só o STUN, que resolve a maioria das redes — e a tela diz quando não resolveu |

**Nenhuma delas, fora a anônima, pode chegar ao navegador** — é essa a razão de as
funções em `api/` existirem em vez de o `index.html` chamar os serviços
direto. A chave de serviço do Supabase é a mais grave: ela passa por
cima do RLS, então quem a tiver lê e escreve a tabela inteira. Em
`api/veiculo.js` todo texto que volta ao cliente passa por `limpar()` e
nada é escrito em log. Qualquer mudança que faça um segredo cruzar para
o cliente está errada.

## O trilho: método APONTE

O atendimento não é um formulário livre; é uma trilha de oito etapas
(`ETAPAS`, [index.html:155](index.html:155)) que segue o método APONTE
da casa, com duas paradas operacionais no meio:

| id | etapa | o que trava a conclusão (`etapaConcluida`, [index.html:166](index.html:166)) |
|----|-------|------------------------------|
| `A` | Abordagem positiva | hora de chegada, tempo combinado |
| `P` | Pesquise o cliente e o carro | motivo, pretensão, decisor presente |
| `O` | Ofereça uma demonstração envolvente | mostrou o processo e um testemunhal |
| `PUB` | Ficha, descritivo e lançamento | ficha completa **e** carro lançado |
| `ESP` | Espera das propostas (15 min) | cronômetro iniciado |
| `N` | Negocie e neutralize objeções | ao menos uma rodada registrada |
| `T` | Tome a iniciativa e feche | aceite final e valor fechado |
| `E` | Estenda o relacionamento | avaliação no Google ou indicações |

`PUB` e `ESP` não são letras do APONTE — são o lançamento e a espera,
que existem porque é onde o atendimento realmente quebra. A navegação
entre etapas é livre (o negociador pode pular), o que trava é a
saída, não o passo.

## Decisões

### 1. O gate: descritivo travado até a ficha fechar

O descritivo e o JSON do Shinkai só ficam copiáveis quando `faltando()`
retorna vazio ([index.html:143](index.html:143)): os dez itens de
`OBRIGATORIOS` ([index.html:137](index.html:137)) preenchidos — com regra
própria para os dois compostos, os quatro pneus classificados e ao menos
um opcional marcado — mais ao menos uma foto.

**Por quê:** ficha incompleta no grupo dos lojistas gera rodada de
perguntas, e cada rodada custa tempo com o cliente sentado na mesa. O
custo de barrar é do negociador; o custo de deixar passar é da rede
inteira.

**Como é feito:** `liberado` ([index.html:356](index.html:356)) desabilita
os dois botões de copiar e derruba a opacidade do bloco para 0.45; o
painel no topo de `PUB` lista nominalmente o que falta. Não existe
"copiar assim mesmo".

**"Básico" existe porque o gate estava empurrando para a mentira.**
Ele pede ao menos um opcional marcado; num carro pelado o negociador
tinha que marcar algo falso para liberar o descritivo. Pedido do Derek
em 17/09/2026. **Ele e "Completo" se excluem** (`OPOSTOS`) — carro não
é completo e básico ao mesmo tempo, e mandar os dois produziria uma
ficha que se contradiz na mão do lojista. **"Básico" não chega ao
Shinkai** — não há chip para ele lá, e opcional sem chip é descartado em
silêncio (decisão 47). O par continua valendo aqui, que é onde ele foi
pedido: ele existe para o gate não empurrar o negociador para a mentira.

**A lição é maior que o chip:** gate que não tem como ser satisfeito
com a verdade não protege nada — ele treina a equipe a preencher
qualquer coisa. Quem acrescentar exigência nova pergunta antes qual é a
resposta honesta de quem não tem o que preencher.

Ao mexer aqui: um campo novo só é obrigatório se entrar em
`OBRIGATORIOS` **com rótulo legível** — o rótulo é o que aparece na
lista de pendências. Campo obrigatório sem rótulo bom deixa o
negociador adivinhando.

### 2. Três camadas de observação

O mesmo carro é descrito em três níveis, e o destino de cada um é
diferente:

| camada | campo | destino |
|--------|-------|---------|
| Positivos | `positivos` | lojista (JSON, `oferta.pontos_positivos`) |
| Ressalvas | `ressalvas` | lojista (descritivo **e** JSON) |
| Internas | `internas` | ninguém fora da loja |

**Por quê:** ressalva omitida vira devolução e queima a confiança da
rede; observação interna ("cliente aceita menos", "está apertado")
vazada para o lojista destrói a posição de negociação da Vaapty. São
riscos opostos, então são campos separados — não um campo de
observação com disciplina de quem digita.

**Como é feito:** `gerarDescritivo()` ([index.html:227](index.html:227))
imprime apenas `ressalvas`, uma linha por bullet. `internas` não é
referenciada ali em nenhuma hipótese. Na UI o campo interno tem fundo
próprio (`#FBF7FD`) e o rótulo diz o destino em vez do nome do campo.

**Cuidado ao mexer:** no `payloadShinkai()` ([index.html:250](index.html:250))
o texto interno viaja sob a chave `interno`, separado de `oferta` e
`veiculo`. A separação existe no formato, mas nada no código impede
quem consome o JSON de exibir esse bloco. Enquanto o Shinkai for a
plataforma da casa, tudo bem; se o mesmo payload passar a ir para
lojista, `interno` precisa sair antes.

Hoje `positivos`, `lataria` e `mecanica` estão no payload mas **não têm
campo na tela** — saem sempre vazios. É lacuna de UI, não decisão.

### 3. Câmbio antes da versão FIPE

Na busca por placa, o negociador escolhe o câmbio (Manual / Automático /
Todos) **antes** de escolher entre as versões FIPE devolvidas.

**Por quê:** a Placa Fipe devolve várias versões candidatas e o câmbio é
o que quase sempre separa as empatadas — Onix LTZ manual R$ 51.371
contra automático R$ 55.188. Escolher a versão errada contamina o valor
FIPE, que contamina o POR, que contamina a negociação inteira. O câmbio
é a única informação que o negociador tem na mão (está no carro, na
frente dele) e que a base não entrega confiável.

**Como é feito:** `filtrarPorCambio()` ([index.html:74](index.html:74))
casa o nome da versão contra `RX_AUT` / `RX_MEC`. **Se o filtro zerar a
lista, devolve a lista inteira** — filtro que esconde tudo é pior que
filtro nenhum, porque o negociador acha que o carro não existe na base.
`cambioBusca` já entra preenchido com o câmbio da ficha
([index.html:316](index.html:316)), e a versão escolhida grava o câmbio
de volta na ficha ([index.html:328](index.html:328)).

`alertaDispersao()` ([index.html:80](index.html:80)) avisa quando as
versões restantes variam mais de R$ 2.000 entre si: sinal de que o
câmbio não bastou e alguém precisa abrir o documento.

### 4. Cache mensal da consulta de placa

O plano atual da Placa Fipe dá **20 consultas por dia**. O valor FIPE
muda uma vez por mês. Consultar a mesma placa duas vezes no mesmo mês é
cota queimada à toa — daí a decisão de cachear a consulta por mês.

**Estado real do código:** `api/placa.js` ([api/placa.js:60](api/placa.js:60))
define `Cache-Control: public, max-age=0, s-maxage=86400` — 24 h na
borda da Vercel, **zero no navegador**, apesar do comentário ao lado
falar em 30 dias. Não há cache no cliente: `consultarPlaca()`
([index.html:62](index.html:62)) chama o endpoint direto, sem consultar o
`window.storage`.

Para o mensal valer de verdade faltam duas coisas: subir o `s-maxage`
para a janela do mês e guardar o resultado por placa no `localStorage`
com a data de referência FIPE. Enquanto isso não existe, a proteção real
da cota é o contador no cabeçalho, que fica laranja com 3 ou menos
consultas restantes.

`/api/cota` é livre — o endpoint `getquotas` da Placa Fipe não desconta
consulta, então pode ser chamado no carregamento e depois de cada busca.

### 5. Gravação no banco: uma ficha por placa em avaliação

`POST /api/veiculo` não cria uma linha por clique. Antes de inserir, ele
procura linha com a **mesma placa e status `em_avaliacao`**; se achar,
faz `PATCH` nela.

**Por quê:** o negociador salva a ficha, volta, corrige o KM, salva de
novo. Sem isso, o mesmo carro apareceria três vezes na lista e ninguém
saberia qual é a boa. A chave é (placa, em_avaliacao) e não a placa
sozinha porque o mesmo carro pode voltar meses depois — aí é atendimento
novo, linha nova.

Não há índice único cobrindo essa regra: são duas requisições
(`select` e depois `insert`/`patch`), então dois aparelhos salvando a
mesma placa no mesmo segundo criam duas linhas. Aceitável enquanto um
atendimento é de um negociador; se virar problema, o conserto é um
índice único parcial em `veiculo (placa) where status = 'em_avaliacao'`.

**Update não apaga o que a tela não mandou.** `status` e
`fipe_consultada_em` ficam de fora do `PATCH` — quem corrige o KM não
reconsultou a FIPE nem mudou o carro de etapa. E `somenteEnviadas()`
descarta toda coluna cuja origem não veio no corpo, olhando o mapa
`FONTE`: sem isso, cada salvamento zeraria `renavam`, que tem coluna e
ainda não tem campo. **Coluna nova exige entrada em `FONTE`** — sem ela
a coluna nunca é gravada.

**Mapeamento tela → coluna** (`paraColunas()`, [api/veiculo.js:77](api/veiculo.js:77)),
onde os formatos não batem:

| tela | banco | conversão |
|------|-------|-----------|
| `ano` `"2019/2020"` | `ano_fabricacao`, `ano_modelo` | corta no `/`; valor sozinho vale pelos dois |
| `pneus[4]` `"Novo"…` | `pneu_de/dd/te/td` | enum `estado_pneu`, minúsculo e sem acento |
| `opcionais[]` | `opcionais text[]` | direto |
| `positivos`, `ressalvas` (texto multilinha) | `pontos_positivos`, `ressalvas_lojista` `text[]` | quebra por linha |
| `internas` | `observacoes_internas` | direto |
| `modelo` | `marca_modelo` | nome diferente |
| `fipe`, `por` | `fipe_valor`, `valor_por` | `decimal()` aceita `51371`, `51.371` e `51.371,50` |

O recorte do que sai da tela é `fichaParaBanco()`
([index.html:262](index.html:262)) — só campos de veículo, nada do
atendimento. O mapeamento nome → coluna mora no servidor; a tela não
conhece nome de coluna.

**Sem destino hoje:** `negociador` e `pretensao` não têm coluna na 0001,
e `renavam` tem coluna mas não tem campo na tela. Quem for resolver: os
dois primeiros pedem migração nova, o terceiro é só UI.

### 6. Fotos: sobem na hora e não ficam no aparelho

A imagem é comprimida, sobe para o bucket `fotos-veiculo` e some do
`localStorage` assim que o servidor confirma. O caminho é
`{placa}/{timestamp}-{aleatório}.jpg`.

**Por quê:** data URL de 12 fotos estoura a cota do `localStorage` e
some quando o negociador troca de aparelho. E foto de carro de cliente
não tem por que ficar guardada em celular de ninguém.

**A ordem obrigatória:** a ficha vai ao banco **antes** das fotos —
é o `veiculo_id` que dá destino ao upload, e é dele que
`api/foto.js` tira a placa que nomeia a pasta. Foto tirada antes disso
fica `aguardando` e sobe sozinha assim que a ficha é salva.

**Consequência no gate:** o botão "Salvar no banco" **não** exige foto
(`podeSalvar`, [index.html:531](index.html:531)) — se exigisse, nada
subiria nunca, porque a foto precisa do id que só o salvamento cria. O
gate do descritivo continua exigindo foto, só que agora conta as que
estão **no servidor** (`enviadas`), não as que estão no aparelho.

**Falha não perde imagem:** upload que quebra marca a foto como `erro`
e mantém o data URL no aparelho, com botão "Tentar". A chave
`vaapty:fotos` só é apagada quando não sobra nenhuma pendente.

**Nada fica órfão:** se a linha na tabela `foto` falhar depois do
upload, `api/foto.js` apaga o arquivo do bucket antes de devolver erro.
No DELETE a ordem é inversa — arquivo primeiro, linha depois — para que
repetir a chamada convirja em vez de deixar linha apontando para arquivo
que não existe.

**Reordenar é em duas voltas.** A 0002 cria índice único em
`foto (veiculo_id, ordem)` para evitar duas capas. Ele não é
`deferrable`, então mandar a terceira foto para a posição 0 esbarra em
quem ainda está lá. O `PATCH` estaciona todas em ordens negativas e só
depois grava as finais. **Quem mexer nessa rotina precisa manter as duas
voltas** — um laço simples de update quebra na primeira troca de capa.

**O bucket é privado** e limita 5 MB por arquivo; `MAX_BYTES` repete o
mesmo número para que o erro venha da nossa função, com mensagem
legível, em vez de vir do Storage. O bucket aceita jpeg, png e webp;
`api/foto.js` aceita **só JPEG**, conferindo os magic bytes, porque é o
que `comprimir()` produz.

**Apagar o veículo deixa arquivo para trás.** O `on delete cascade` da
0002 limpa as linhas de `foto`, não os objetos do Storage. Hoje não há
tela que apague veículo; quando houver, ela precisa varrer o bucket
antes.

### 7. Documentos: o original é o bloco colado, não o arquivo

`documentos.js` está na raiz e **ninguém o carrega** — não há
`<script src>` apontando para ele. O que roda é o bloco
`===== documentos =====` dentro do `index.html`. Editar o arquivo da
raiz não muda uma vírgula na tela.

**Por quê:** foi decisão do Derek em 26/08/2026, para manter o original
como referência. O risco é evidente e por isso está anotado nos dois
lugares — no topo do arquivo morto e no topo do bloco vivo. Quem for
mexer no texto de um contrato precisa acertar o alvo na primeira
tentativa.

**Uma diferença em relação ao arquivo:** o `brl()` de lá virou
`brlDoc()` aqui. Os dois existiam com regras diferentes — o do
`index.html` corta os centavos, o do documento imprime
`____________` quando não há valor — e duas declarações do mesmo nome no
mesmo escopo do Babel derrubam a aplicação inteira, não só o documento.

**O texto jurídico é o da casa.** Em 27/08/2026 o Derek mandou os
papéis assinados e eu transcrevi: termo de vinculação, pré-contrato e
autorização de vistoria saíram do rascunho. **Não invente cláusula, não
mude número, não "melhore" redação** — o que está no código é o que o
cliente assina, e divergir do papel cria dois contratos diferentes.
Mudança passa pelo jurídico da Vaapty.

Duas coisas que ficaram fiéis ao original de propósito: a cláusula
quinta do termo termina em dois pontos e a enumeração não aparece na
folha; e os valores de perícia cautelar (R$ 390,00) e consulta veicular
(R$ 90,00) estão no texto assinado. Corrigir por conta própria seria
pior que reproduzir o que está em vigor.

**"Valor ajustado para venda" é a CONTRAPROPOSTA do cliente**, não o
extrato que a loja imprimiu. São números diferentes e o papel é
assinado por ele: sair o valor ofertado ali coloca o número errado no
contrato. A ordem é `rodada.contra` → `valorFechado` → `impresso`, e a
tela avisa quando cai no último.

**Não se imprime documento com campo vazio.** Nome, CPF, RG e endereço
do cliente (colunas da 0007) travam os botões enquanto faltarem. Papel
com lacuna volta para ser preenchido depois, e é assim que contrato
acaba assinado pela metade. O bloco que pede esses dados aparece na
Negociação e no Fechamento.

**Renavam saiu dos documentos.** Ficava sempre em branco porque não há
campo na tela. Volta quando houver — e, pela decisão do Derek, só
interessa quando o carro fecha de verdade.

**Estado de React usado fora do componente que o declara passa pelo
Babel e quebra na tela.** Em 15/09/2026 um `const [perdendo, …]` foi
parar na tela de indicações enquanto o `setPerdendo()` ficou no funil
de leads: a transpilação não reclamou, e a **Pré-vendas abriu em
branco** — `ReferenceError: perdendo is not defined`, visível só no
console. Transpilar não é testar; **antes de dar uma tela por pronta,
abrir nela logado** (decisão 24). `ferramentas-escopo.js` varre o
arquivo procurando esse caso: `node ferramentas-escopo.js`. Ele acusa
quatro falsos positivos conhecidos — `setC`, `setV`, `setL` em
`ContratoDoNegocio` e `setComp` em `Cabecalho` — que são props.

**O formulário do cliente é expressão JSX, não componente.** Componente
declarado dentro de outro vira tipo novo a cada render: o React remonta
o formulário e **o campo perde o foco a cada tecla digitada**. Quem
transformar `blocoCliente` em `<BlocoCliente/>` reintroduz isso.

**E por ser expressão, ele é avaliado na hora da declaração** — não sob
demanda como um componente. Tudo que ele lê (`podeImprimir`,
`faltamCliente`) precisa estar declarado **acima** dele. Declarar
depois dá `ReferenceError` a cada render e **a tela do atendimento para
de abrir**, sem erro visível na lista. Já aconteceu uma vez.

### 15. O check list virou registro, não papel

O check list era uma folha que o negociador preenchia, o cliente
completava com os dados bancários e o administrativo conferia depois.
Agora é linha no banco (0008), **uma por atendimento** — daí o `unique`
em `atendimento_id` e o upsert em cima dele. Ele é o resumo do negócio,
não um evento que se repete como o documento impresso.

**Duas mãos preenchem, e o carimbo é do servidor.** Quando qualquer
item do administrativo é marcado, `api/checklist.js` grava
`adm_conferido_por` e `adm_conferido_em` a partir do token — o cliente
não escolhe esses valores. Sem isso, "conferido" não responde a
pergunta que importa quando algo dá errado: conferido por quem.

**A via impressa espelha o digital.** `checkList(f, cl)` marca no papel
o que está marcado no sistema; sem check list salvo, sai com as caixas
vazias e continua servindo como formulário.

**Dado bancário agora fica guardado.** Conta e chave PIX são dado
sensível ao ponto de fraude: quem tiver acesso desvia pagamento. A RLS
da 0008 é o que separa isso de um vazamento, e a tela avisa para
conferir o favorecido antes de salvar. **A conversa com o jurídico
sobre retenção continua pendente** — ver PENDENCIAS.md.

**A janela precisa abrir no clique.** `abrirDocumento()` é chamado antes
de qualquer `await` em `gerarDocumento()`
([index.html:755](index.html:755)): pop-up disparado depois de um await
é bloqueado pelo navegador. Quem inverter essa ordem quebra a impressão
em silêncio.

**O protocolo liga papel e banco.** Ele é gerado dentro do HTML, no
rodapé, e `extrairProtocolo()` o tira de lá por regex — assim as funções
de documento continuam devolvendo só o HTML, como no arquivo original.
Se o rodapé mudar de texto, o protocolo passa a ser nulo, e o registro
perde a única coisa que o amarra à folha impressa.

**Cada geração é uma linha.** Segunda via é evento novo, com protocolo
novo: é assim que se sabe quantas vias existem circulando. Por isso a
0003 não tem índice único.

**Documento gerado antes de a ficha ir ao banco** entra no registro
quando o veículo é salvo, mas **sem o conteúdo** — o HTML não fica no
aparelho. Sabe-se que existiu, não o que dizia. Na prática o Lançamento
vem antes da Negociação, então é caso de borda.

### 8. Preço de mercado: link pronto, não raspagem

Na etapa P, abaixo da consulta de placa, um campo editável monta a busca
e cinco botões abrem o anúncio em cada canal (`CANAIS`,
[index.html:165](index.html:165)).

**Por quê link e não raspagem:** o número que interessa é o preço
*pedido* nos anúncios, e ele muda todo dia. Raspar site de classificado
quebra sozinho e ainda esbarra em bloqueio de robô. Abrir a busca pronta
custa um toque e mostra o dado vivo.

**Os sete canais foram conferidos um a um** em 27/08/2026 com
HYUNDAI/I30, num navegador de verdade — o navegador de teste é barrado
por detecção de robô, e foi por isso que a primeira versão caiu em
busca do Google.

| canal | formato |
|-------|---------|
| OLX | `?q=` texto livre |
| Webmotors | `/carros/estoque/{marca}/{modelo}` |
| iCarros | `/comprar/usados/{marca}/{modelo}` |
| Mercado Livre | `carros.mercadolivre.com.br/{marca}/{modelo}/` |
| Marketplace | `/marketplace/search/?query=` (localiza sozinho) |
| KBB | `/sp/marcas/{marca}/` — só a marca |
| AutoAvaliar | `tabela.autoavaliar.com.br` — consulta pública |

**Os canais são de duas famílias, e a tela separa as duas** porque
medem coisas diferentes:

- **anúncio** (OLX, Webmotors, iCarros, Mercado Livre, Marketplace) é o
  que o dono **pede**. Teto, não referência.
- **tabela** (KBB, AutoAvaliar) é o que o mercado **pratica**. A FIPE é
  média de varejo; o KBB é o varejo praticado; a **tabela AutoAvaliar é
  o repasse entre lojistas** — a ponta que a Vaapty vende, e por isso a
  que mais se aproxima do POR.

**KBB para na marca** porque o modelo lá fica sob a carroceria
(`/hatchback/i30/`), que a FIPE não devolve.

**A tabela AutoAvaliar fica em subdomínio próprio**, e isso me enganou
uma vez: `autoavaliar.com.br/tabela-auto-avaliar/` é página de produto e
pede login; a consulta de verdade é `tabela.autoavaliar.com.br`, pública,
com marca, modelo, ano, versão e estado. **O Derek corrigiu.**

**Não dá para chegar lá com o carro já escolhido**, e não por falta de
tentativa: a página **ignora parâmetro de URL** (testei `carBrand`,
`carModel`, `year` — todos os campos vêm vazios) e o resultado passa por
**reCAPTCHA**. Automatizar isso seria burlar proteção anti-robô. O que a
tela faz é mostrar os três valores a selecionar ao lado do botão, para o
negociador não ter que lembrar.

**Chaves na Mão ficou de fora**: não responde a nenhum padrão e devolve
"página não encontrada". Link quebrado na frente do cliente é pior que
canal a menos — e agora seria pior ainda, porque travaria a etapa. O
iCarros, aliás, **ignora `?q=`** e cai na home genérica. **Quem mexer
aqui confere o resultado antes de publicar.**

**A etapa P só fecha depois de abrir todos os canais.** É regra de
processo pedida pela casa: o negociador tem que ter visto o preço
anunciado antes de sentar. `faltamCanais()` conta só os canais que
**têm endereço** para o carro em questão — exigir clique em link
inexistente travaria o atendimento. O botão "abrir todos" marca apenas
o que o navegador realmente abriu; dar por visto o que foi bloqueado
liberaria a etapa sem ninguém ter olhado.

Os três de caminho precisam de marca e modelo **separados**, e por isso
`escolherVersao()` guarda `marca` e `modeloCurto` na ficha. Em ficha
preenchida à mão, caem para o primeiro e o segundo token de `modelo` —
o que erra em marca de duas palavras (Land Rover, Alfa Romeo). Nesse
caso o botão some, em vez de levar a um link quebrado.

**O termo é derivado, não o nome da FIPE.** `termoMercadoPadrao()`
tira motor e câmbio do nome ("CHEVROLET ONIX HATCH LTZ 1.4 8V FlexPower
5p Mec." não acha nada) e deixa marca, modelo, versão e ano. O campo é
editável porque nenhuma heurística acerta todo nome, e o negociador sabe
o que procurar.

**Preço anunciado é teto, não referência** — está escrito na tela, e
precisa continuar escrito. Anúncio é o que o dono pede, não o que o
carro vende.

**`noopener` não vai nas features do `window.open`.** Por
especificação, `window.open(url, alvo, "noopener")` devolve **sempre
`null`** — mesmo tendo aberto a aba. O "abrir todos" usava isso, então
as sete abas abriam na cara do negociador e a tela dizia que o
navegador tinha bloqueado todas, sem marcar nenhuma como vista: a
etapa P não fechava nunca. O Derek viu em 11/09/2026 ("quando clica em
abrir todos fica tudo ok aqui"). A mesma proteção se consegue cortando
`j.opener` depois de abrir, e aí a referência que diz se abriu
continua vindo. **Quem detecta bloqueio de pop-up pelo retorno do
`window.open` não pode pedir `noopener` na mesma chamada.**

### 9. Login: o navegador fala pelo usuário, não pela chave de serviço

Até a 0004 as funções em `api/` usavam a `SUPABASE_SERVICE_KEY` para
tudo. Ela passa por cima da RLS, então as políticas eram decoração.
Com o login isso inverte: o navegador entra pelo Supabase Auth, guarda
o token, e cada chamada a `api/` o envia. As funções **repassam esse
token ao PostgREST** — e aí a RLS decide de verdade.

**Quem valida o token é o banco.** `tokenDe()` só confere o formato do
cabeçalho; verificar assinatura aqui seria reimplementar, sem
biblioteca, o que o PostgREST já faz. Token falso volta 401 de lá.

**O token não pode virar variável de módulo.** As funções da Vercel
reaproveitam a instância entre requisições: duas chamadas simultâneas
trocariam de usuário. Por isso `cabecalhos(tok, ...)` recebe o token
como argumento em vez de lê-lo de um escopo compartilhado. **Quem
"simplificar" isso para uma variável global cria vazamento entre
usuários** — e é o tipo de bug que não aparece em teste com uma pessoa.

**O Storage é a exceção.** A 0002 criou o bucket privado sem política
em `storage.objects`, então o token de usuário não abre nem para ler.
`api/foto.js` mantém a chave de serviço **só para o Storage**
([api/foto.js:56](api/foto.js:56)); o banco continua indo pelo usuário.
Quem protege é a ordem: toda ida ao Storage acontece depois de uma
consulta ao banco feita pelo usuário — se a RLS não devolver a linha,
a função para antes de tocar no arquivo. Se um dia houver política em
`storage.objects`, esta exceção sai.

**Sessão morta renova uma vez.** O token dura uma hora. Em vez de
vigiar relógio, `fetchAut()` deixa o 401 acontecer, renova e repete.
Falhou de novo, é sessão morta: derruba para a tela de login.

**Conta sem perfil ativo enxerga tela de espera, não erro.** A RLS não
devolve nem a própria linha de `perfil` para quem está inativo — o que
sem tratamento viraria uma tela vazia inexplicável. `api/perfil.js`
devolve `liberado: false` nesse caso, e o App mostra "acesso ainda não
liberado".

**`/api/placa` e `/api/cota` continuam abertos.** São os únicos sem
login, porque mexer neles estava fora do combinado. Consequência real:
quem descobrir a URL queima as 20 consultas diárias da Placa Fipe.
Fechar é uma linha em cada arquivo, o mesmo `tokenDe()`.

### 10. O atendimento é o dono; a ficha é filha dele

Até a etapa 3 o sistema era **um** atendimento por aparelho, no
`localStorage`. Agora a tela de entrada é a lista (`CRM`), e o fluxo
APONTE roda dentro de um atendimento escolhido.

**As chaves do `localStorage` passaram a ter o id junto** —
`vaapty:at:<id>`, `vaapty:fotos:<id>`, `vaapty:veiculo:<id>`. Sem isso,
abrir o segundo carro sobrescreveria a ficha do primeiro. **Quem
adicionar chave nova precisa fazer o mesmo.**

**O `veiculo` ganhou `atendimento_id`,** e é ele que passa a ser a
chave do "uma ficha por atendimento" no `api/veiculo.js`. Antes a chave
era (placa, em_avaliacao); com atendimento, o mesmo carro pode voltar
no mesmo dia por outro atendimento, e são duas linhas — o que a chave
antiga impediria.

**A lista traz veículo e propostas na mesma consulta**, pelo
`select=*,veiculo(...),proposta(...)` do PostgREST. Uma ida ao banco em
vez de três, e o cartão já mostra placa e melhor proposta. Isso depende
do PostgREST enxergar as chaves estrangeiras — se um dia a lista vier
sem `veiculo`, é aí que se olha primeiro.

**`negociador_id` aponta para `perfil`, não para `negociador`.** São
duas tabelas com as mesmas pessoas e ids diferentes: `perfil` é quem
tem login (0004), `negociador` é o cadastro de metas (0010). A tela de
novo atendimento oferece a lista do CADASTRO — é ela que tem todo
mundo, inclusive quem não tem login — e gravava aquele id no campo,
violando a chave estrangeira: **o atendimento não abria.**

**O erro era invisível para quem testava, e é por isso que durou.** Ele
só acontece quando o nome escolhido existe no cadastro. O perfil do
dono chama-se "dereksdmelo", que não está lá, então o campo nascia
vazio e caía no id dele; para o ANDRÉ BRUNO, que tem o mesmo nome nas
duas tabelas, o efeito preenchia o campo sozinho e o insert estourava —
12/09/2026, com o cliente na frente dele.

**O vínculo só existe quando dá para saber o perfil.** Quem escolhe o
próprio nome tem o dele na mão; escolhendo o nome de outra pessoa, vai
só o NOME — que é como os 89 atendimentos importados já vivem, e o que
a régua do mês (decisão 22) sabe ler. **Perder o vínculo é bem menos
grave que recusar o atendimento.** `idDePerfil()` confere no servidor
nos três caminhos (POST, PATCH e o "chegou" do lead), porque a tela
acertar é conveniência, não controle.

Quem quiser o vínculo de volta para todo mundo: falta uma coluna
`perfil_id` em `negociador`, ligando cadastro e login — a mesma forma
do `shinkai_nome` (0044), onde a tradução entre dois mundos virou
cadastro em vez de adivinhação.

**PATCH que volta vazio é RLS, não erro.** A política deixa qualquer um
da equipe *ler* todo atendimento, mas só o dono (ou o gerente)
*escrever*. Quando alguém tenta editar o atendimento de outro, o
PostgREST responde 200 com lista vazia. O `api/atendimento.js` traduz
isso em 403 com mensagem legível — sem essa tradução, a tela diria que
salvou.

**A busca escapa vírgula e parêntese.** O `or=` do PostgREST usa esses
caracteres como sintaxe; um cliente chamado "Silva, João" quebraria a
consulta inteira.

### 11. Desvalorizômetro: a chave vinha, o dado não

A consulta de placa devolve, por versão FIPE, um campo
`desvalorizometro`: um base64 que decodifica para
`ano#codigo_modelo#tipo#codigo_marca#combustivel#versão#assinatura`.
**É uma chave, não o dado** — foi isso que confundiu o `<Pendente>`
antigo, que dizia "já vem no retorno".

Quem consome a chave é `POST /getdesvalorizometro`, e ele devolve o
histórico FIPE **mês a mês desde o lançamento** — 206 tabelas num carro
de 2010. `api/desvalorizacao.js` chama essa rota e entrega os últimos
60 meses para o gráfico, mais as contas prontas.

**Por que isso vale na mesa:** o cliente ancora no que pagou. O número
que muda a conversa não é o valor de hoje, é **quanto o carro perde por
mês parado** — transforma "quanto eu quero" em "quanto custa esperar".

**Como o número foi achado:** o `api/placa.js` montava a resposta campo
a campo e descartava o resto do retorno. Passou a devolver o não
mapeado em `extras`, e a resposta apareceu na primeira consulta.
`extras` continua lá para a próxima pergunta desse tipo.

**Cache de 7 dias na borda:** a tabela FIPE muda uma vez por mês e a
consulta gasta cota. O endpoint é aberto, como `/api/placa` — os dois
precisam de login junto, quando for a hora.

### 12. O funil: onde o dinheiro se perde

`api/funil.js` reproduz a aba PIPELINE: fluxo → avaliações → propostas
→ vendas, por origem, com conversão e valores médios.

**Conta no servidor, não na tela.** A lista do CRM é paginada; contar
em cima do que coube na página daria número errado — no mês da planilha
foram 173 atendimentos. A consulta do funil é enxuta (sem observação,
sem foto) e cabe de uma vez, com teto de 2000. **Se bater no teto, a
resposta diz `truncado: true` e a tela avisa** — número incompleto sem
aviso é pior que número nenhum.

**"Avaliação" é ficha com valor FIPE**, não cliente que entrou. Foi a
tradução mais fiel de "Nº de avaliações" da planilha: o que ela contava
era carro avaliado, não porta que abriu.

**Não se registra proposta na Espera.** A primeira proposta que entra no
sistema é o 1º extrato, na Negociação — foi correção do Derek em
28/08/2026. Por isso `statusDerivado()` parou de olhar a tabela
`proposta`: lançado é "aguardando", e **"falta proposta" virou marcação
do negociador**, porque o sistema não tem como saber que a rede não
respondeu. A tabela continua existindo para o que veio da importação.

**Status é manual, e precisa ser.** Sem alguém marcar fechado ou
perdido, tudo fica "aberto" e o funil não conta nada. A faixa de status
fica no topo do atendimento, sempre visível, por isso. Automatizar a
transição foi considerado e descartado: o sistema não tem como saber
que o cliente desistiu.

### 13. Importar a planilha: colar, não subir arquivo

A tela de importação recebe **texto colado** — o negociador seleciona
no Google Sheets, ⌘C, e cola. É tabulação separando colunas, que é o
que o Sheets põe na área de transferência.

**Por que colar e não subir arquivo:** sem build e sem biblioteca, ler
`.xlsx` significaria trazer dependência para decodificar zip e XML. E
colar é o gesto que a pessoa já faz.

**A planilha é suja, e o importador assume isso:**

- **Data quebrada** ("06/052022", "18/05/0202") entra como nula. A tela
  diz quantas foram. Inventar dia é pior que não ter.
- **Placa inválida** ("HNK983") não gera ficha de veículo — só o
  atendimento, com o carro em `carro_descricao`.
- **PROPOSTAS e LOJISTA se repetem quatro vezes** e são pareadas na
  ordem em que aparecem.
- **Essas células misturam valor com recado** ("02/06/23/Não atendeu",
  "Vendeu"). O que não é número vira `observacoes` em vez de proposta.
  **Nada é descartado em silêncio.**
- Origem e status fora da lista viram `outro` e `aberto`, e a tela
  mostra quais foram.

**Três lotes, não 3×N requisições:** um `insert` de atendimentos, um de
veículos e um de propostas. 173 linhas por chamada individual levaria
minutos. **Não é transação** — se o lote de veículos falhar, os
atendimentos ficam. Aceitável numa importação que se faz uma vez e dá
para conferir na lista.

O importador só aparece para gerente.

**E o caminho de volta existe desde 14/09/2026.** "Copiar linha do CRM"
devolve o atendimento no formato da planilha, para colar no Sheets — a
casa ainda mantém o CRM lá, e redigitar vinte colunas à mão é como o
registro deixa de ser feito.

**A ordem das colunas manda, porque colar é posicional.** Coluna
trocada põe telefone em cima de origem sem ninguém ver. `COLUNAS_CRM`
é a ordem que o Derek mandou, e são os mesmos nomes que o `col` do
importador reconhece — **quem mexer numa ponta confere a outra.**

**Tabulação e quebra de linha viram espaço.** A observação da
negociação é multilinha; colada crua, quebraria a linha no meio e
criaria uma segunda linha meia-boca na planilha.

**Número sai cru, sem R$ e sem separador de milhar** — separador
dentro da célula é o que faz a soma parar de funcionar.

**Na coluna PROPOSTAS só entra proposta de lojista de verdade.** O
extrato de ofertas é simulação (decisão 16), e pôr aquele número ali
seria proposta inventada contada como real — que é exatamente o que
aquela decisão evita. Sem proposta registrada, a célula sai vazia.

**`cx`, `QUEM CONSEGUIU` e `AÇÃO` saem vazias**: são colunas da casa
que o sistema não tem de onde preencher. Vazio é honesto; chute vira
dado errado na planilha que o gerente lê.

**O botão fica ao lado do status, não no fim do trilho.** Atendimento
que não fecha nunca chega à última etapa — seria justamente o que
ninguém registraria.

### 14. Duas FIPEs: uma adivinha, a outra confirma

`/api/placa` devolve o valor FIPE a partir da placa — mas a Placa Fipe
**adivinha a versão**, e por isso manda candidatas com percentual de
similaridade. Versão errada contamina o FIPE, que contamina o POR, que
contamina a negociação inteira.

`/api/fipe` fala com a **tabela oficial** (`veiculos.fipe.org.br`), onde
o negociador escolhe à mão. Ela devolve, além do valor, um **código de
autenticação emitido pela própria FIPE** — a prova de que o número veio
da fonte. Fica gravado na ficha.

**São três tabelas, não uma, e o tipo escolhe qual responde (0045).**
Carro, moto e caminhão — pedido do Derek em 14/09/2026, "como na
tabela FIPE". Conferido contra a fonte na mesma data (referência 337):
o `codigoTipoVeiculo` 1 devolve 107 marcas de carro, o 2 devolve 103
de moto (ADLY, APRILIA, AVELLOZ) e o 3 devolve 29 de caminhão e ônibus
(BEPOBUS, DAF); o 4 responde `nadaencontrado`. **Quem acrescentar
código novo confere assim, não por memória.**

**Os códigos de marca NÃO são compartilhados entre as três.** "59" é
VW nos carros e outra coisa nas motos. Por isso trocar o tipo na tela
**zera marca, ano e modelo** — manter a seleção consultaria um código
de uma tabela contra a outra e traria o valor de outro veículo — e por
isso o tipo fica gravado junto dos três códigos da 0043.

A varredura dos seis combustíveis vale igual nas três: Honda/2022 nas
motos devolve 29 modelos a gasolina e 7 flex.

**O tipo também decide o `tipo_veiculo` do envio ao Shinkai**, que era
"carros" fixo (decisão 36) — moto entrava lá como carro.

**A ordem é MARCA → ANO → MODELO**, e não a da FIPE (marca → modelo →
ano). Com o modelo primeiro, a lista de uma marca traz 261 itens
misturando todos os anos; com o ano primeiro, Hyundai/2010 traz 11. O
endpoint `ConsultarModelosAtravesDoAno` faz exatamente esse caminho.

**A FIPE bloqueia por país, e é por isso que existe `vercel.json`.**
Do datacenter padrão da Vercel (Estados Unidos) a resposta é
`403 Attention Required | Cloudflare`. Rodando em `gru1` (São Paulo)
responde normal. **Se alguém remover `regions` do `vercel.json`, a
conferência da FIPE para de funcionar** — e o erro vai parecer bloqueio
de robô, que foi o diagnóstico errado que me custou uma volta inteira.

**O ano da FIPE carrega o combustível junto** (`"2010-1"`). Como o
negociador escolhe só o ano, `api/fipe.js` consulta **os seis
combustíveis** e junta as listas, marcando cada modelo com o seu.
`"nadaencontrado"` é como a FIPE diz que não há nada; não é erro.

**Eram três, e isso escondia a maior parte da tabela.** O código
consultava 1 (gasolina), 2 (álcool) e 3 (diesel) — e a frota
brasileira é **flex, que é o código 5**. Em GM/2013 apareciam 18
modelos de 67; a BYD, que só vende elétrico (4) e híbrido (6), não
tinha modelo nenhum. O negociador procurava o Onix na tabela oficial,
não achava, e concluía que a FIPE não tinha o carro. Varri os códigos
1 a 12 contra a FIPE em 09/09/2026, em marcas e anos diferentes: só de
1 a 6 devolvem lista, e os seis estão em `COMBUSTIVEIS`. **Quem
acrescentar código novo confere assim, não por memória.**

**As seis consultas vão em paralelo** — medido, 0,2 s para as seis
contra a FIPE, sem bloqueio. Em sequência seriam seis idas uma atrás
da outra.

**Falha de um combustível aparece na tela**, em `incompleto`, e a
resposta parcial vai com `no-store`. O `catch { continue }` antigo
sumia com um combustível inteiro em silêncio — a lista voltava curta e
ninguém sabia que faltou justamente o flex. E resposta curta cacheada
24 h na borda entregaria o mesmo erro ao próximo negociador, sem nem
ter havido falha.

**O nome ganha o sufixo do combustível só quando se repete.** O mesmo
carro vendido a gasolina e flex apareceria duas vezes com nome
idêntico e valores diferentes. Pôr o sufixo em todos seria ruído: a
maioria dos nomes da FIPE já diz "Flex" ou "Diesel".

**A conferência grava o combustível na ficha.** Não há campo para ele
na tela — quem preenchia era a consulta de placa, que *adivinha* a
versão e erra o combustível junto quando erra a versão. O valor da
tabela oficial é o que sai no descritivo e nos documentos.

**Enquanto não conferir, aparece o aviso amarelo.** `fipeConferida`
começa falso e só vira verdadeiro quando o negociador usa o valor da
tabela oficial. O aviso aparece no Lançamento e ao lado do campo FIPE.
**É aviso, não trava** — quem decidir travar mexe em `etapaConcluida`.

### 16. Extrato de ofertas: a planilha do Derek, célula por célula

Na **Negociação**, um bloco reproduz o *Simulador de Proposta* que o
Derek mantinha no Excel. Nasceu na Espera e foi movido a pedido dele:
é a folha que vai para a mesa, então mora onde a mesa acontece.

**O papel sai exatamente igual à tela.** Se imprimisse outros números,
a folha do cliente não bateria com o que o negociador está vendo — e é
ele quem tem que sustentar o número na conversa.

**A Negociação é uma fila, não um formulário.** A tela mostra um passo
de cada vez, com a trilha sempre à vista:

```
extrato 1 → contra 1 → 5 min → extrato 2 → contra 2 → 5 min → extrato 3 → pré-contrato
```

Antes disso tudo aparecia junto e a ordem ficava na cabeça do
negociador. Cada impressão cria a rodada, com a Melhor Proposta como
valor impresso; a contraproposta do cliente responde a ela.

**Os cinco minutos entre uma rodada e a seguinte não são enfeite**
(`RODADA_SEG`): é o tempo em que o negociador some para consultar a
mesa. Sem ele o próximo extrato sai na hora e o cliente entende que o
número já estava pronto. Dá para pular, e o botão diz isso.

**O papel usa o molde do extrato, não o do contrato.** A primeira
versão saía com o serif e o título centrado do `moldura` de contrato —
o Derek viu na hora que estava "totalmente diferente". Agora o CSS do
extrato desenha o mesmo que a tela: resumo à esquerda com as caixas
cinzas e os valores em vermelho sublinhados, três colunas de
Num | Valor à direita, a melhor pintada de verde. Dado o valor de referência e quantas propostas se
quer, ele devolve a nuvem de valores, a média e a melhor.

**A conta é a da planilha, não uma aproximação:**

```
Vmax      = arredonda(referência × 0,90)     teto do repasse
Vmedio    = arredonda(Vmax × 0,90)           centro da nuvem
intervalo = arredonda((Vmax − Vmedio) ÷ 5)   largura de um degrau
V0        = Vmedio − 10 × intervalo          piso
proposta  = V0 + sorteio(0..16) × intervalo × |sen(π·n/45)|
```

Tudo à centena. Conferido no ar com FIPE 44.935: piso 28.400, teto da
faixa 42.000, melhor de 57 propostas em 40.600 — os mesmos números que
a planilha produz.

**O seno é a parte que ninguém adivinha olhando o resultado.** As
propostas de índice 1 e 45 nascem coladas no piso; as do meio abrem até
o teto. **Quem "simplificar" para um `Math.random()` entre piso e teto
muda o formato da nuvem e o valor médio para de bater com a planilha.**

**O que se digita é a Melhor Proposta, não a referência.** O negociador
diz quanto quer levar à mesa e o valor de referência é consequência,
mostrado embaixo. Pela conta da planilha o teto de uma rodada é
`0,918 × referência` — esse é o chute inicial; como cada proposta tem
sorteio dentro, `simularPorMelhor()` tenta algumas vezes corrigindo pela
razão e fica com a rodada mais perto. Conferido: alvo 40.600 crava em
40.600 com referência 45.009.

**O arredondamento desce de degrau quando a centena zera a nuvem.** A
conta da planilha arredonda tudo à centena, e o degrau é
`0,018 × referência` — então **abaixo de uns R$ 2.800 ele arredonda
para zero** e todas as propostas colapsam no mesmo número. O Derek viu
em 15/09/2026 com uma proposta de R$ 2.000: cinquenta linhas de
"R$ 2.000", que não é folha de negociação, é um carimbo.

`degraus()` tenta a centena primeiro e **só desce para a dezena, e
depois para o real, se o degrau tiver zerado**. Conferido: para
44.935, 30.000, 15.000, 8.000, 5.000 e 3.000 a conta sai **bit a bit
idêntica** à de antes — a planilha continua sendo a fonte, e o único
caso que muda é o que estava quebrado. Com alvo de R$ 2.000 a folha
passou de 1 para 33 valores distintos, e `simularPorMelhor` continua
cravando o número pedido em todas as faixas, de R$ 500 a R$ 40.600.

**Não se força a melhor no fim.** Daria o número exato sempre, mas a
nuvem deixaria de ser a da planilha e a folha mostraria uma proposta que
a conta não produz. Quando não crava, a tela diz onde o sorteio parou.

**A tela imita a planilha**, a pedido do Derek: o logo, o cabeçalho de
quatro linhas (Veículo, Quant. de propostas, Valor médio das propostas,
Melhor Proposta) e a lista de propostas em três colunas de Num | Valor,
como nas faixas H/I, K/L e N/O do arquivo. Ele lê esse formato há
tempo. **A planilha não tem gráfico** — o único desenho embutido nela é
o logo da Vaapty; o histograma que existiu aqui por um dia era invenção
minha e saiu junto com a tarja laranja.

**E desde 17/09/2026 ele também é um destino do menu**, fora de
qualquer atendimento — pedido do Derek. Antes, tirar uma folha exigia
abrir um atendimento mesmo sem ninguém sentado na mesa.

É o **mesmo** `SimuladorPropostas` e o **mesmo** `extratoOfertas`. Duas
implementações da conta da planilha seriam duas folhas diferentes para
o mesmo carro, que é exatamente o que esta decisão existe para evitar.
**Quem mexer na conta mexe nos dois lugares de uma vez — porque é um
lugar só.**

**A folha avulsa não vira rodada de negócio nenhum, e a tela grita
isso.** Dentro da Negociação cada impressão cria a rodada e grava o
documento com protocolo (decisão 15); aqui não há a que amarrar — a
tabela `documento` exige `veiculo_id` (decisão 40). **Se o negociador
usar a tela avulsa no lugar da etapa N, o CRM perde a rodada**, e o
aviso amarelo no topo manda ele voltar para o atendimento. O destino
aparece para todo mundo: é uma calculadora, não mostra dado de cliente.

**Nada dali é gravado como proposta.** O resultado não vai para a
tabela `proposta` nem para o funil — só a Melhor Proposta vira o valor
impresso da rodada. A tarja "nenhum lojista ofereceu isto" saiu a
pedido do Derek; o que identifica a folha é o título do bloco. Se
um dia precisar ser gravado, tem que nascer com coluna marcando a
simulação — proposta inventada contada como real estraga a conversão e
pode ir para a mesa do cliente.

### 17. Escuta: o consentimento é a chave, não o microfone

O parecer jurídico saiu em 28/08/2026 com uma condição: o
consentimento do cliente vem antes. Por isso o botão do microfone
**nasce desligado** e só acende depois do toggle, e o aceite fica
gravado com data e hora (`escutaEm`). **Quem inverter essa ordem
derruba o parecer inteiro.**

**O que isto é, exatamente** — importa não vender o que não é:

- A transcrição usa o `SpeechRecognition` do próprio navegador. Sem
  biblioteca e sem endpoint novo, o que também resolve o teto de 12
  funções da Vercel.
- **O áudio vai para o serviço de voz da Google ou da Apple**, conforme
  o navegador. Não é processamento local, e está escrito na tela de
  consentimento porque o cliente precisa saber.
- Nós não gravamos áudio. Só o texto fica, e fica no aparelho.
- Os "sinais" (tem pressa, tem outra proposta, decisor ausente, dívida,
  achou pouco, está recuando, sinal de fechamento) são **busca por
  palavra, não modelo de linguagem** — e a tela diz isso. Um resumo de
  verdade pede um LLM, o que significa chave paga e função nova.

Vale como está porque o que trava o negociador não é a falta de resumo:
é que ele não anota.

**A escuta é do atendimento, não da etapa.** `useEscuta` é chamado uma
vez no `VaaptyAponte`, que fica montado do começo ao fim. Enquanto isto
era um componente dentro da etapa, trocar de etapa desmontava o
componente e **matava o reconhecimento no meio da conversa, sem aviso**.
Quem voltar a declarar isso dentro de uma etapa reintroduz o corte.

O aceite e o botão do microfone ficam na **Abordagem** — é onde se
pede, e pedir no meio da negociação seria pedir na pior hora. Uma tarja
laranja no alto, fora das etapas, mostra que está escutando e há quanto
tempo: é o que impede a escuta de rodar esquecida. Os sinais e a
transcrição aparecem na Pesquisa, na Espera e na Negociação.

### 18. Leads de indicação: eles morriam no aparelho

A etapa E colhia até dez nomes por atendimento e eles ficavam no
`localStorage`. Ninguém nunca ligou para nenhum. Agora vão para a
tabela `indicacao` (0011) com os cinco campos que interessam: indicado,
telefone do indicado, negociador que conseguiu, quem indicou e o
telefone de quem indicou.

**O telefone vira link.** O valor da tela não é a tabela — é quem
trabalha a fila ligar do próprio celular sem copiar número.

**`atendimento_id` é `set null`, não `cascade`.** O lead sobrevive ao
atendimento de origem, e é por isso que o nome do negociador e o de
quem indicou ficam gravados **em texto** aqui, não só por referência: o
lead precisa se explicar sozinho meses depois.

**O envio marca `enviada` em cada indicação.** É o que impede a segunda
batida no botão de duplicar a fila da pré-venda.

**O endpoint mora em `/api/atendimento?recurso=indicacoes`** — mesmo
truque dos negociadores em `/api/perfil`. É acomodação do teto de 12
funções, não arquitetura.

### 21. Assinatura eletrônica: markdown, e uma função estreita no banco

O contrato final vai ao ZapSign como **`markdown_text`**, que a API
aceita. Foi isso que evitou depender de gerar PDF no servidor — sem
biblioteca, e este projeto não tem nenhuma de propósito, não haveria
saída.

**O contrato tem uma fonte só**: o HTML que a tela imprime.
`emMarkdown()` converte na hora do envio, e conhece apenas as tags que
`moldura` produz — é isso que a torna confiável. Manter duas versões do
mesmo texto jurídico seria repetir a armadilha do `documentos.js`.

**A chave da conta (`ZAPSIGN_TOKEN`) só existe em variável de
ambiente.** Não está no repositório, não vai ao navegador, não aparece
em log. O `GET /api/documento?recurso=zapsign` responde apenas se ela
existe, nunca o valor: sem esse teste, descobrir que a variável não
subiu seria errar na frente do cliente.

**O webhook chega sem login**, e duas coisas o seguram:

1. **O corpo não é acreditado.** O status é confirmado consultando o
   próprio ZapSign com a nossa chave — POST à toa não marca nada.
2. **A escrita passa por `marcar_contrato_assinado()`** (0015), função
   `security definer` que só sabe fazer isso, e só para token que já foi
   gravado no envio. A chave de serviço continua confinada ao Storage,
   no `api/foto.js` — era a alternativa, e teria aberto a tabela
   `atendimento` inteira, que tem CPF e telefone de cliente.

**A via assinada é baixada e guardada.** O webhook só marca a data; ele
não tem sessão para escrever arquivo. Quem traz o PDF do ZapSign para o
bucket é `POST /api/foto?recurso=anexo&acao=contrato-assinado`, com o
token do usuário, e a operação é idempotente. Sem isso, "assinado" seria
uma data no banco e um PDF que só existe dentro do ZapSign — e contrato
que a casa não tem em mãos não serve quando alguém pede.

### 20. A cautelar reprova, e aí o negócio volta para a mesa

Faltava o passo entre o pré-contrato e o contrato: o laudo. Aprovou,
segue; reprovou, a negociação reabre.

**Na reprovação, o valor PODE ser refeito — não precisa.** Até
17/09/2026 a tela só oferecia o extrato novo e dizia "o valor precisa
ser refeito". Quando o cliente aceitava o mesmo número, o negócio
ficava **preso**: sem extrato novo não havia pré-contrato novo, e sem
ele o contrato não abria. O Derek relatou; a pergunta agora vem antes
da ferramenta — *continua o mesmo* ou *manda novo extrato*.

**Valor mantido libera o contrato sem pré-contrato novo.** A regra
antiga vinha de o valor sempre mudar depois do laudo. Quando ele não
muda, o papel que o cliente já assinou continua dizendo a verdade, e
exigir outro é atrito sem função. Reimprimir continua disponível, para
quando ele quiser a folha citando o laudo.

**"Não mudou" e "ninguém decidiu" não podem ficar iguais no
histórico**, então a escolha também entra em `revisoes`, com
`mantido: true`. Cada volta fica lá com valor e hora — quantas vezes um
carro voltou depois da cautelar é informação que o gerente vai querer,
e ela some se só o último valor for guardado.

**Botão apagado tem que dizer por quê, no lugar onde ele está.** O
outro sintoma do mesmo relato — *"não dá para fazer o pré-contrato"* —
não era o laudo: era o CPF do cliente faltando, com o aviso existindo
só no bloco de cima, e a janela de impressão bloqueada pelo navegador,
com o `erroDoc` renderizado igualmente longe. Os dois faziam o botão
parecer morto. **O Chrome bloqueia o segundo pop-up da mesma página com
facilidade**, e o extrato já tinha aberto o primeiro — então este é o
lugar mais provável do sistema inteiro para isso acontecer. Agora os
três avisos (CPF, valor fechado, janela bloqueada) ficam colados no
botão.

**O pré-contrato sai de novo, com o valor novo.** O anterior morreu com
o laudo, e a tela diz isso: o contrato só vem depois deste assinado.

**O extrato da revisão tem título próprio.** Imprimir como "4ª rodada"
confundiria a folha da mesa com as três da negociação, que são outra
coisa — por isso `extratoOfertas()` aceita um título.

### 19. A conferência do administrativo tem tela própria

Até a 0012 as duas mãos preenchiam o mesmo formulário, e nada impedia o
negociador de marcar a própria conferência — "conferido" deixava de
significar alguma coisa. Agora a fila do administrativo é uma tela, com
o pendente em primeiro lugar, e o check list do negociador só mostra o
estado ("ainda não passou pelo administrativo").

**Quem é adm é uma coluna, não um papel.** `perfil.administrativo`
(0012) em vez de valor novo no enum, por duas razões: `alter type ...
add value` não pode ser usado na mesma transação em que é criado, e
administrativo **não substitui** o papel — o gerente também confere.
`e_adm()` cobre os dois.

**O servidor confere de novo.** `api/checklist.js` recusa qualquer item
`adm_*` de quem não é adm nem gerente; a tela esconder o botão é
conveniência, não controle. **E vale saber o que essa proteção não é:**
a RLS da 0008 libera a linha inteira para a equipe e não sabe separar
coluna, então quem tiver o token e souber falar PostgREST direto passa
por cima. Fechar de verdade pediria trigger no banco.

**A lista sabe o que falta em uma consulta só.** `checklist(adm_conferido_em)`
entrou no `EMBUTIDO` do `api/atendimento.js`; sem isso seria uma
consulta por linha.

### 44. O atendimento sincroniza entre o celular e o computador

O negociador trabalha com os dois ao mesmo tempo: o celular na mão
para fotografar e digitar em pé, o computador na mesa para o extrato e
o contrato. O Derek pediu em 15/09/2026 — *"preciso que salve tudo em
tempo real"* —, logo depois do 206 que abriu em branco (decisão 43).

**A `negociacao_viva` era um relatório, não uma sincronização.** Ela
já subia um retrato do atendimento a cada 15 s desde a 0033, mas de
MÃO ÚNICA: ia para o painel do gestor e nunca voltava para a tela. A
0050 dá a ela uma coluna `ficha` com o estado de trabalho inteiro, e a
volta passa a ser das duas mãos.

**A regra da decisão 43 não bastava.** "O banco preenche só o que está
vazio" resolve ABRIR a ficha; não resolve os dois aparelhos EDITANDO —
com ela, corrigir no computador um KM já preenchido nunca chegaria ao
celular, porque lá o campo não está vazio. O que responde os dois
casos é guardar o que o servidor tinha da última vez que os dois lados
se falaram (a **base**) e comparar três pontas:

- campo que este aparelho **não** tocou desde a base: vale o do
  servidor — foi o outro que mexeu, ou ninguém mexeu;
- campo que ele tocou: vale o daqui, e sobe no envio seguinte.

**Nada que a pessoa acabou de digitar muda sozinho na frente dela** —
é a mesma promessa da 43, agora nos dois sentidos. Conferido no ar em
16/09/2026 com dois navegadores no mesmo atendimento: um digitou
QUITAÇÃO, o outro DÉBITOS e reescreveu o detalhe do motivo, e os dois
convergiram sem que nenhum perdesse o campo em que estava.

**Registro é unido, não sobrescrito.** Rodada, documento e revisão
entram por identidade (`REGISTROS_DA_FICHA`): com três pontas, a
rodada impressa no celular sumiria quando o computador mandasse a
lista dele — e é justamente o dado que dói perder. Canal visto é união
pelo mesmo motivo; os quatro pneus são comparados **posição a
posição**, senão classificar dois aqui apagaria os dois de lá.

**Ler ANTES de escrever, sempre.** Assim este aparelho nunca grava por
cima do que o outro mandou sem ter visto. Invertida, a ordem
transforma cada volta numa chance de apagar o trabalho do outro lado —
e seria invisível, porque o dado não some da tela de quem apagou.

**Nada antes de `pronto`.** A tela nasce com a ficha VAZIA e só depois
carrega o aparelho e o banco. Mandar nesse intervalo publicaria o
vazio, e o outro aparelho o adotaria como novidade: seria a perda do
206 a cada cinco segundos. **Quem mexer neste efeito mantém essa
guarda.**

**O batimento a cada 25 s existe porque um aparelho vivo parecia
morto.** O envio só acontecia quando algo mudava, e `atualizado_em` é o
que diz ao painel do gestor se aquele celular ainda está lá. Um
negociador conversando com o cliente, sem tocar na tela, aparecia como
**"parou de chegar há 2 min"** — apareceu assim no teste de
16/09/2026, com o aparelho perfeito. Alarme falso na direção que mais
custa: o gestor concluiria que a mesa está em silêncio. Agora manda de
novo mesmo sem mudança, o que dá duas requisições por minuto no pior
caso contra as doze de mandar sempre.

**Cinco segundos, e só com a aba à vista** — mais uma volta imediata
quando ela volta a aparecer, que é o instante exato em que a pessoa
larga o celular e pega o computador. Rodar escondido gastaria o 4G da
loja para atualizar tela que ninguém olha. Ao sair de vista, sai só o
envio: o que não pode esperar é o que ela digitou.

**A etapa sobe e não desce.** O painel do gestor precisa saber em que
passo ele está; puxar de volta faria a tela pular de etapa debaixo do
dedo de quem está com o cliente na frente.

**A transcrição fica na coluna dela**, que existe desde a 0033 e passa
de 100 KB numa conversa longa. Repeti-la dentro da `ficha` dobraria o
que trafega a cada volta.

**A tarja deixou de ser silenciosa, e isso inverte a 0033.** Enquanto
o espelho servia só ao painel, engolir a falha era o certo — não se
interrompe um atendimento por causa de um relatório. Agora ele carrega
o trabalho da pessoa, e sincronização que falha calada é exatamente
como o dado do 206 sumiu. Em dia, é uma linha cinza; parada há mais de
trinta segundos, fica laranja e diz a única coisa acionável: **não
feche esta aba até voltar o sinal**.

**O que fica lossy, e é honesto dizer qual:** os dois aparelhos
editando o MESMO campo entre duas voltas. Cada tela fica com o que
digitou, e o servidor fica com a última que mandar. Resolver isso
pediria marca de tempo por campo, com dois relógios que não conversam
— e o caso real é a pessoa digitando de um lado de cada vez.

**`ferramentas-sincronizacao.js` guarda a regra**, com dezoito casos
lidos do próprio `index.html` — cópia de código de teste envelhece
calada, e aí o teste passa enquanto a tela erra.

**A ficha de trabalho não é o registro.** O do carro continua sendo
`veiculo` (decisão 5), com colunas e consulta; o das rodadas continua
sendo `documento`, com protocolo. A `ficha` é a área de trabalho de um
atendimento que dura menos de uma hora, e é por isso que é jsonb: dar
coluna a cada toggle do APONTE criaria um segundo esquema do carro
para manter em sincronia com o da 0001.

**O gerente não sincroniza o atendimento de outro.** A política de
escrita da 0033 é do dono (ou de atendimento sem dono), e não tem
cláusula de gerente — de propósito: o espelho vem do aparelho de quem
conduz. Gerente que abrir o atendimento de um negociador vê a tarja
laranja, o que é a leitura correta.

### 45. Acompanhar a conversa: o texto sim, o áudio não

O Derek perguntou em 16/09/2026 se o gestor consegue **ouvir** a
conversa ao vivo, do computador dele.

**O que barra o áudio não é o código, é o consentimento.** O parecer
jurídico de 28/08/2026 (decisão 17) põe o aceite do cliente antes de
tudo, e a frase que o negociador lia dizia quatro coisas: a conversa
vai ser transcrita, o áudio **não** fica gravado, a transcrição passa
pelo serviço de voz do celular, e fica registrada no sistema da loja.
**Não dizia que outra pessoa escuta a sala ao vivo** — e isso não é
detalhe de redação: é uma terceira pessoa ouvindo o cliente sem ele
saber.

**O Derek mandou acrescentar a frase, e ela está no ar.**
`CONSENTIMENTO_ESCUTA` passou a autorizar o gerente a **acompanhar e
ouvir enquanto a conversa acontece**. Ela mora em um lugar só, como a
`CLAUSULA_ASSINATURA` (decisão 42) — duas redações do mesmo aceite
seriam dois consentimentos para a mesma coisa. **Isto é texto de base
legal: quem mexer conversa com o jurídico da Vaapty antes** (decisão
7), e o Derek autorizou esta redação sabendo que ela vai para lá.

**Está escrita como AUTORIZAÇÃO, não como descrição.** "O gerente
**pode** acompanhar — e ouvir" é o alcance concedido; não afirma que
alguém está ouvindo agora. A diferença é o que a mantém verdadeira
enquanto o áudio não existe.

**E ela enfraquece uma promessa, de propósito — é a parte que o
jurídico precisa olhar.** Antes: *"o áudio não fica gravado"*, ponto.
Autorizar a escuta ao vivo obriga o som a sair do aparelho, e o
compromisso que sobra é **não ficar guardado depois**. Quem construir o
áudio está preso a essa frase: **transmitir pode, reter não.**

**Qual redação o cliente ouviu fica gravado (0051).** `escuta_versao`
guarda a data de `CONSENTIMENTO_VERSAO`, e nulo quer dizer aceite
anterior a 16/09/2026 — transcrição sim, ouvir a sala não. Sem isso,
"autorizado às 14:32" não diz autorizado a **quê**, e no dia em que o
áudio existir não haveria como saber em quais atendimentos ele pode
ligar. **Não se reconstrói depois**: quem não perguntou na hora não
sabe mais o que foi dito. O painel do gestor marca esses aceites com
"aceite antigo, só o texto". **Quem mudar a redação muda a data
junto.**

---

**E o áudio foi construído no mesmo dia (0052).** O gestor aperta
"ouvir a mesa" e o som sai do celular do negociador **direto** para o
computador dele, abaixo de um segundo. WebRTC.

**Ponta a ponta não é preferência de arquitetura — é o que sustenta a
frase do aceite.** Com o som indo direto, **não existe lugar onde ele
pudesse ficar guardado**: não passa pela Vercel, pelo Postgres nem
pelo Storage. O que trafega pela 0052 é só o combinado da chamada, o
SDP dos dois lados. **Quem trouxer o áudio para o servidor "para
simplificar" desfaz a promessa que o cliente ouviu**, e aí a conversa
com o jurídico recomeça.

**Sem trickle ICE, de propósito.** O jeito completo manda os endereços
candidatos aos pingos e exigiria duas filas no banco e polling nos dois
lados. Esperar a descoberta terminar e mandar tudo dentro do SDP custa
uns dois segundos a mais e derruba metade das peças móveis. O teto de
3 s existe porque rede que não responde ao STUN deixaria o gestor
olhando para "conectando…" sem fim.

**O teto de 12 funções não foi tocado**: a sinalização é
`?recurso=escuta` no `api/atendimento.js`, pelo mesmo motivo das
indicações e do lead.

**O pedido chega de carona.** O aparelho do negociador já bate no
`?recurso=viva` de cinco em cinco segundos (decisão 44); a sessão vem
junto dessa resposta. Uma consulta própria dobraria o tráfego do
celular para uma pergunta que quase sempre responde "ninguém está
ouvindo".

**Só liga quando alguém aperta.** Fora disso o microfone não é
capturado para chamada nenhuma — poupa bateria e não produz som sem ter
quem escute.

**O negociador VÊ que está sendo ouvido**, numa tarja roxa no alto. Não
é cortesia: é ele quem responde ao cliente se for perguntado, e escuta
que roda escondida do próprio negociador é a forma mais rápida de
perder a equipe. Mesma razão da tarja da decisão 17.

**Quatro falhas silenciosas ganharam nome**, e é onde estava o trabalho
de verdade:

- microfone ocupado pela transcrição, ou permissão negada: o aparelho
  manda o motivo e ele aparece no painel;
- conexão direta que não fecha: a tela diz que precisa de um servidor
  de retransmissão (`TURN_URL`, `TURN_USUARIO`, `TURN_SENHA`, opcionais
  na Vercel). **Sem dizer isso, o gestor conclui que a mesa está em
  silêncio** — a leitura errada mais cara possível;
- som bloqueado pela política de autoplay: diria "ligado" sem tocar
  nada, então a tela manda clicar na página e tentar de novo;
- **conectado e mudo é indistinguível de sala em silêncio pelo
  ouvido**, então há um medidor de nível. Sem ele, o gestor tiraria
  conclusão sobre a negociação a partir de uma falha técnica.

**O que continua sem solução:** tela bloqueada do lado do negociador
suspende a captura, como já suspende a transcrição. É limite de rodar
no navegador.

**Conferido no ar em 16/09/2026** com dois navegadores: a chamada
fechou, o medidor mostrou áudio atravessando, a tarja apareceu no lado
do negociador e sumiu ao parar. **O que falta testar é o microfone de
verdade num celular** — se o `SpeechRecognition` e o `getUserMedia`
dividem o aparelho. No Android costumam; no iPhone é instável, e nesse
caso vira escolha entre transcrever e ouvir.

**O texto sim, e já estava quase pronto.** A transcrição sobe do
aparelho do negociador a cada cinco segundos desde a 0050; o que
faltava era o painel seguir. Quando o gestor abre um cartão na aba
"Em andamento", aquela linha passa a ser puxada de cinco em cinco
segundos — a **lista** continua em vinte, porque ela é um mural e vinte
atendimentos em cinco segundos seria pagar por movimento que ninguém
está olhando.

**O quadro mostra o FIM, e rola sozinho.** Quem abre o painel no meio
de um atendimento quer o que está sendo dito agora; rolar duas mil
palavras para chegar lá é o mesmo problema que o resumo (decisão 39)
resolveu para o passado. A transcrição inteira continua atrás de "ver a
transcrição", que é outra pergunta.

**E ele diz quando PAROU de chegar.** Celular bloqueado, aba no fundo,
reconhecimento de voz que caiu — qualquer uma dessas congela o texto, e
um quadro parado com "ao vivo" em cima faria o gestor concluir que a
mesa está em silêncio, que é a leitura errada mais cara possível.
Passados 45 segundos sem novidade — três voltas da sincronização — a
tarja troca de cor e diz há quanto tempo. **Quem mexer aqui mantém
essa distinção**; é ela que separa acompanhar de adivinhar.

**A tela diz que é texto e que atrasa.** Entre a fala e o quadro estão
o reconhecimento de voz, os cinco segundos do aparelho e os cinco
daqui. Chamar isso de "ao vivo" sem dizer o resto faria o gestor cobrar
pelo que ainda não chegou.

**Nada mudou na RLS.** Quem lê a `negociacao_viva` continua sendo o
gerente e o dono do atendimento (0033) — ler a mesa do colega segue
fora.

## Convenções do código

- **Português no domínio.** Estado, funções e rótulos em pt-BR
  (`faltando`, `etapaConcluida`, `filtrarPorCambio`). Não traduzir para
  inglês.
- **Um arquivo.** Tudo em `index.html`: tokens de estilo (`C`, `F`),
  helpers, componentes (`Campo`, `Toggle`, `Bloco`, `Pendente`), o
  componente único `VaaptyAponte`. Não há build — não introduzir um sem
  necessidade.
- **Persistência.** Só via `window.storage` (wrapper com prefixo `vp:` e
  fallback em memória, [index.html:21](index.html:21)). Três chaves:
  `vaapty:at` (ficha, incluindo o registro dos documentos gerados),
  `vaapty:sessao` (token do Supabase), `vaapty:veiculo` (id da linha no
  banco) e
  `vaapty:fotos` — esta última guarda **só o que ainda não subiu**.
  `set()` e `setVarios()` gravam a cada alteração; não chamar `setF`
  direto. `fRef` acompanha a ficha porque o registro de documento
  acontece depois de um `await` e não pode escrever por cima de estado
  velho.
- **Fotos.** Sempre por `comprimir()` — 1280 px, JPEG 0.72, máximo 12 —
  e sobem para o Storage assim que são tiradas. O estado de cada uma
  (`aguardando` → `enviando` → `ok` | `erro`) mora no objeto da foto;
  `fotosRef` é a versão autoritativa, porque upload assíncrono não pode
  ler estado velho de closure. Nunca voltar a guardar data URL de foto
  já enviada.
- **Placa mascarada.** `mascararPlaca()` deixa só primeira e última
  letra no descritivo público. Não expor placa cheia em material que vai
  para grupo.
- **`<Pendente>`** marca o que ainda não existe e por quê (vídeo do
  argumentos de objeção,
  escuta por IA). São promessas visíveis ao usuário — só remover junto
  com a entrega da funcionalidade.

## Limites conhecidos

A lista completa, com o que destrava cada item, está em
[PENDENCIAS.md](PENDENCIAS.md). **Quem resolver um item apaga de lá** —
lista que acumula item resolvido para de ser lida. Os principais:

- **O login existe, o CRM ainda não.** Nome e telefone de cliente já
  têm coluna (0004) mas ainda não têm tela. Enquanto a etapa 3 não
  chega, o sistema segue sem dado pessoal dentro.
- **O bloco do cliente ainda depende do botão.** Nome, CPF, RG e
  endereço gravam no `atendimento` quando alguém aperta salvar; até
  lá são daquele aparelho. Todo o resto do atendimento saiu dessa
  lista — ver decisões 43 e 44.
- **Link de foto vence em 1 h.** As miniaturas usam URL assinada. A
  lista é relida quando a aba volta ao foco (decisão 44), o que cobre
  o caso comum; quem fica uma hora na mesma aba sem sair dela ainda vê
  imagem quebrada até recarregar.
- **Chassi às vezes parcial.** Preenche sozinho só com 17 caracteres
  válidos (`chassiCompleto`); fora disso, digitar do CRLV. Renavam nunca
  vem da consulta.
- **Babel no navegador** custa ~1 s no primeiro carregamento.
- O README cita `vaapty_schema.sql` e `.env.example`; **nenhum dos dois
  está no repositório** — o esquema agora vive em `supabase/migrations/`.

## Próximo passo planejado

Postgres no Supabase, login por papel (pré-venda, negociador, gerente,
prep), fotos no Storage e as fichas saindo do aparelho para o servidor.

### 22. A régua do mês: o quadro da parede, em tela

O quadro branco da loja tem uma régua no topo: os 31 dias do mês, com
uma faixa verde marcando o quanto já foi feito. Ao lado, a tabela
NEG / META / REALIZADO. `ReguaDoMes` é isso, no topo do dashboard.

**A pergunta que ela responde é uma só:** já passou mais mês do que
entrou faturamento? A barra é a meta, preenchida na proporção do que
foi vendido; a régua logo abaixo são os dias, com hoje marcado. As duas
dividem a mesma largura **de propósito** — é o alinhamento que
transforma o atraso em distância física. Quem mexer no layout precisa
manter as duas com a mesma caixa.

**A leitura é em dias, não em porcentagem.** "43% da meta com 58% do
mês" pede conta de cabeça em pé na frente do quadro; "quatro dias atrás
do ritmo" não pede. É a mesma razão pela qual o desvalorizômetro fala
em perda por mês e não em percentual.

**A meta da loja é a soma de quem está ativo e é negociador.**
Prospecção tem `meta_valor` no cadastro (o padrão é 70.000) mas não
vende — somar as duas inflaria o alvo e faria todo mês parecer pior do
que foi. O cartão LOJA de `CartaoNegociador` usa o mesmo filtro; se um
dos dois mudar, o outro tem que mudar junto, senão a régua e o cartão
discordam na mesma tela.

**Quem vendeu e não está no cadastro aparece com "sem meta"** em vez de
sumir. É o caso dos atendimentos importados, cujo negociador veio só
como texto: esconder a linha para manter a tabela bonita esconderia
faturamento.

**A meta de cada um deixou de ser um número solto (0018).** Agora são
três campos — atendimentos, conversão, ticket médio — e o faturamento é
consequência: `meta_valor` e `meta_volume` viraram **derivados**,
calculados em `derivarMeta()` no `api/perfil.js` e em lugar nenhum
mais. O servidor não aceita `meta_valor` do cliente; quem gravar direto
cria duas verdades para a mesma meta. O volume é arredondado **antes**
de virar dinheiro para que a conta feche na tela: 30 atendimentos a 22%
dão 7 carros, e 7 × 25.000 é o número que aparece.

**No PATCH, só recalcula quando um dos três chega.** Sem essa guarda, um
"desativar" — que manda apenas `ativo` — zeraria a meta de quem ainda
está com os R$ 70.000 herdados do padrão antigo. Esses R$ 70.000
continuam de pé até alguém preencher os três, e a tela diz de onde eles
vieram em vez de fingir que são meta calculada.

**A meta da LOJA é digitada, não somada.** Somar as individuais
pressupõe que todo mundo bate a sua, o que não acontece em mês nenhum —
foi a correção do Derek em 01/09/2026. Ela mora em `meta_loja`, uma
linha por competência, sob `/api/perfil?recurso=meta-loja`. Por
competência e não linha única porque o dashboard sabe olhar meses
fechados: guardar só a atual faria agosto ser julgado pelo alvo de
setembro. Enquanto ninguém definir, a régua cai na soma **e diz que
caiu** — alvo sem procedência vira cobrança em cima de número que
ninguém escolheu.

**O ritmo necessário é aritmética, não previsão** — o que falta dividido
pelos dias que sobram. Não há tendência nem sazonalidade, e não deve
haver: projeção em cima de um mês de dado importado é número bonito e
mentiroso.

**O mês é escolhido no CRM, e manda na tela inteira.** O seletor fica
acima dos filtros de status — pílula de status dentro de um mês é outra
pergunta que pílula de status no ano inteiro — e vale para a lista de
atendimentos **e** para o dashboard, que recebe a competência por
propriedade. Ele nasceu dentro do `Funil` e subiu na primeira vez que o
Derek usou: filtrar só o painel deixa a lista embaixo mostrando outro
recorte, e duas verdades na mesma tela é pior que uma só.

**"Todos os meses" existe** porque procurar um cliente de abril não
pode exigir lembrar em que mês ele passou aqui. Nesse caso o dashboard
cai no mês corrente — ele mede um mês por definição — e o cabeçalho diz
qual.

Funil, régua, meta da loja e confiabilidade saem todos da mesma
competência — `gravarDesempenho()` passou a receber a competência junto
porque, sem isso, editar a confiabilidade de agosto gravaria na linha
de setembro.

**Resposta atrasada não sobrescreve mês novo.** Trocar de mês rápido
faz duas consultas correrem juntas; o `vivo` do efeito descarta a que
ficou para trás. Sem ele, os números de agosto podiam aterrissar
depois dos de setembro, sob o rótulo de setembro.

**Mês fechado não tem ritmo a corrigir.** "Quatro dias atrás do ritmo"
num mês que acabou é cobrança sem destino: a régua troca a frase por
quanto faltou ou quanto sobrou, e some com o traço de hoje.

**O mês virou America/Sao_Paulo, e isso era bug de verdade.** O
`api/funil.js` montava o período com `getUTCMonth()`. Em Joinville
(UTC−3), das 21h à meia-noite do dia 31 o relógio de Greenwich já tinha
virado o mês: `de` pulava para o dia 1 do mês seguinte e **o mês que a
loja estava fechando sumia da tela por três horas**. Agora os três
lugares que precisam saber que dia é hoje — `api/funil.js`, a
competência do desempenho em `api/perfil.js` e a régua — usam
`toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })`.
**Quem escrever data nova usa o mesmo relógio.**

### 23. Estoque: o carro depois que o negócio fecha

Até a 0019 o sistema terminava no contrato assinado. O que vem depois —
o carro parado no pátio, custando dinheiro — não existia em lugar
nenhum. `TelaEstoque` é isso, atrás de "Estoque e custos" na gestão.

**A ideia é uma só: custo previsto contra custo real.** Na mesa se
combina débitos de R$ 3.000 e quitação de R$ 28.000; na prática se
consegue desconto na quitação, aparece juros que ninguém viu, o carro
precisa de pneu. Guardar só o total final esconde de onde veio a
diferença — e a diferença é o lucro. Por isso o custo é **linha a
linha**, cada uma com previsto, realizado e comprovante.

**O previsto nasce do check list, e ninguém redigita.** Débitos,
quitação e cautelar já foram digitados uma vez; a entrada no estoque
copia esses números e marca as linhas com `do_fechamento`. É isso que
separa "o negócio combinou isso" de "alguém digitou isso depois".

**A comissão não é custo.** Ela é retida do cliente, não paga por nós:
somar viraria custo inventado. A conta fecha — negociado R$ 40.000 com
comissão de R$ 2.000 dá custo de R$ 38.000, que é o líquido ao cliente
mais os débitos e a cautelar que a Vaapty desembolsa.

**`realizado` nulo é "ainda não pagou"; zero é "pagou zero".** São
coisas diferentes — zero é a conta perdoada, o desconto integral.
Tratar as duas igual esconderia justamente o desconto que se conseguiu.
Por isso a coluna aceita null, e por isso ela se chama `realizado` e
não `real`: `real` é tipo do Postgres e a coluna precisaria de aspas em
toda consulta.

**Existe um terceiro número, o "custo hoje":** o que já foi pago mais o
previsto do que ainda não foi. Sem ele, um carro com nada pago
mostraria custo igual à compra, e todo carro novo pareceria barato. A
tela diz quantas contas estão em aberto sustentando esse número.

**O carro não entra sozinho.** A entrada é um ato: alguém confere e
confirma, e é aí que o previsto nasce. Automatizar no fechamento
traria para o pátio todo negócio marcado como fechado por engano — e
desfazer custa mais que um toque. A fila mostra os 8 mais recentes
porque há 55 fechados importados da planilha, e negócio de agosto
escondendo o carro que fechou hoje seria pior que a fila comprida.

**Um carro entra uma vez** — índice único em `estoque (veiculo_id)`. Sem
ele, dois cliques no botão criariam duas fichas de custo para o mesmo
carro e o total dobraria.

**O comprador é cadastro, não texto solto.** O mesmo lojista leva
dezenas de carros; sem cadastro, "AUTO CENTER SUL" e "Auto Center Sul"
viram dois compradores e o histórico se parte no meio. `shinkai_id`
está lá para quando o cadastro vier de lá — hoje não vem.

**A margem aparece antes de confirmar a venda**, e é de propósito: é a
última chance de ver que o carro está saindo no prejuízo.

**Apagar linha de custo é do gerente.** Linha apagada some com a
explicação da margem, e isso é conversa de gerente — a RLS da 0019
separa o `delete` do resto, que é da equipe.

**Os três recursos moram em `api/veiculo.js`** (`?recurso=estoque`,
`custo`, `comprador`), pelo teto de 12 funções. Mesmo truque das
indicações em `/api/atendimento` e da meta da loja em `/api/perfil` —
mas aqui a costura não é arbitrária: os três são o carro depois que ele
passa a ser nosso, que é o assunto do arquivo. **O comprovante reusa
`anexo` (0008) e o bucket que já existe** — bucket novo significaria
política nova de Storage e mais um lugar para o arquivo se perder.

**O que ainda não existe:** contas a pagar de verdade (hoje `pago_em` é
só uma data na linha) e a ponte com OMIE ou Conta Azul. Os dados já
nascem no formato que essa ponte vai pedir — linha, valor, data,
comprovante — mas nenhuma integração foi escrita.

### 24. A casca: navegação fixa, e cada destino é uma página

O Derek olhou o sistema em 01/09/2026 e disse: "menus mal posicionados,
péssimo UX, aparência feia". Ele tinha razão, e a causa era uma só: o
sistema era uma tela de celular que crescia com a janela. Botão de
1.400 px, tabela de dez colunas a 10 px, e os destinos da gestão —
painel, estoque, leads, administrativo — numa sanfona dentro da lista
de atendimentos, o painel numa segunda sanfona dentro da primeira.
**Navegação era um widget.**

**Agora há uma casca única** (`Shell`): barra lateral no desktop
(≥ 1024 px), barra inferior no celular com três destinos de todo dia
mais "Mais". Cada destino é uma página com `Cabecalho` — título, uma
linha de contexto, e no máximo uma ação principal. O mês mora no `App`
e entra no cabeçalho das páginas que medem um mês. **Quem criar tela
nova a registra em `destinosPara()` e a roteia no `App`**; tela sem
entrada lá não existe para o usuário.

**O atendimento aberto (`VaaptyAponte`) fica fora da casca**, de
propósito: é um fluxo guiado de oito etapas com trilho próprio, e a
barra inferior competiria com o trilho pelo polegar.

**As fontes nomeadas nunca foram carregadas.** `F` citava Archivo,
Public Sans e Roboto Mono, mas não havia `<link>` — cada aparelho caía
num fallback diferente e o mono virava Courier. A escolha agora é a
fonte do sistema, de propósito: zero download, e é a fonte que o
negociador já lê o dia inteiro. **Não adicionar Google Fonts sem uma
razão que valha o download no 4G da loja.**

**Verificação visual passou a ser possível**: o Chrome do Derek tem a
sessão aberta, e o `claude-in-chrome` enxerga as telas logadas sem
tocar em credencial. Até aqui tudo era publicado às cegas — e é por
isso que o resultado era colcha de retalhos. **Antes de dar uma tela
por pronta, olhar nela logado.** O `resize_window` do Chrome não
encolhe a janela abaixo de ~1.300 px no Mac; para conferir o celular,
injetar CSS que esconde a `aside` e limita `#raiz` a 390 px.

### 25. Rentabilidade: a planilha CONTROLE DE VEÍCULOS, calculada do estoque

O Derek mandou em 03/09/2026 a planilha de rentabilidade de agosto. Ela
tem duas abas: a primeira é a compra (o que o check list já guarda); a
segunda, **CONTROLE DE VEÍCULOS / CLIENTES**, fecha a conta por carro
vendido e soma por negociador. A conta dela é:

```
bruta   = venda − valor cliente − débitos − quitação − deduções
líquida = bruta − cautelar − comissão externa
```

Isso é `venda − custo` do estoque (0019), **desde que o custo tenha as
duas linhas que faltavam**: DEDUÇÕES (diferença de quitação, restos) e
COMISSÃO EXTERNA (paga a quem trouxe o comprador). A 0020 acrescenta
os dois ao enum. `rentabilidadeDe()` separa custo *do carro* (débitos,
quitação, dedução — `CUSTO_DO_CARRO`) de custo *da venda* (o resto)
por tipo da linha; quem criar tipo novo decide de que lado ele fica.

**A vista mora dentro do Estoque**, no filtro "Rentabilidade", e
obedece ao mês do cabeçalho. É conta na tela, não no servidor — a
lista do estoque vem inteira (teto 300), diferente do CRM paginado.
Passou de 300 carros, isto vai para `api/veiculo.js`.

**A planilha só sabe a semana da venda, não o dia.** Por isso
`semana_venda` existe ao lado de `vendido_em`; `semanaDe()` prefere a
coluna e deriva do dia quando ela falta. E a coluna DATA da planilha é
a **data da compra**, que bate com a aba 1 — vira `entrou_em`.

**Carro importado não tem atendimento**, então negociador, meio de
alcance e prospector ficam em texto no `estoque` (como o lead de
indicação). Carro que entra pela fila copia os três do atendimento.

**A importação é colada, como a do CRM**, e faz cinco idas ao banco
em lote, não cinco por linha — sessenta linhas em requisições
individuais estourariam o tempo da função. `NÃO VENDIDO` e `ADAM
ASSUMIU` na coluna COMPRADOR não viram comprador: o primeiro entra no
pátio, o segundo é um caso que a casa ainda vai explicar. Placa já no
estoque é pulada e devolvida em `pulados`, nunca duplicada.

**A cautelar custa 160–180 e é cobrada a 390.** Isso apareceu ao
cruzar as duas abas: a diferença é margem, e é exatamente o
previsto-contra-realizado que o estoque foi feito para mostrar.


### 26. Financeiro: a pasta do banco vira área restrita

A pasta "Financeiro Joinville" (janeiro/2024) tem seis abas amarradas:
Lançamentos (o extrato categorizado, com saldo corrido), DRE (SUMIFS
por categoria + rentabilidade dos carros = lucro), Negociação (por
carro: pago cliente / quitação / pago lojista), Salarios, Vales e
Retiradas. A 0021 é isso em tabelas `fin_*`, e `TelaFinanceiro` são as
quatro abas: Lançamentos, DRE, Carros, Folha.

**Restrito na RLS, não na tela.** `perfil.financeiro` (como o
`administrativo` da 0012) e `e_financeiro()` guardam todas as tabelas
`fin_*` — ler, escrever e apagar. Para quem não tem o sinalizador, o
PostgREST devolve lista vazia e recusa escrita; a tela só esconde o
destino por cortesia. Gerente sempre entra.

**A 12ª função veio do `api/config.js`**, que virou `?recurso=config`
em `api/perfil.js` — é o único recurso de lá que responde sem token,
e só entrega o que é público (URL e chave anônima). Financeiro merecia
arquivo próprio; costurar isso no `veiculo.js` seria esconder a área
mais sensível do sistema no lugar menos óbvio.

**Competência ≠ data.** A luz de dezembro paga em janeiro é despesa de
dezembro: cada lançamento tem as duas. A lista de lançamentos filtra
por **data** (é assim que se confere contra o banco); o DRE soma por
**competência** (é assim que se lê o mês).

**O DRE é o da planilha:** por categoria, `crédito − débito` (despesa
sai negativa), só das categorias com `no_dre`; negociação, retirada e
transferência ficam fora, e os carros entram pela **rentabilidade
líquida dos vendidos no mês** — a mesma conta da tela de
rentabilidade, repetida em `api/financeiro.js` porque o servidor não
carrega o `index.html`. **Quem mudar uma precisa mudar a outra.**

**Colar o extrato não duplica.** A chave `data + descrição + valor`
por conta é única; colar o mês de novo só acrescenta o que faltava
(`resolution=ignore-duplicates`). "Saldo Anterior" vira o saldo
inicial da conta, não lançamento. Categoria desconhecida é criada como
despesa e a tela pede para conferir o grupo.

**A placa na descrição liga ao carro.** "Pagto cliente Uno_AYL0614" é
a convenção da planilha; `placaNa()` acha a placa, e `tipoNegNa()` a
parte do negócio (cliente, quitação, débitos, lojista, reembolso). É
isso que a aba Carros cruza com o estoque: combinado × pago, por
carro. Descrição fora da convenção só perde o vínculo automático.

**A folha grava o líquido.** `salário + comissão + bonificação − vales`
é calculado no servidor e gravado em `fin_folha`, para que a folha de
janeiro não mude se a regra mudar em março. A comissão é digitada —
a regra de comissão da casa não está em lugar nenhum ainda.

**Um lançamento pode ser repartido (0024).** O extrato traz UM PIX para
o despachante; na verdade aquilo é a documentação de dois carros —
custo de carro, fora do DRE — mais uma taxa da loja, que entra.
`fin_rateio` é essa repartição, e o mesmo mecanismo serve aos outros
três casos: salário e comissão da mesma pessoa numa transferência só,
e um pagamento que cobre duas partes de um negócio.

**O que sobra não some.** A soma das partes pode ser menor que o
lançamento; a diferença continua na categoria do cabeçalho. Sem essa
regra, um rateio incompleto tiraria dinheiro do DRE em silêncio — e
`partesDe()`, no servidor, é o único lugar que decide isso. **DRE,
DRE de vários meses e a aba Carros passam todos por ela**; quem somar
pelo cabeçalho de novo volta a perder o rateio.

**Categoria diz o que ela exige.** `grupo = 'negociacao'` pede carro e
parte do negócio; `pede_funcionario` pede a pessoa. Sem a pessoa,
salário e comissão não conciliam com a folha; sem a parte, o
lançamento não bate com o combinado do carro. A borda do campo fica
laranja enquanto falta.

**A conferência da negociação é o previsto contra o lançado.**
`?recurso=negociacao&estoque_id=` devolve o que aquele carro combinou —
cliente, quitação, débitos, lojista — e quanto já foi lançado em cada
parte. É o "está de acordo?" na própria linha do extrato.

**A competência é editável na linha.** Ela é o mês a que a despesa
pertence, não o do pagamento, e é ela que o DRE soma: corrigir isso não
pode exigir apagar e relançar.

**O título e o movimento do banco são a MESMA linha (0025).** O título
nasce `aberto`, com vencimento e sem conta; quando o extrato traz o
pagamento, a mesma linha vira `efetivado` e ganha a conta, a data real
e a chave do banco. Duas linhas — uma prevista e outra realizada —
obrigariam a decidir a cada soma qual das duas contar, e a resposta
erra metade das vezes.

**A lista de lançamentos e o saldo só olham `efetivado`.** Título em
aberto misturado ali viraria saldo que o banco não tem. O DRE também
soma só o efetivado — é o número que o Derek confere hoje — e devolve
`em_aberto` à parte, para não mudar o significado da linha sem ele
saber.

**O casamento automático é por valor e vencimento, nunca por nome.**
Nome de favorecido no extrato do Itaú raramente bate com o que se
digitou. A janela é de sete dias, porque boleto pago no dia seguinte é
regra e não exceção. **Dois títulos do mesmo valor na mesma semana não
casam nenhum** — chutar qual é seria pior que deixar para a pessoa.

**`revisar` é o que o acerto automático deixa aceso.** Casei este
movimento com aquele título; confira. Sem esse sinalizador, conciliação
automática vira conciliação invisível — e é o tipo de coisa que só se
descobre quando o saldo não fecha três meses depois.

**O que ainda não existe:** conciliação automática contra o estoque (a
aba Carros mostra, não concilia) e o cartão de crédito por fatura.

### 27. Pré-vendas: o lead e o agendamento são a mesma linha

O funil da pré-venda tinha duas metades soltas. Os leads de indicação
(0011) eram só uma origem entre várias, e o agendamento não existia em
lugar nenhum — era WhatsApp e cabeça. Quando o cliente chegava, o
negociador redigitava nome, telefone e carro que a pré-venda já tinha
perguntado ao telefone.

**Uma tabela, não duas.** Um agendamento é um `lead` com
`agendado_para` preenchido. Duas tabelas obrigariam a um join em toda
tela e a decidir, a cada remarcação, se nasce agendamento novo ou se o
velho muda — e nenhuma das duas respostas ajuda quem está com o
telefone na orelha. As duas abas da tela são dois filtros da mesma
lista: `?fila=funil` (novo, em contato) e `?fila=agenda` (agendado,
confirmado).

**A tela inteira serve a um gesto: sair da ligação com o cliente
agendado.** A barra de captura fica sempre visível, com foco no nome, e
Enter grava e limpa para o próximo — quem atende telefone não procura
botão de "novo". "Salvar e agendar" abre o agendador já com o lead
criado.

**O agendador é de três toques**: dia (chips de Hoje, Amanhã e os
próximos cinco), hora (`HORARIOS`, os horários que a loja usa) e
negociador. Campo de data e hora livres ficam ao lado para o caso que
foge da régua — mas o caminho rápido não passa por eles.

**Remarcar guarda a data velha** em `remarcacoes` (jsonb), como as
`revisoes` da cautelar: quantas vezes o cliente remarcou é o que diz se
ele vem mesmo, e some no primeiro clique se só a última data ficar. E
remarcação **derruba a confirmação** — quem confirmou quarta não
confirmou sexta.

**A confirmação é um toque e o WhatsApp já abre escrito.** É o que a
pré-venda faz na véspera, sessenta vezes seguidas: `zap()` monta o
`wa.me` com 55 na frente de número sem DDI, senão o link abre conversa
vazia.

**"Chegou" cria o atendimento no servidor**, não na tela: nome,
telefone, carro, origem e prospector saem do lead, o status nasce
`cliente_na_loja` e a tela abre o atendimento já pronto. É o ponto
inteiro desta aba — ninguém redigita com o cliente parado na frente da
mesa. A ação é **idempotente**: lead que já tem `atendimento_id`
devolve o mesmo id em vez de criar um segundo.

**Dia que passou fica em laranja** com "passou e ninguém marcou". O
agendamento que ninguém resolveu é o vazamento silencioso do funil — se
ele apenas sumisse da lista, ninguém saberia que existiu.

**E "não veio" era um vazamento de verdade, desses que só aparecem no
uso.** A fila da agenda mostra `agendado` e `confirmado`; o funil
mostrava `novo` e `em_contato`. Ao marcar "não veio", o lead saía dos
dois e **não entrava em lista nenhuma** — sumia do sistema com o
cliente ainda por atender. O Derek viu em 15/09/2026. `nao_compareceu`
passou a entrar no funil: quem não veio é justamente quem precisa de
ligação.

**Retorno sem data não é retorno.** "Ligar depois" gravava `hoje` sem
perguntar — o lead voltava para a fila do próprio dia e não lembrava
ninguém de nada. `QuandoVoltar` pergunta, e **chips vêm antes do
calendário**: quem está com o telefone na orelha diz "me liga terça",
não abre seletor de data. Mesma régua do agendador de três toques.

**A anotação entra com a data na frente.** Sem isso, três retornos
viram um parágrafo sem dono e ninguém sabe o que foi dito quando.

**No dia marcado, lead e indicação aparecem no "Meu dia"** — sem hora,
junto do plano, porque são "hoje" e não "às 14h". **Nada é copiado para
a `agenda`** (decisão 41): entram na leitura, como o atendimento, e
assim remarcar a data ou mudar o status não deixa uma cópia velha para
trás.

**Perdido é fila, não lixeira — e a régua é do Derek:** *"enquanto a
pessoa tem um carro para vender, mesmo que ela não queira, é lead"*.
Quem não quer hoje quer em seis meses; quem some do sistema não é
reencontrado. Então perdido não é desinteresse, é estar **fora do
negócio**: já vendeu para outro, não tem carro, procurava comprar, ou
queria empréstimo — as quatro respostas de `PorQuePerdeu`.

**O motivo é perguntado, e é isso que salva a fila.** Sem ele "perdido"
vira o botão que se aperta para tirar da tela, e a lista fica limpa
mentindo. Com o motivo escrito, dá para responder quantos a loja perdeu
**para a concorrência** — a única das quatro que cobra algo da equipe.
E da aba Perdidos o lead volta para a fila: cliente que vendeu fora
hoje troca de carro daqui a dois anos.

**Mora em `api/atendimento.js` sob `?recurso=lead`**, pelo teto de 12
funções — mas a costura não é arbitrária: o lead existe para virar
atendimento, que é o assunto do arquivo.


### 28. O que faz um BPO preferir o Conta Azul, e o que dá para ter aqui

A pergunta do Derek em 04/09/2026: um BPO exigente quer integrar o
Conta Azul; dá para resolver com o nosso? A 0026 fecha quatro buracos
que eram os motivos reais.

**O extrato do Itaú já traz o CNPJ, e ninguém estava usando.** "PIX
ENVIADO BARBOSA CONSULTORIA LTDA 62.762.461/0001-59" carrega o
documento de graça. `docNa()` o extrai e a importação cria ou liga o
`fin_favorecido` sozinha — o cadastro de fornecedores se monta pelo
uso, sem ninguém digitar. **O documento é a chave, não o nome:** o
nome vem escrito de um jeito no extrato e de outro no contrato; o CNPJ
não muda. Corrigir o nome uma vez conserta todos os lançamentos
daquele fornecedor.

**Parcelamento e conta fixa são o mesmo gesto.** "Repetir" gera N
títulos amarrados por `grupo_id`; com "dividir o valor" é a compra em
12×, sem dividir é o aluguel do ano. **Gera tudo de uma vez de
propósito** — não há tarefa agendada neste sistema, e uma regra
invisível que alguém precisa lembrar de rodar é pior que a fila cheia.

**O fluxo projetado é a pergunta de segunda-feira.** Saldo de hoje
mais o que vence, semana a semana, e a data em que fica negativo. A
lista de títulos sozinha não responde "dá para pagar a folha dia 5". O
vencido entra na primeira coluna, porque a conta continua devendo.

**BPO responde por número, e número sem histórico não se defende.**
`fin_log` é um gatilho `after update` que anota só o que muda um valor
ou um mês — valor, competência, categoria, situação, conta, data,
vencimento. Anotar mudança de descrição encheria a tabela e esconderia
o que importa. A política é **só de leitura**: quem escreve é o
gatilho, que roda como dono.

**O que o Conta Azul faz e nós não fazemos — e não vamos fazer sem
decisão sua:** emitir nota fiscal (precisa de certificado digital e
integração com a prefeitura), emitir boleto (precisa de convênio com o
banco) e puxar o extrato sozinho por API bancária (o Itaú exige
contrato de Open Banking; aqui o OFX é baixado à mão). O resto — a
conciliação, o DRE, o fluxo, a folha, o rateio — está aqui, e amarrado
ao carro, que nenhum ERP genérico faz.


### 29. Duplicidade na importação: duas redes, e a conferência antes

A integração direta com o Itaú não vai acontecer — o portal do banco
não expõe extrato de conta corrente para autoatendimento, e o Open
Finance exige ser instituição autorizada. Fica o OFX baixado à mão, e
então **não duplicar é a única coisa que precisa estar certa.**

**Rede 1 — a chave do banco.** Índice único em
`(conta_id, chave_extrato)`. No OFX a chave é o FITID mais data e
valor; na planilha é data + descrição + valor. Isso barra o mesmo
arquivo importado duas vezes.

**Rede 2 — data e valor, por contagem.** A rede 1 não barra o mesmo
movimento vindo por caminhos diferentes: a planilha de agosto e o OFX
de agosto montam chaves de formatos distintos para o mesmo PIX. Nem
barra o banco reemitindo FITID diferente para o mesmo período. Então a
importação conta quantos movimentos com aquela data e aquele valor já
existem na conta e **só deixa entrar o excedente**.

**É contagem, não presença** — e essa distinção é a razão de a rede 2
existir desse jeito. Dois PIX de R$ 100 no mesmo dia são dois
movimentos de verdade; barrar o segundo apagaria dinheiro do saldo. Se
o banco já tem um e o arquivo traz dois, entra um.

**Conferir antes de gravar.** `?recurso=importar&acao=conferir` roda
tudo e não escreve nada: diz quantos entrariam, quantos já existem e
quantos casam com título em aberto. A tela obriga a passar por ele —
descobrir depois que entrou repetido se conserta apagando linha a
linha, e é assim que se perde a confiança no saldo.

**O PATCH do casamento não derruba a importação.** Ao baixar um título,
a chave do extrato pode já pertencer a outro lançamento da conta. O
`try` refaz o PATCH sem a chave: baixar o título continua valendo, e o
que se perde é só a amarração com o identificador do banco.


### 30. O check list de documentações: a folha do envelope

O Derek fotografou a folha que fica no envelope de cada carro fechado:
36 itens, e cada um recebe **três vistos** — administrativo, gerência e
financeiro. Vive na aba Administrativo, ao lado da conferência do
negócio, e a 0027 é ela em tabela.

**Uma linha por item, não um blob.** São 36 itens × 3 vistos; num jsonb,
"quem marcou dívida ativa e quando" viraria arqueologia, e "quais
carros estão parados esperando o dossiê" seria impossível de consultar.
Linha por item dá o histórico de graça.

**O visto é boolean NULO, não falso.** No papel são duas caixinhas, Sim
e Não. "Ainda não conferi" e "conferi, e é Não" são coisas diferentes —
tratar as duas como `false` esconderia exatamente o que falta fazer.
Clicar de novo no mesmo botão volta para não respondido.

**A lista de itens mora no código, não no banco.** Ela muda quando a
casa muda o processo, e migração para acrescentar uma linha de
conferência seria atrito à toa. `ITENS_DOC` em `api/checklist.js` é a
fonte, e a tela a recebe do servidor — assim as duas não divergem.

**Quem carimba é o servidor.** O visto grava quem e quando a partir do
token, e `adm`/`gerencia` só de quem é administrativo ou gerente. A
tela desabilitar o botão é conveniência; a recusa é no servidor.

**O papel é anexado antes, e conferido na tela.** Cada item que é um
documento tem os seus arquivos, guardados na tabela `anexo` que já
existe com o rótulo `doc:<código>` — bucket novo significaria política
nova de Storage e mais um lugar para o arquivo se perder. O visor abre
o PDF ou a imagem **dentro da página**, com setas para percorrer todos
os anexos do item: a conferência acontece no celular, e obrigar a
baixar cada PDF seria voltar para o papel. O link "abrir" fica ao lado
porque o Safari do iPhone às vezes se recusa a desenhar PDF embutido,
e a tela precisa dizer o que fazer em vez de mostrar um retângulo
branco.

**"Visto e sem anexo" é um aviso no topo.** O administrativo anexa
antes; a conferência olha o que está lá. Sem esse aviso, "sim" vira
palavra sem lastro. Os itens que são pergunta de sim/não — *Trocar de
placa?*, *Tem financiamento?* — não pedem anexo, e cobrar deles seria
ruído; o quinto campo de `ITENS_DOC` faz essa separação.

**Quem aprovou aparece escrito, não em tooltip.** Nome e dia embaixo
do par Sim/Não. Aprovação anônima não responde a pergunta que importa
quando algo dá errado.

**Consulta de órgão é link, não raspagem** — mesmo raciocínio dos
canais de preço na avaliação. Detran-PR, PGFN e PRF abrem em aba nova
direto da linha do item, e um item pode ter mais de uma consulta.
**Dossiê do Detran e extrato de dívida ativa são coisas diferentes** —
o dossiê é o histórico do veículo, a dívida ativa é o que está inscrito
para cobrança — e juntá-los num link só foi erro meu, corrigido em
05/09/2026. **O ConsultCenter pede login, e o sistema não
guarda essa credencial**: o link abre o portal e a pessoa entra com a
senha dela. Guardar senha de terceiro aqui transformaria um vazamento
nosso num vazamento lá.


### 31. Táticas de negociação: o motor é nosso, o conteúdo também

O Derek trouxe o *Compêndio 100 Táticas de Negociação* da Profa. Maria
Regina Xausa. **Todas as páginas dizem "Reprodução Proibida. Direitos
Reservados"**, com o e-mail da autora no rodapé. Transcrever as quatro
colunas dela para dentro do sistema seria reproduzir a obra, então
não foi feito.

**O que está no código é escrito com as palavras da casa**, sobre as
manobras que aparecem quando uma pessoa vende o próprio carro — doze,
não cem: `Jogo de planilhas` e `Leilão` são táticas de compra
corporativa e não acontecem nessa mesa. Os NOMES das táticas
(ancoragem, autoridade limitada, ultimato, silêncio) são termos
correntes da literatura; o que seria cópia é a redação dela.

**Se a casa quiser o compêndio dentro do sistema, o caminho é pedir
autorização por escrito à autora** — e aí trocar o conteúdo de
`TATICAS`, e nada mais. O motor não muda.

**Duas camadas de leitura, e a de baixo é a que sempre funciona.** A
busca por expressão acende sozinha, de graça, e não erra por não
tentar entender. A leitura por IA é um **botão**, não automática: custa
por chamada, e é o negociador que sabe quando a conversa virou.

**A camada de IA existe porque a de expressão tem um limite honesto:**
"não tenho outra proposta" acende o mesmo sinal que "tenho outra
proposta" numa busca de termo. Negação, ironia e contexto pedem
modelo.

**A chave `ANTHROPIC_API_KEY` só existe no ambiente** e, sem ela, o
endpoint diz isso em vez de falhar calado — descobrir que a variável
não subiu no meio de uma negociação seria pior que o botão não existir.
**Só o texto da conversa é enviado**: nome, telefone e CPF não vão
junto. A transcrição já é dado sensível; mandar o cadastro junto
ampliaria o vazamento sem melhorar a leitura.

**O modelo é o mais barato da família, e isso é decisão.** Ler meia
página de transcrição e dizer qual manobra é não pede o modelo grande;
Haiku custa uma fração e acerta essa tarefa. `IA_MODELO` e `IA_JANELA`
são variáveis de ambiente justamente para o Derek subir ou descer o
gasto **sem deploy**. A janela de 2.500 caracteres é o fim da conversa
— uns cinco minutos de fala — porque é o trecho que importa e cada
caractere a mais é dinheiro.

**O consumo volta na resposta e aparece na tela.** Quem paga por
chamada precisa ver o que o clique custou, não descobrir na fatura.

**As táticas só aparecem na Negociação.** Na Pesquisa o cliente ainda
está contando a história do carro, e sugerir manobra ali é ruído.

### 32. Fechamento: a planilha de orçamento e provisão, previsto × realizado

O Derek mandou em 04/09/2026 o `Controle_Financeiro_Completo`. São
sete abas, e a que manda é a aritmética entre três delas: **ORÇAMENTO
E PROVISÃO** (o previsto), **FLUXO DE CAIXA** (o realizado) e **SALDO
FINAL**, que fechava as duas numa coluna DIFERENÇA. É um DRE gerencial
de franquia:

```
receita operacional bruta
− despesas VARIÁVEIS      andam com a venda
= MARGEM DE CONTRIBUIÇÃO
− despesas FIXAS          existem mesmo sem vender
= resultado
```

**Variável contra fixa não é enfeite contábil.** É o que responde
quanto sobra por carro e quanto a loja custa parada — duas perguntas
que o DRE por categoria (decisão 26) não responde, porque lá tudo é
uma lista só. Por isso a categoria ganhou `tipo_custo` (0028): o
`no_dre` dizia se entra, não **onde** entra. A migração classifica as
sete que a planilha trata como variáveis (cartório, cautelar,
comissão, consultas, correio, despachante, motoboy); o resto cai em
fixa, que é o padrão, e o gerente corrige na própria tela.

**Faturamento aqui é a margem dos carros, não o preço deles.** Na
planilha, 69 carros deram ticket médio de R$ 4.676 — é o que a loja
ganha por carro, não o que o carro custa. Quem trocar isso pelo valor
de venda infla a receita vinte vezes e faz toda despesa parecer
irrelevante. E é a margem **bruta**, não a líquida: cautelar e
comissão externa aparecem logo abaixo como despesa variável, e a
líquida já as desconta — entrariam duas vezes.

**O previsto é digitado; o realizado nunca.** `fin_orcamento` guarda
uma linha por categoria por competência, mais as duas premissas que
não são categoria (`veiculos` e `ticket`, em `linha`) — sem elas o
faturamento previsto não tem de onde sair. O realizado passa pelo
mesmo `partesDe()` do DRE, então rateio conta igual nos dois lugares.
**Quem mudar um precisa mudar o outro.**

**Sem `on_conflict`:** os dois índices de unicidade são parciais (um
para categoria, outro para linha) e o Postgres não infere índice
parcial no ON CONFLICT — o mesmo tropeço do `fin_favorecido_doc`. O
`PUT` procura e decide, como o `api/veiculo.js`.

**Copiar o mês anterior existe porque orçar do zero é o que faz o
orçamento morrer no terceiro mês.** Ele apaga a competência de destino
antes de copiar, para que repetir o botão convirja em vez de duplicar.

**A diferença é pintada pelo lado certo.** Em receita, mais é bom; em
custo, menos é bom. Uma cor só faria economia de despesa parecer
prejuízo — e é justamente a economia que o fechamento existe para
mostrar.

**A célula de previsto é componente de topo, não declarado dentro do
`FinFechamento`.** Componente criado dentro de outro vira tipo novo a
cada render: o React remonta o campo e o foco se perde a cada tecla —
o mesmo que já derrubou o formulário do cliente (decisão 7).

### 33. A conta do negócio virou composta

Três coisas que o número solto escondia, e que apareceram no uso em
08/09/2026.

**"Débitos" era um número.** Na mesa se diz "R$ 1.200 de débitos"; no
envelope, três meses depois, ninguém sabe se era IPVA, licenciamento
ou multa — e é essa lista que o cliente contesta. `debitos_itens`
(0029) guarda o detalhe, e **o detalhe manda**: havendo item,
`valor_debitos` é a soma dele, na tela, no contrato e no check list
impresso. A primeira linha de detalhe **herda o total que já estava
digitado** — detalhar diz do que o número é feito, não zera o que foi
combinado.

**Nem todo negócio desconta as mesmas linhas.** `modo_conta` tem dois
valores: `com_comissao` (saem cautelar, débitos, quitação e a comissão)
e `limpo` (a comissão não sai — o valor combinado já é o que o cliente
leva). Descontar comissão num negócio limpo tira dinheiro do cliente
no papel que ele assina, e o erro só aparece na hora do PIX. No modo
limpo o campo continua na tela, riscado, e o valor continua guardado:
trocar de modo e voltar não pode apagar número digitado. E a linha
**não imprime** — desconto no papel é dinheiro a menos.

**"Entre outros".** Despachante, guincho, segunda via de chave:
`descontos_extras` é a lista do que não tem linha fixa.

**A soma vive em `descontosDe()`, e só ali.** Foi o primeiro defeito
do dia: o campo mostrava a soma dos itens enquanto o líquido usava o
total antigo. Duas contas na mesma tela é pior que uma só errada.

**Na entrada do estoque, cada débito detalhado vira uma linha de
custo.** É o mesmo "previsto contra realizado, linha a linha" da
decisão 23 — uma linha só de "Débitos do veículo" esconderia o
desconto que se consegue numa multa e não na outra. A comissão nunca
entra como custo, pela decisão 23.

### 34. A conferência do administrativo ganhou o resto do negócio

A aba mostrava 36 caixas de visto e mais nada. Faltavam três coisas
que estavam em outras telas, e a distância era o problema.

**O papel anexado na negociação é o papel do item.** A conferência só
enxergava anexo com rótulo `doc:<código>`, então a CNH que o
negociador subiu ficava invisível ali e o administrativo pedia de novo
o que o sistema já tinha. `ANEXO_DE_ITEM` traduz os rótulos da
negociação (CNH, comprovante de residência, laudo cautelar, contrato
assinado, CRLV) para os itens; `DOC_DE_ITEM` faz o mesmo com o que o
**próprio sistema emitiu** — contrato, pré-contrato, check list,
autorização de cautelar. O que não cai em item nenhum aparece em
"Também no negócio", em vez de sumir.

**A folha aceita item que só existe naquele carro.** A lista fixa segue
no código (0027) porque muda com o processo, não com o carro; o item
`extra_...` carrega o próprio rótulo na linha (0029). Apagar é do
administrativo também, não só do gerente: quem criou por engano
precisa desfazer sem chamar alguém.

**Os gastos aparecem aqui, com a mesma base do estoque.** Não é
duplicação de tela: quem confere o envelope é quem está com a nota do
despachante na mão, e mandar essa pessoa para outro menu é como o
custo real deixa de ser lançado.

**O contrato se corrige e se reemite dali.** O que muda depois de
assinado é sempre a mesma coisa: um número do negócio, um dado do
cliente errado na CNH, o renavam que ninguém tinha. Cada emissão é uma
linha nova em `documento`, com protocolo novo. **As cláusulas não se
editam** — o texto é o que a casa manda assinar, e duas redações com o
mesmo nome viram dois contratos diferentes; mudança de cláusula passa
pelo jurídico e vira código (decisão 7).

### 35. O trilho do fechamento

O Derek olhou a etapa T e disse que estava confusa. Estava: seis blocos
empilhados numa ordem que só existia na cabeça de quem já sabia.

**A ordem é valor → pré-contrato → cautelar → contrato**, e agora ela
aparece como trilho no alto, com o passo atual marcado. O bloco do
pré-contrato subiu para logo abaixo do valor, junto da autorização de
cautelar — é o papel que segura o negócio, e é assinado antes de a
conta bancária ser preenchida.

**O contrato aparece sempre.** Antes ele simplesmente não existia até a
cautelar aprovar, e a pergunta "onde está o contrato?" não tinha
resposta na tela. Agora o bloco está lá dizendo o que falta para
abrir. E `contratoLiberado` cobre os dois caminhos: cautelar aprovada,
ou **reprovada com o novo pré-contrato impresso** — reprovada sem ele
não libera, porque o papel que segurava o negócio morreu com o laudo.

**O nome do negociador vem do usuário logado.** Perguntar o nome de
quem acabou de entrar com a própria senha é pedir duas vezes a mesma
coisa — e era esse campo vazio que deixava o filtro de avaliações por
colaborador sem ter o que casar. Continua editável, para o caso de
alguém abrir no aparelho do colega.

### 36. Shinkai por API: o envio mora onde a chave de serviço já está

Até 08/09/2026 "levar para o Shinkai" era copiar um JSON e colar no
painel. O Mateus entregou o endpoint (`POST /api/public/veiculo`, com
`x-api-key`), e agora o carro vai por botão.

**Por que isto mora em `api/foto.js` e não em `api/veiculo.js`**, que é
onde o estoque vive: o Shinkai pede as fotos como URLs que ele consiga
baixar, o bucket é privado, e assinar link é a única coisa no sistema
que usa a `SUPABASE_SERVICE_KEY` — que a decisão 9 confina a esse
arquivo. Levar o envio para outro lugar significaria espalhar a chave,
que é exatamente o que aquela decisão evita. **Quem mudar de ideia
sobre isso está mudando a decisão 9 junto.**

**O link assinado de 1 h basta** porque eles baixam e guardam cópia no
momento do POST. O que precisa estar de pé é a chamada, não o dia
seguinte.

**`SHINKAI_API_KEY` só existe em variável de ambiente**, como o
ZapSign. O `GET ?recurso=shinkai` responde apenas se ela existe, nunca
o valor — sem esse teste, descobrir que a variável não subiu seria
errar com o carro já no pátio. Sem a chave, a tela cai no caminho
antigo (copiar o JSON) **e diz isso**, em vez de falhar calada.

**Reenviar a mesma placa atualiza lá, não duplica**, então o botão pode
ser apertado a cada edição — e campo que não vai no corpo não apaga o
que já estava. Por isso o que se guarda na 0030 é o último resultado
(`shinkai_id`, `shinkai_status`, `shinkai_em`), não uma fila de
eventos. Sem gravar nada, saber se o carro já está lá viraria
adivinhação.

**As três partes do nome vão separadas (0041).** A documentação deles
diz que `marca`, `modelo` e `versao` separados é melhor, e a tela deles
tem três selects ligados à FIPE em tempo real: com a string única os
três ficam vazios do lado de lá. Foi o que o Derek viu em 11/09/2026 —
*"está indo sem os dados do carro"*.

**As partes vêm da fonte, nunca de um corte aqui.** Chutar a marca pelo
primeiro token erraria em Land Rover e Alfa Romeo — o mesmo tropeço dos
canais de preço (decisão 8). Quem sabe separar é quem tem os campos: a
consulta de placa devolve `marca` e `modeloAbreviado`, e a tabela FIPE
oficial devolve `Marca` e `Modelo`. As duas passaram a gravar nas
colunas novas; o que faltava era coluna, não informação. **Ficha antiga
sem as colunas cai na `marca_modelo` inteira**, que é o comportamento
anterior — nada quebra.

`marca_modelo` continua existindo e continua sendo o que o descritivo
imprime: é a linha que o lojista lê, e remontá-la de três pedaços a
cada uso criaria uma segunda verdade sobre o nome do carro.

**`valor_investimento` leva o `valor_compra`**, seguindo a definição
deles ("o que a loja pagou … é o alvo da negociação"). O `preco_pedido`
é o outro candidato e mudaria o que o lojista vê; **está anotado como
pergunta em aberto para o Derek**, não escolhido por conta própria.

**Os `avisos` aparecem na linha do carro.** Eles não impedem a
gravação — dizem por que o carro entrou em *avaliação* em vez de
*disponível* (falta foto, falta valor alvo), e é isso que alguém
precisa ler para resolver. O 422 mostra a lista de campos recusados;
engoli-la obrigaria a abrir o log da Vercel com o cliente esperando.

**O botão nasceu no lugar errado, e isso demorou a aparecer.** Ele
ficava só na Venda para lojistas, que é o carro **já comprado**. Mas o
momento em que o carro precisa chegar à rede é o **Lançamento**, com o
cliente sentado esperando as propostas voltarem — e lá continuava só o
"Copiar JSON do Shinkai". O Derek viu em 11/09/2026: *"continua
aparecendo o copiar JSON do Shinkai, e não enviar para o Shinkai"*.

**São dois envios na vida do carro, não um.** Um na avaliação, para
receber proposta; outro depois de comprado, para repassar. O endpoint
aceita `veiculo_id` **ou** `estoque_id`, e o resultado de cada um fica
na sua própria linha (0030 no `estoque`, 0039 no `veiculo`) — misturar
os dois faria "já está lá" responder pela viagem errada.

**Na avaliação o `valor_investimento` é o POR, não o valor de compra**
— a loja ainda não pagou nada, e o alvo é o número que o negociador
quer ver voltar da rede. Sem nenhum dos dois o Shinkai recebe o carro
como *em avaliação* e diz isso nos avisos, que é o estado certo para um
carro que ainda não é nosso. **A documentação deles já prevê isso**;
não é desvio de uso.

**O envio pede a ficha salva.** É o `veiculo_id` que dá endereço às
fotos no bucket. Sem ele o botão fica apagado e a tela diz o que
fazer, em vez de falhar depois de apertado.

**Os seletores da ficha deles são movidos por CÓDIGO, não por nome.**
O Mateus respondeu em 11/09/2026: `fipe_marca_codigo` ("59"),
`fipe_modelo_codigo` ("8068") e `fipe_ano_codigo` ("2019-5"), **os três
juntos ou nenhum** — mandar um ou dois deixa os seletores vazios do
mesmo jeito. Nós já tínhamos os três na mão: são exatamente os
parâmetros que `ConferirFipe` usa na consulta à tabela oficial, e eram
jogados fora com a resposta. A 0043 deu coluna a eles.

**Os códigos batem entre as duas fontes, e isso foi conferido.** O CRM
deles consulta a parallelum; nós consultamos a FIPE oficial. Comparei
marca a marca e modelo a modelo: Ford 22, Land Rover 33, VW 59 nas
duas, e 8068 é "Polo Comfort. 200 TSI 1.0 Flex 12V Aut." nas duas — a
parallelum espelha a mesma tabela. **Quem trocar a fonte de uma das
pontas confere assim de novo**: código de modelo trocado põe outro
carro na ficha do lojista.

**Ficha sem conferência FIPE vai sem os códigos**, e isso não é erro —
o nome continua preenchendo o resto. `fipe_codigo` ("005477-1") é outra
coisa: preenche o campo de referência e não move seletor nenhum.

**`comprador_responsavel` é o NOME, e precisa existir na equipe da
franquia.** Vem do negociador do estoque ou do atendimento — o veículo
nunca teve coluna de negociador (0001). Nome que eles não reconhecem
não derruba o envio: o carro entra sem responsável e a resposta traz um
aviso com os nomes válidos, que a tela mostra. É assim que se descobre
um erro de grafia na hora, em vez de descobrir pelo carro sem dono.

**E o nome daqui não é o nome de lá — a tradução é cadastro (0044).**
O primeiro envio voltou com o aviso: "TIAGO" não está na equipe. Não
está mesmo; lá ele é **Tiago Tisott**. São três listas de nomes para as
mesmas pessoas — `negociador` ("TIAGO", "DIMAS"), `perfil` ("Thiago
Santos de Souza", "Pablo Soares") e a equipe deles ("Tiago Tisott",
"Dimas Campos", "André Bruno").

**Casar pelo primeiro nome seria errado, não incompleto.** A equipe
deles tem "Tiago Tisott" **e** "Thiago Santos de Souza" — um negociador
e um gerente, duas pessoas. A aproximação acertaria Dimas, erraria
Tiago, e o erro seria **silencioso**: o carro entra com o responsável
trocado e ninguém vê. Mesmo raciocínio da decisão 23, onde o comprador
virou cadastro em vez de texto solto.

Então `negociador.shinkai_nome` é escrito uma vez por pessoa, em Equipe
e metas. Vazio, vai o nome daqui — e o aviso volta listando os nomes
válidos, que é justamente como se descobre o que escrever ali.

**Pneus: o chute estava certo.** `pneus` como objeto por posição é
exatamente o que a API espera, e os nossos quatro estados são
traduzidos do lado deles (`regular` → Médio, `fraco` → Ruim).

**Sobre os opcionais eu estava errado, e a frase que estava aqui era o
erro:** "opcional que não casa com um chip entra como livre e aparece
na ficha igual". Não entra — ver a decisão 47, que foi escrita olhando
a ficha deles em vez de deduzindo.

**O descritivo passou a sair DEPOIS do Shinkai, não antes.** Pedido do
Derek em 11/09/2026: *"o descritivo deve vir do Shinkai, pois lá tem o
link das fotos pros lojistas; somente mostrar o descritivo depois que
tiver isso"*. A ordem na tela do Lançamento é agora **levar o carro à
rede → descritivo**, e antes do envio o bloco do descritivo diz o que
falta em vez de existir vazio. É o mesmo raciocínio do gate da decisão
1: mandar o texto ao grupo com o carro fora da plataforma produz
exatamente a rodada de perguntas que o gate existe para evitar.

**Sem chave configurada o descritivo libera assim mesmo**, com aviso.
Travar o atendimento por causa de uma variável de ambiente que não
subiu seria transformar um problema de configuração em cliente parado
na mesa.

**O link das fotos não vem na resposta deles, e mesmo assim o
descritivo o leva.** O 200 documentado traz `id`, `placa`, `acao`,
`status`, `fotos` (a contagem) e `avisos`, e mais nada — nenhum
endereço.

**O formato foi conferido, não deduzido.** Em 11/09/2026 o botão "Link
do app" do painel deles foi acionado em três carros, e o que saiu foi
sempre `https://www.shinkai.com.br/pwa/entrar/<franquia>?c=<uuid>`. O
`c` do Polo QJP1C41 bateu com o `shinkai_id` que o nosso envio tinha
gravado: **é o mesmo id que o POST devolve**, não um parecido. A
franquia no caminho é `joinville` enquanto a origem é
`vaapty-joinville`, daí o corte do prefixo e a `SHINKAI_FRANQUIA` para
quem abrir outra praça.

**E no mesmo dia o campo passou a vir, então a montagem manual saiu.**
O Mateus incluiu `url` na resposta e pediu para apagá-la: o app deve
ganhar domínio próprio, e um link montado aqui passaria a apontar para
o lugar errado **sem ninguém perceber**. Agora `shinkai_url` (0040)
guarda o que veio na resposta, e sem endereço o descritivo apenas não
imprime a linha. **Quem voltar a montar o link aqui reintroduz o risco
que esta decisão evita.**

**O descritivo virou o molde do Shinkai.** O Derek mandou o texto que
a plataforma gera ("assim que sai um descritivo") e pediu o nosso
igual. Os lojistas leem esse formato todo dia; duas folhas diferentes
para o mesmo carro fazem o leitor procurar o que mudou em vez de ler o
carro. Mudou o que se esperava: **a placa saiu** (eles não a imprimem,
e mascarada ela nunca serviu do lado de lá — o que identifica o carro é
o link), os pneus saem um a um em vez de contados, FIPE e POR saem com
centavos, e positivos e ressalvas viram uma linha só. `mascararPlaca` e
`resumoPneus` ficaram sem uso e saíram junto. **`internas` continua
fora**, pela decisão 2.

**Leilão/sinistro e GNV ficaram, mesmo fora do molde deles.** Ressalva
omitida vira devolução e queima a confiança da rede — economizar duas
linhas não paga esse risco.

**O carro chegava pelado, e era o nosso corpo que estava curto.** Até
11/09/2026 o POST mandava identificação, valores e fotos — e deixava de
fora **pneu, opcional, gastos e ressalva**, que são justamente os
campos que a tela deles pede para o carro poder ser ofertado. A
`observacoes_internas` continua fora, e não por esquecimento: a decisão
2 a proíbe de sair da loja.

**O PATCH do resultado tenta duas vezes, e a segunda é sem o
endereço.** `shinkai_url` é coluna nova; num banco que ainda não a
tenha, o PATCH inteiro seria recusado e levaria junto o `shinkai_em` —
que é o que libera o descritivo. Mesmo remédio da decisão 29.

### 46. O que chega ao Shinkai, e o que eu tinha chutado

O Derek viu em 17/09/2026 que a ficha do lojista estava incompleta —
*"não vai os gastos, nem pedida, nem placa"*. Fui olhar a ficha de um
carro nosso **dentro do CRM deles** (AWA1F10, HONDA CBR, enviado
naquele mesmo dia às 16:28) antes de mexer em qualquer linha.

**A placa chega.** Ela é obrigatória e o `api/foto.js` recusa o envio
sem ela. No descritivo que o CRM deles gera ela sai **mascarada**
(`Placa: F-0`), que é decisão da tela deles, não perda de dado.

**O que não chega são exatamente os campos cujo nome eu chutei.** E o
contraste no MESMO corpo é a prova:

| enviado | nome | chegou |
|---------|------|--------|
| pneus, opcionais, `comprador_responsavel` | confirmados pelo Mateus em 11/09 | sim |
| `gastos`, `ressalvas`, `pontos_positivos` | chutados por mim | **não** |

O banco tinha `"1 PEÇA / MOTOR FUMANDO"` naquele carro e o campo GASTOS
da ficha deles estava vazio. **Campo desconhecido é ignorado em
silêncio** — o 422 só acontece quando o JSON não é legível —, então
isso passou uma semana sem ninguém ver.

**Isto é risco da decisão 2, não cosmético.** A etiqueta do campo deles
diz *"sai no descritivo e na oferta"*: a ressalva do carro não está
chegando ao lojista pelo link do Shinkai. O descritivo que **nós**
geramos continua imprimindo gastos e ressalvas, então o que o
negociador manda no WhatsApp está inteiro — o buraco é só a ficha de lá.

**E a tela deles tem UM campo para "Pontos fortes e ressalvas"**, não
dois. Eu mando dois. Mesmo com o nome certo, mandar separado
continuaria errado.

**PEDIDA é outro número, e nunca tinha saído daqui.**
`valor_investimento` chega e vira o **POR** do descritivo deles
(conferido: R$ 29.900). A PEDIDA — o que a Vaapty pede ao lojista —
ficava R$ 0 em todos os carros. Era a pergunta em aberto da decisão 36.

O campo `pedida` existia no objeto da ficha **desde sempre e nunca era
gravado**: sem campo na tela, sem coluna, sem entrada em `FONTE`. Morria
no aparelho, como o 206 da decisão 43. A 0053 dá a coluna, a tela ganha
o campo ao lado do POR, e o envio manda `pedida` — do estoque quando o
carro já é nosso, da ficha quando está em avaliação, mesmo par do
`valor_compra`/`valor_por`. **A última perna é a única não conferida no
ar:** sem um número real digitado, não há o que ver chegar, e inventar
preço de repasse num carro de cliente seria dado falso na mão do
lojista.

**Gastos virou campo de várias linhas**, que é o formato da ficha deles
("1 por linha") e o que a API quebra em itens. **O texto antigo não é
partido por conta própria**: barra sem espaço aparece em medida de pneu
("205/55"), e adivinhar separador em texto que a pessoa digitou é da
mesma família do erro que causou tudo isto.

**O Mateus respondeu no mesmo dia, e corrigiu metade do diagnóstico.**
`gastos`, `ressalvas` e `pontos_positivos` **já eram os nomes certos** —
os campos é que não existiam na API dele até 17/09/2026. Nada mudou
aqui, e ele confirmou que prefere receber positivos e ressalvas como
**duas listas**, do jeito que já iam: o Shinkai junta no campo único da
tela dele, positivos primeiro.

**Conferido na ficha da AWA1F10 depois do reenvio:** GASTOS com
`1 PEÇA / MOTOR FUMANDO`, PONTOS FORTES E RESSALVAS com `Motor
fumando`, TIPO em **Moto** — e os pneus viraram dianteiro/traseiro
sozinhos, que é o que a doc dele diz sobre moto.

**A lição fica de pé mesmo com o nome certo:** campo desconhecido é
ignorado em silêncio, e ninguém viu por uma semana. **Não invente nome
novo**, e não mande o mesmo texto sob três nomes esperando que um pegue
— duas entradas que peguem viram linha duplicada no descritivo do
lojista.

**Lista vazia LIMPA o campo lá (`[]` ou `""`), e nós ainda não usamos
isso.** Hoje campo vazio aqui vira `undefined` e o reenvio não encosta
no que está no CRM deles — então uma ressalva apagada aqui continua na
ficha do lojista. Deixar assim protege o que o operador deles digitou à
mão; mudar protege contra ressalva que deixou de valer. **É decisão do
Derek, e ainda não foi tomada.**

**O que era nosso foi consertado no mesmo dia:** a HONDA CBR estava na
ficha deles como **Carro**. O `tipo_veiculo` (0045) só era escolhido na
conferência da FIPE oficial; ficha montada pela consulta de placa
nascia sem ele, `somenteEnviadas()` descartava a coluna e o servidor
caía no padrão carro. Agora o tipo é campo da ficha, ao lado do câmbio,
e `VAZIO` o traz preenchido — **coluna que nasce `undefined` nunca é
gravada** (decisão 5), e é assim que um campo "opcional" vira dado
errado na mão do lojista.

**E o gerente que abre o atendimento de um negociador levava um erro
cru do Postgres na cara.** A tarja da sincronização mostrava *"new row
violates row-level security policy for table negociacao_viva"* dentro
do aviso laranja de "não feche esta aba até voltar" — alarme sobre
trabalho que não existe, porque ele está olhando, não digitando. A
recusa é de propósito (0033: o espelho vem do aparelho de quem conduz);
o que faltava era traduzir. Agora é uma linha cinza: *"atendimento de
outro negociador — você está vendo, não editando"*.

**Os três seletores da FIPE ficam vazios em ficha que não passou pela
conferência oficial**, porque sem os três códigos não se manda nenhum
(decisão 36). Isso é conhecido e continua certo — mas soma à sensação
de ficha pela metade, e é mais um motivo para a conferência FIPE virar
rotina.

### 47. Os opcionais são chips, e chip que não existe some calado

O Derek viu em 21/09/2026: *"a placa ainda não está indo pro Shinkai!
… além disso não estão indo os opcionais que estou selecionando"*.
Fui olhar a ficha do carro no CRM deles antes de mexer em linha
nenhuma, porque a decisão 46 já tinha custado uma semana por eu ter
deduzido em vez de conferir.

**A placa chega, e chegava o tempo todo.** Está no campo PLACA da
ficha do QUI3D81 e no cartão da lista deles. O que o Derek olhou foi o
**PWA do lojista**, e lá ela não é impressa — decisão de tela deles, a
mesma que a 46 já tinha registrado sobre o descritivo. **Nada a
consertar aqui, e é importante não "consertar"**: mandar a placa de
novo sob outro nome é exatamente o erro que a 46 proíbe.

**Os opcionais chegam pela metade, e essa parte era nossa.** Foram
quatro no QUI3D81 — Completo, Ar condicionado, Direção hid./elét.,
Travas elétricas — e a ficha deles mostrou **dois**.

**A seção OPCIONAIS da ficha deles são NOVE BOTÕES e nenhum campo de
texto**: Completo, Ar condicionado, Direção hidráulica/elétrica, ABS,
Som / Multimídia, Sensor de ré, Câmera de ré, Rodas de liga, Bancos em
couro. O casamento é pelo nome exato, e o que não bate **é descartado
em silêncio** — não vira texto livre, não vira aviso, não vira nada.

**A frase errada estava escrita aqui, na decisão 36**, e foi ela que
manteve isto invisível: *"opcional que não casa com um chip entra como
livre e aparece na ficha igual"*. Eu a escrevi por dedução, num dia em
que os pneus e os opcionais que eu tinha conferido bateram — e
generalizei do que bateu para o que não tinha olhado. **É a mesma
família do erro da 46: campo desconhecido ignorado calado, e ninguém
vê.** A diferença é que desta vez o texto desta casa afirmava o
contrário, então nem havia o que investigar.

**O que foi consertado:** `OPCIONAL_SHINKAI`, em `api/foto.js`, é a
tradução dos nossos rótulos para os chips deles. Hoje tem **uma
entrada** — a nossa direção é abreviada e a deles não —, e os outros
oito chips batem letra a letra. **Mesma forma do `shinkai_nome`
(decisão 44): tradução entre dois mundos é cadastro, nunca
aproximação.** Quem acrescentar entrada confere o rótulo na tela
deles, não de memória: chip errado põe na mão do lojista equipamento
que o carro não tem.

**O que não tem chip continua sendo enviado assim mesmo.** Custa nada
— hoje é ignorado lá — e no dia em que a lista deles crescer, o carro
passa a chegar inteiro sem deploy aqui. **Empurrar esses para
`pontos_positivos` para "aparecer de algum jeito" está descartado**: o
campo que o lojista lê não é depósito do que não coube em outro, e a
decisão 46 já proíbe mandar o mesmo dado sob nomes diferentes
esperando que um pegue.

**São 22 dos nossos 31 que ainda não chegam**, e essa conta sai do
teste em vez de sair de uma leitura à mão:

```bash
node ferramentas-shinkai.js
```

Ele lê `OPCIONAIS` do `index.html` e `OPCIONAL_SHINKAI` do
`api/foto.js` — nada é copiado para dentro dele — e falha quando um
chip deles deixa de ter origem nossa, quando o mapa aponta para chip
que não existe, e quando a tradução perde ou duplica item. **A lista
dos nove chips está no teste com a data em que foi lida da tela**;
quem mexer confere lá de novo.

**O que sobra é pergunta para o Mateus, não código nosso:** se a lista
de chips pode crescer, ou se a API pode aceitar opcional fora dela. E
"Único dono" (decisão 1) é o caso que mais dói — é o primeiro
argumento que o lojista lê, e hoje não sai daqui.

### 37. A meta da pré-venda é outra cadeia

O cadastro dava a todo mundo os três campos do negociador, e na
pré-venda isso produzia **"R$ 0 · 30 carros"** — que não é meta de
ninguém. Quem prospecta não vende carro: traz gente para a loja.

```
prospecções × conv. agendamento × conv. comparecimento
    = clientes trazidos à loja
```

Mesma ideia da 0018: digita-se o que a pessoa controla, e o resultado
é **derivado no servidor** (`derivarMetaPre`). `meta_agendamentos` fica
no meio porque é o número que a pré-venda persegue no dia;
`meta_comparecimentos` é a meta de verdade. Quem escrever direto neles
cria duas verdades para a mesma meta.

**O agendamento é arredondado antes de virar comparecimento**, pelo
mesmo motivo da 0018: é o número que a pessoa persegue, e a conta na
tela tem que fechar com ele.

**O papel decide quais campos aparecem**, e o cartão mostra o resultado
do papel — "18 na loja · 30 agend." em vez de faturamento. As duas
cadeias convivem na mesma linha da tabela `negociador`, e o PATCH
recalcula só a que foi tocada, numa ida ao banco só.

**A meta da loja continua somando só negociador** (decisão 22):
prospecção não vende, e somá-la inflaria o alvo.

**O que ficou de fora:** o realizado. A meta é só alvo hoje. Os números
existem em `lead` (0022) — prospecção feita, agendamento marcado,
"chegou" —, então o previsto × realizado da pré-venda no Painel do mês
é o passo seguinte, e não foi feito porque o pedido era a meta.

**Pergunta em aberto:** encadear as quatro grandezas foi leitura minha.
O Derek listou clientes na loja, as duas conversões, e *"além disso"* a
quantidade de prospecções — se prospecções for meta paralela de
esforço, e o cliente na loja vier também de lead que chega sozinho, são
duas metas separadas e uma não deriva da outra.

### 38. Senha: dois caminhos, porque um depende de e-mail

Em 10/09/2026 dois funcionários não conseguiram entrar. O Derek tinha
liberado o acesso na tela dele, mas o Supabase barra **antes**: as
contas foram criadas e o e-mail de confirmação não chegou — o SMTP
compartilhado do plano gratuito entrega mal. A confirmação foi
desligada (Authentication → Sign In / Providers → Confirm email), e é
redundante aqui de qualquer forma: ninguém entra sem o gerente ativar
o perfil, que é a trava que protege o dado do cliente.

**O mesmo buraco vale para "esqueci minha senha".** Por isso são dois
caminhos, e o segundo existe justamente porque o primeiro pode falhar:

1. **"Esqueci minha senha"**, na tela de entrada. `POST /auth/v1/recover`
   com `redirect_to` para a própria página. O Supabase devolve a sessão
   no fragmento da URL; `sessaoDoLink()` a reconhece, **limpa o
   fragmento** e abre a tela da senha. Token em barra de endereço vira
   token em histórico, em print e no que a pessoa cola para pedir ajuda.
   O sucesso não confirma que o e-mail existe — dizer "não há conta com
   esse e-mail" entregaria a lista de quem trabalha aqui.

2. **O gerente gera uma senha aleatória** em Equipe e metas. Ela
   **aparece uma vez** e não é gravada em lugar nenhum: mostrar de novo
   exigiria guardar senha em claro. O alfabeto não tem O/0 nem I/1/l,
   porque a senha vai por WhatsApp ou ditada no telefone.

**`senha_provisoria` (0032) é uma marca nossa — o Supabase não tem
"precisa trocar a senha".** Enquanto ela estiver ligada, o App não
mostra nada além da tela da senha, e não há como pular. Senha que
circulou no WhatsApp não pode ficar valendo para sempre.

**Limpar a marca é do próprio dono, por função `security definer`.**
A escrita em `perfil` é do gerente (0004); abrir `update` para o dono
da linha abriria `papel` e `ativo` junto, porque RLS não separa coluna.
Mesmo remédio da `marcar_contrato_assinado()` da 0015.

**Isto muda a decisão 9, e de propósito.** A `SUPABASE_SERVICE_KEY`
passou a existir num segundo arquivo, o `api/perfil.js`. Trocar a senha
de outra pessoa é a única operação do sistema que o token do próprio
usuário não alcança: a API de administração exige a chave, e não há RLS
que a substitua. **O que protege é a mesma coisa que protege o Storage
no `api/foto.js`: a ordem.** O gerente é conferido primeiro, lendo o
perfil dele **com o token dele**, pelo RLS; só depois a chave entra, e
só para uma chamada. Ela não toca em nenhuma tabela, não volta em
resposta e não vai para log. Sem ela o recurso não liga, e a tela diz
isso. **Quem acrescentar um terceiro uso dessa chave está mexendo aqui
e na decisão 9 junto — e o teste é o mesmo: existe caminho pelo token
do usuário? Então não use a chave.**

**O que ficaria melhor com SMTP próprio.** Resend, Brevo ou o Gmail da
loja em Authentication → Emails. Hoje a recuperação por e-mail é o
caminho preferido e o mais frágil; com SMTP de verdade ela passa a
funcionar, e o "gerar senha" volta a ser exceção em vez de rotina.

### 39. O resumo da conversa: o gestor não lê transcrição

O painel entregava ao gerente a transcrição inteira. Meia hora de fala
vira duas mil palavras em texto corrido, com as palavras que o
reconhecimento de voz errou no meio — o Derek olhou e disse, em
11/09/2026: "a transcrição continua vindo inteira, quero um resumo".
Isso não é leitura de gestor; é arquivo.

**Os "sinais" da decisão 17 não resolvem isto.** Eles são busca por
expressão, e busca por expressão não resume: ela acende uma luz quando
uma palavra aparece. Resumir uma conversa pede modelo — e o modelo já
estava pago e ligado, no `ANTHROPIC_API_KEY` das táticas (decisão 31).

**O resumo responde às três perguntas que o gerente tem**, e nessa
ordem: quem é o cliente e por que ele está vendendo; como a negociação
andou e onde parou; e se o negociador seguiu o processo. Mais uma
quarta linha, `atencao`, que é o que ele deve cobrar — sem ela o
resumo seria descrição, e o painel existe para virar retorno.

**A instrução diz para NÃO inventar o que não está na conversa.** É a
diferença entre um resumo e uma acusação: "não perguntou pela dívida"
tem que significar que não perguntou, não que o reconhecimento de voz
perdeu o trecho. Pelo mesmo motivo a tela imprime, embaixo do resumo,
que a palavra final é a transcrição — e o link para ela continua ali.

**A janela é a conversa inteira, não o fim dela.** A tática lê os
últimos 2.500 caracteres porque a manobra acontece agora; o resumo
precisa do começo, que é onde o cliente conta o motivo da venda. Daí
`IA_JANELA_RESUMO` (padrão 14.000), separada — e quando o texto passa
do teto o corte é **no meio**, porque as pontas são a pesquisa e o
fechamento e é o miolo que se repete.

**É botão, e fica guardado.** A fila de revisão tem dezenas de
atendimentos que o gerente nunca vai abrir; resumir todos ao carregar
a lista seria pagar por texto que ninguém leu. Gerado uma vez, o
resultado fica na 0038 e volta pronto na próxima abertura. "Refazer"
existe porque a conversa continua depois de o resumo ser escrito, e a
tela diz a hora do texto que está na frente dele.

**A transcrição vem do banco, não do corpo da requisição.** É a RLS da
0033 que decide se aquela pessoa pode ler aquela conversa. Aceitar o
texto pelo corpo deixaria qualquer conta autenticada pagar uma chamada
nossa para resumir o que quisesse.

**Quem grava é uma função estreita, pelo mesmo motivo de sempre.** A
política de escrita da `negociacao_viva` é do NEGOCIADOR (0033) — o
espelho vem do aparelho dele. Quem pede o resumo é o gerente. Abrir
`update` da tabela para o gerente abriria a transcrição, as rodadas e
o valor fechado junto, porque RLS não separa coluna; então
`gravar_resumo_ia()` é `security definer`, confere `e_gerente()` com o
JWT de quem chamou e só sabe escrever essas três colunas. Mesmo
remédio da `marcar_contrato_assinado()` (0015) e da senha (0032).
**Falhar ao guardar não perde o resumo** — ele volta para a tela do
mesmo jeito, só não fica em cache.


### 40. Recibo: a direção sai do lançamento, não de quem emite

O financeiro registrava o dinheiro e não emitia o papel — e é o papel
que a outra ponta pede: o cliente que recebeu o PIX da venda, o
despachante que foi pago, o lojista que pagou pelo carro. Pedido do
Derek em 11/09/2026.

**Duas direções, um documento só.** Recebimento (crédito) é a Vaapty
quem recebe, e a folha sai assinada por ela; pagamento (débito) é a
Vaapty quem paga, e a folha é a que a outra parte assina. O texto é o
mesmo com emitente e recebedor trocados de lado.

**E é por isso que a direção NÃO é escolhida na tela.** Ela sai do lado
em que o valor está no lançamento. Recibo assinado pelo lado errado não
prova nada — prova contra quem o emitiu —, e é o tipo de erro que só
aparece quando alguém precisa do documento.

**O valor por extenso é obrigatório, e é onde essas funções erram.**
Três regras estão conferidas em `valorPorExtenso()`: "cem" é exatamente
100 e "cento" é todo o resto; 1.000 é "mil", nunca "um mil"; e "um
milhão **de** reais" só leva a preposição quando fecha sem resto — "um
milhão e quinhentos mil reais" não leva. A vírgula separa os grupos e o
"e" entra só antes do último, e mesmo assim apenas quando ele é redondo:
"dois milhões, quinhentos mil e um", não "dois milhões e quinhentos mil
e um". **Quem mexer aqui confere contra os casos, não de cabeça.**

**Os dados são congelados na emissão** (0042). O recibo prova o que foi
dito naquele dia: corrigir depois o nome do favorecido não pode mudar a
via que está na mão da pessoa. Por isso valor, nome, documento e
referência têm colunas próprias, em vez de serem lidos do lançamento na
hora de olhar.

**Cada emissão é uma linha, como na 0003.** Segunda via é evento novo,
com número novo — é assim que se sabe quantas vias circulam. Sem índice
único, de propósito.

**O número é sequencial por ano e o índice único é a rede.**
`max(numero) + 1` na aplicação daria duas vias com o mesmo número se
duas pessoas emitissem no mesmo segundo; o `unique_violation` faz a
segunda tentar de novo. Sequência do Postgres não serve porque o número
zera a cada ano. **O protocolo é o próprio número** —
`RECIBO-2026-0007` se dita ao telefone, um hash de timestamp não.

**`conteudo` fica nulo, e é decisão.** A tela só sabe montar o HTML
depois de conhecer o número, que nasce no servidor; um segundo PATCH
para guardar o papel pediria política de update numa tabela que é
registro, não rascunho. O que prova é a linha, e o HTML se remonta
igual a partir dela.

**A `documento` (0003) não servia:** ela exige `veiculo_id not null`, e
recibo de aluguel não tem veículo nenhum.

**A janela abre antes do `await`**, como em todo documento desta casa
(decisão 15): pop-up disparado depois de uma espera é bloqueado, e a
impressão quebraria em silêncio — na frente de quem está esperando o
papel.


### 41. Meu dia: a folha de bordo do negociador

O Derek fotografou em 14/09/2026 a folha que o negociador preenche à
mão. É o dia inteiro numa coluna, hora a hora:

```
11:03  Whats recuperação
11:18  Jair — Recuperação — Whats
11:40  Almoço — início
12:00  Atendimento — início
12:59  Consegui um agendamento de recuperação
13:06  Ligação com Douglas
16:01  Atendimento finalizado — carro consignado
```

Metade disso o sistema já sabe e a outra metade só existia no papel —
que some no fim da semana.

**Plano e realizado são a MESMA linha (0046).** Uma ação nasce
planejada (`feito_em` nulo) e ganha a marca quando acontece. Duas
tabelas obrigariam a decidir, item a item, se o que foi feito era o que
estava planejado; e a resposta certa — "era, com meia hora de atraso" —
não cabe em nenhuma das duas. Na tela, o planejado aparece esmaecido
com um ○ e um toque marca.

**O atendimento NÃO é copiado para a agenda.** Ele já existe, com hora
de criação e status; copiá-lo criaria uma segunda verdade que envelhece
no minuto seguinte — o negócio muda de status e a cópia continua
dizendo o que era antes. `TelaMeuDia` mescla as duas fontes **na hora
de desenhar**, como o painel do gestor faz com a negociação viva.
**Quem "simplificar" isso gravando o atendimento na agenda está criando
o problema que esta decisão evita** — e é por isso que a linha do
atendimento não tem os botões de marcar e apagar: eles mexeriam no
negócio, não na agenda.

**Sem hora vai para o fim da lista**, não para o meio: é item do plano
que ainda não tem lugar no dia, e no meio da ordem cronológica ele
confundiria a leitura.

**Registrar é o gesto de todo dia, então Enter grava e limpa.** Quem
acabou de desligar o telefone não procura botão — é a mesma razão da
barra de captura da pré-venda (decisão 27). Sem hora digitada vale o
relógio: pedir a hora seria pedir o que a máquina já sabe. E o que se
repete dezenas de vezes — almoço, início e fim de ligação — virou
atalho de um toque.

**A agenda é pessoal, e o gerente lê todas.** Mesma régua da
`negociacao_viva` (0033): ler o dia do colega não é o que esta tabela
existe para permitir. **Escrever é só do dono, inclusive para o
gerente** — agenda preenchida por outra pessoa deixa de ser o registro
de quem viveu o dia.

**A semana fica à vista, de segunda a sábado**, com feitas/total por
dia. É onde ele planeja, e onde o buraco aparece antes de acontecer.

**O que ficou de fora:** o realizado da agenda ainda não conversa com a
meta (decisão 37). Os números existem — prospecção, recuperação,
atendimento, todos com tipo —, então contar "35 recuperações contra a
meta de 40" é o passo seguinte, e não foi feito porque o pedido era a
folha.

**O lembrete de meia em meia hora, e por que ele não acumula.** É o
que transforma a folha em hábito: ninguém lembra de registrar, mas
todo mundo responde uma pergunta que aparece na frente. Entre 8h30 e
18h, a caixa pergunta "o que você está fazendo agora?" — uma linha, e
vai para a agenda com a hora do slot, não a de quando terminou de
digitar.

**Ele pergunta pelo instante em que aparece, nunca pelos que
passaram.** Ao montar, o slot corrente é marcado como visto **sem
perguntar**; só vira pergunta quando o relógio cruza o próximo. Sem
isso, quem volta do almoço às 14h encontraria cinco caixas empilhadas
perguntando o que fez às 12h, 12h30, 13h — e fecharia todas sem ler,
que é como um lembrete morre.

**Fechar é resposta válida**, e deixa o buraco aparecer na grade.
Registrar à força o que a pessoa não quis dizer produziria dado
inventado no lugar de silêncio honesto.

**O gerente não recebe** — ele não preenche folha de bordo. Vê a caixa
pelo botão "ver o lembrete", no próprio "Meu dia".

**A grade mostra o vazio, e é para isso que ela existe.** Meia em meia
hora, das 8h às 19h. Uma lista corrida mostra o que foi feito e
esconde o que não foi; a grade mostra as duas coisas no mesmo desenho
— a faixa em branco das 15h às 16h é a informação que o gerente
procura, e ela não existe numa lista. O que cai fora do horário da
loja, e o que ainda não tem hora, aparecem embaixo em vez de sumir.

**Abrir não marca nada; editar marca, e dizendo o quê.** Navegar pela
lista não é trabalho, e contá-lo como trabalho estragaria a única
coisa que a folha mede. O que vira linha é mudança de fase ("Mudou a
fase — Aguardando → Em negociação") e etapa do processo concluída
("Concluiu a etapa Pesquisa") — o status é do negócio, a etapa é do
processo, e as duas contam.

**Isso grava EVENTO, não estado — e é o que o reconcilia com a regra
de não copiar o atendimento.** O estado envelhece; "às 14:32 ele mudou
a fase" não envelhece nunca. Pelo mesmo motivo a linha automática do
atendimento diz **"Cliente chegou"** e não o status atual: mostrar o
status de agora na hora da chegada reescreveria o passado toda vez que
o negócio andasse.

**A primeira passada não registra etapa nenhuma.** `etapasJaVistas`
nasce com o que já estava fechado; sem isso, recarregar a página no
meio da tarde despejaria seis linhas dizendo que ele acabou de fazer
tudo de novo.

**O registro falha em silêncio**, de propósito: ele é subproduto do que
a pessoa veio fazer, e um erro ali não pode aparecer como se o
atendimento não tivesse salvado.


### 42. Assinatura eletrônica própria: o papel some do caminho

O Derek trouxe em 15/09/2026 a especificação do assinador que já roda
no ERP da Camisetas Já, escrita para ser reproduzida aqui. O objetivo
dele é direto: *"aí não precisamos imprimir"*.

**Três pilares, e só valem juntos.** Aceite expresso (cláusula no
documento + caixa de ciência), trilha de auditoria (quem, quando, de
onde, em quê, o desenho) e integridade (SHA-256 conferível por
qualquer pessoa). Trilha sem aceite prova que alguém clicou, não que
concordou; aceite sem hash não impede trocar o arquivo depois; hash
sem trilha prova que o arquivo não mudou e nada sobre quem assinou.

**O ZapSign fica, e só no contrato final de compra** — decisão do
Derek: "a validade é melhor". Todo o resto do caminho vai pelo
assinador próprio. **A cláusula só entra nos documentos que vão por
ele**: pô-la no contrato do ZapSign descreveria um procedimento que
não aconteceu. `ASSINAVEIS` é a lista — pré-contrato, termo de aceite
e check list. Autorização de cautelar não precisa, e os extratos são
folha de mesa, não instrumento: ninguém assina uma lista de propostas.

**A cláusula é texto jurídico, e a decisão 7 vale aqui inteira.** O
Derek autorizou acrescentá-la ("só adiciona a cláusula que dá validade
à assinatura digital"); o resto do contrato é o da casa e não foi
tocado. Ela mora em `CLAUSULA_ASSINATURA`, em um lugar só. **Documento
gerado antes de 15/09/2026 não a tem** — quem for mandar um antigo
para assinar gera de novo primeiro.

---

**Três fragilidades da especificação de origem foram corrigidas aqui,
e ela mesma pede isso.**

**O link tem token de verdade.** Lá a URL é `?orc=ORC-0123`,
sequencial: quem chutar um código abre o pedido de outra pessoa e pode
assiná-lo — o documento diz, com todas as letras, *"não copie para o
Vaapty"*. Aqui são 32 bytes aleatórios e o banco guarda **só o
SHA-256**, como senha. Vazamento do banco não entrega link nenhum, e
link perdido não se recupera: gera-se outro.

**O código de verificação nasce no servidor.** Lá o navegador sorteia
o próprio identificador. Quem é identificado por um número não pode
ser quem o escolhe.

**O IP é lido da requisição, nunca do corpo.** Evidência que a parte
interessada digita não é evidência. Cidade e UF vêm dos cabeçalhos da
borda da Vercel — conferido no ar: "Joinville, SC, BR".

**E a verificação pública mostra o mínimo.** Quem tem só o código vê o
documento mascarado (`123******09`), sem IP e sem o arquivo. No ERP de
origem o código sozinho abre o PDF inteiro e o IP completo.

---

**A chave de serviço não entra nisso, e essa foi a decisão de
arquitetura mais importante.** O signatário é um cliente sem login: o
caminho óbvio seria a `SUPABASE_SERVICE_KEY` — numa rota **pública**, o
que abriria a tabela `atendimento` inteira, com CPF e telefone de
cliente. Em vez disso, as três operações do público passam por funções
`security definer` estreitas (0048) que exigem o token do link. Mesmo
remédio da `marcar_contrato_assinado()` (0015) e da senha (0032).
**Quem trocar isso pela chave de serviço está desfazendo a decisão 9.**

**Não há PDF, e isso é decisão.** Gerar PDF no navegador pediria
html2canvas + jsPDF, e guardá-lo pediria a chave de serviço no
Storage. O que se assina e se hasheia é o **HTML do documento**, que já
é a fonte única (decisão 7) — e o hash do conteúdo é mais robusto que
o do PDF, que muda se a fonte ou a margem mudarem. O desenho da
assinatura viaja como PNG dentro das evidências.

**As duas páginas do público são arquivos ESTÁTICOS** (`assinar.html`,
`verificar.html`). O teto de 12 funções da Vercel está cheio; fossem
funções, estas telas não existiriam. **Quem as transformar em função
derruba o build inteiro.**

**O token vai no fragmento (`#t=`), não na query.** Fragmento não entra
em log de servidor, não entra em log de proxy e não viaja no cabeçalho
`Referer`. A página lê o `location.hash` e manda o token no corpo do
POST.

**Uso único garantido pela transação.** O `update … where usado_em is
null` só pega a linha uma vez: dois toques no botão, ou dois
aparelhos, produzem uma assinatura só. Conferido no ar — a segunda
tentativa volta "Este link não está mais válido".

**O CPF é validado pelos dígitos no navegador.** Documento inventado no
campo é a falha mais comum, e ela só aparece meses depois, quando
alguém precisa do papel.


### 43. A ficha vem do banco, e não só do aparelho

Um negociador preencheu um 206 no celular, abriu o mesmo atendimento no
computador e viu tudo em branco. Depois copiou a linha do CRM e ela
saiu pela metade.

**O dado não tinha se perdido.** Fui ao banco antes de teorizar: a
ficha estava inteira — chassi, câmbio, os quatro pneus, os opcionais,
FIPE e POR. O que faltava era alguém **ler de volta**: a tela montava a
ficha só do `localStorage`, que é por aparelho (decisão 10), e a linha
do CRM se monta da ficha da tela.

**E o susto escondia um risco maior.** Salvar do aparelho "vazio"
mandaria os campos em branco por cima do que já estava gravado —
`somenteEnviadas()` descarta a coluna que **não vem** no corpo, e vazio
vem. Era perda de dado esperando acontecer.

**`fichaDoVeiculo()` é o caminho de volta de `fichaParaBanco()`.**
**Quem acrescentar campo em um acrescenta no outro**, senão o campo
novo volta a viver só no aparelho.

**O banco preenche só o que está vazio na tela** (`mesclarFicha`). Quem
está com o cliente na frente e acabou de digitar o KM não pode ver o
número mudar sozinho porque o servidor tinha outro; quem abriu num
aparelho novo precisa da ficha inteira. As duas coisas cabem nessa
regra, e ela foi conferida com os dois casos.

**`fRef` é atualizada junto.** Ela é a versão autoritativa para o que
roda depois de um `await`; sem isso o primeiro salvamento mandaria de
novo a ficha velha e desfaria a leitura.

**A leitura falha em silêncio.** Sem rede o aparelho segue com o que
tem — travar o atendimento por causa de uma consulta seria pior que a
tela incompleta.
