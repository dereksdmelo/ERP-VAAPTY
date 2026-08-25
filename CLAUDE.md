# CLAUDE.md

Orientação para o Claude Code trabalhar neste repositório.

## O que é

A Vaapty compra carros de pessoa física e repassa para uma rede de
lojistas. Este sistema é a ferramenta que o negociador usa no celular
durante o atendimento presencial: consulta a placa, monta a ficha do
veículo, registra as rodadas de negociação e gera as duas saídas que
alimentam a rede — o descritivo do WhatsApp e o JSON do Shinkai.

Protótipo em produção-leve. Uma página estática mais duas funções de
servidor na Vercel. **Sem banco, sem login, sem backend.** Os dados
ficam no `localStorage` de cada aparelho.

```
index.html        aplicação inteira (React 18 + Babel via CDN, sem build)
api/placa.js      GET /api/placa?placa= — consulta a Placa Fipe
api/cota.js       GET /api/cota — consumo diário (não gasta consulta)
```

## Rodar e publicar

```bash
vercel dev
```

```bash
vercel --prod
```

O token da Placa Fipe vive em `PLACAFIPE_TOKEN` (Vercel → Settings →
Environment Variables, e um `.env` local para o `vercel dev`). **Ele
nunca chega ao navegador** — é essa a razão de `api/placa.js` existir
em vez de o `index.html` chamar a Placa Fipe direto. Qualquer mudança
que faça o token cruzar para o cliente está errada.

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

## Convenções do código

- **Português no domínio.** Estado, funções e rótulos em pt-BR
  (`faltando`, `etapaConcluida`, `filtrarPorCambio`). Não traduzir para
  inglês.
- **Um arquivo.** Tudo em `index.html`: tokens de estilo (`C`, `F`),
  helpers, componentes (`Campo`, `Toggle`, `Bloco`, `Pendente`), o
  componente único `VaaptyAponte`. Não há build — não introduzir um sem
  necessidade.
- **Persistência.** Só via `window.storage` (wrapper com prefixo `vp:` e
  fallback em memória, [index.html:21](index.html:21)). Duas chaves:
  `vaapty:at` (ficha) e `vaapty:fotos`. `set()` e `setVarios()` gravam a
  cada alteração; não chamar `setF` direto.
- **Fotos.** Sempre por `comprimir()` — 1280 px, JPEG 0.72, máximo 12.
  Data URL grande no `localStorage` estoura; o erro de espaço é tratado
  em `salvarFotos()`.
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
- **Dados presos ao aparelho.** Um atendimento por celular; trocou de
  aparelho, perdeu.
- **Chassi às vezes parcial.** Preenche sozinho só com 17 caracteres
  válidos (`chassiCompleto`); fora disso, digitar do CRLV. Renavam nunca
  vem da consulta.
- **Babel no navegador** custa ~1 s no primeiro carregamento.
- O README cita `vaapty_schema.sql` e `.env.example`; **nenhum dos dois
  está no repositório.**

## Próximo passo planejado

Postgres no Supabase, login por papel (pré-venda, negociador, gerente,
prep), fotos no Storage e as fichas saindo do aparelho para o servidor.
