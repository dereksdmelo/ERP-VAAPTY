# CLAUDE.md

Orientação para o Claude Code trabalhar neste repositório.

## O que é

A Vaapty compra carros de pessoa física e repassa para uma rede de
lojistas. Este sistema é a ferramenta que o negociador usa no celular
durante o atendimento presencial: consulta a placa, monta a ficha do
veículo, registra as rodadas de negociação e gera as duas saídas que
alimentam a rede — o descritivo do WhatsApp e o JSON do Shinkai.

Protótipo em produção-leve. Uma página estática mais duas funções de
servidor na Vercel. **Sem login ainda.** O atendimento inteiro vive no
`localStorage` do aparelho; só a ficha do veículo tem persistência de
verdade, gravada no Supabase pela etapa de Lançamento.

```
index.html                       aplicação inteira (React 18 + Babel via CDN, sem build)
api/placa.js                     GET  /api/placa?placa= — consulta a Placa Fipe
api/cota.js                      GET  /api/cota — consumo diário (não gasta consulta)
api/veiculo.js                   POST /api/veiculo — grava a ficha · GET — as 20 últimas
api/foto.js                      POST/GET/PATCH/DELETE — imagens no Storage
supabase/migrations/*.sql        esquema do banco, versionado
```

Sem `package.json`, de propósito: nenhuma função usa biblioteca. O
Supabase é chamado pela API REST (PostgREST) com `fetch`. Manter assim
— dependência nova precisa de uma boa razão.

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
| `PLACAFIPE_TOKEN` | `api/placa.js`, `api/cota.js` |
| `SUPABASE_URL` | `api/veiculo.js` |
| `SUPABASE_SERVICE_KEY` | `api/veiculo.js` |

**Nenhuma das três pode chegar ao navegador** — é essa a razão de as
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
  `vaapty:at` (ficha), `vaapty:veiculo` (id da linha no banco) e
  `vaapty:fotos` — esta última guarda **só o que ainda não subiu**.
  `set()` e `setVarios()` gravam a cada alteração; não chamar `setF`
  direto.
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
  processo, biblioteca de testemunhais, argumentos de objeção, ZapSign,
  escuta por IA). São promessas visíveis ao usuário — só remover junto
  com a entrega da funcionalidade.

## Limites conhecidos

- **Endereço público, sem login.** Não colocar dado real de cliente
  antes de o backend existir.
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
