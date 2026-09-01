# CLAUDE.md

Orientação para o Claude Code trabalhar neste repositório.

## O que é

A Vaapty compra carros de pessoa física e repassa para uma rede de
lojistas. Este sistema é a ferramenta que o negociador usa no celular
durante o atendimento presencial: consulta a placa, monta a ficha do
veículo, registra as rodadas de negociação e gera as duas saídas que
alimentam a rede — o descritivo do WhatsApp e o JSON do Shinkai.

Em produção-leve. Uma página estática mais doze funções de servidor na
Vercel, com login por papel e Postgres no Supabase. O que ainda vive só
no `localStorage` do aparelho são as rodadas de negociação, as notas da
espera e os toggles do APONTE — ver PENDENCIAS.md.

```
index.html                       aplicação inteira (React 18 + Babel via CDN, sem build)
api/placa.js                     GET  — Placa Fipe: ?placa=, ?acao=cota, ?acao=desvalorizacao
api/veiculo.js                   POST /api/veiculo — grava a ficha · GET — as 20 últimas
api/foto.js                      POST/GET/PATCH/DELETE — imagens no Storage
api/documento.js                 POST/GET — registro dos documentos gerados
api/config.js                    GET  — URL e chave anônima para o navegador
api/perfil.js                    GET  — quem sou eu; para gerente, a equipe
api/atendimento.js               GET/POST/PATCH — a lista do CRM
                                 ?recurso=indicacoes — os leads da etapa E
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
| `A` | Abordagem positiva | hora de chegada, carro no pátio, tempo combinado |
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

### 14. Duas FIPEs: uma adivinha, a outra confirma

`/api/placa` devolve o valor FIPE a partir da placa — mas a Placa Fipe
**adivinha a versão**, e por isso manda candidatas com percentual de
similaridade. Versão errada contamina o FIPE, que contamina o POR, que
contamina a negociação inteira.

`/api/fipe` fala com a **tabela oficial** (`veiculos.fipe.org.br`), onde
o negociador escolhe à mão. Ela devolve, além do valor, um **código de
autenticação emitido pela própria FIPE** — a prova de que o número veio
da fonte. Fica gravado na ficha.

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
negociador escolhe só o ano, `api/fipe.js` consulta os três
combustíveis e junta as listas, marcando cada modelo com o seu.
`"nadaencontrado"` é como a FIPE diz que não há nada; não é erro.

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

**Na reprovação o extrato é refeito**, agora com o laudo na mão, e o
valor impresso vira o novo `valorFechado`. Cada volta fica em
`revisoes`, com valor e hora — quantas vezes um carro voltou depois da
cautelar é informação que o gerente vai querer, e ela some se só o
último valor for guardado.

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
- **Dados presos ao aparelho.** Fora a ficha do veículo salva no banco,
  tudo o mais do atendimento — fotos, rodadas, notas da espera — vive no
  celular. Trocou de aparelho, perdeu.
- **Link de foto vence em 1 h.** As miniaturas usam URL assinada; um
  atendimento que passe disso sem recarregar a tela mostra imagem
  quebrada. Recarregar refaz os links.
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
