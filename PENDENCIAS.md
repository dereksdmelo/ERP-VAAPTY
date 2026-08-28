# Pendências

O que está em aberto no projeto, por que importa e o que destrava.

Atualizado em 27/08/2026. **Quem resolver um item, apaga daqui** — lista
que acumula item resolvido para de ser lida.

---

## Esperando terceiro

### API da tabela AutoAvaliar
**Derek está em conversa com eles.**

A tabela AutoAvaliar é o preço praticado no **repasse entre lojistas** —
a ponta que a Vaapty vende, e por isso a que mais se aproxima do POR.
Hoje o negociador chega no POR por experiência; ter o número na tela ao
lado da FIPE mudaria a conversa.

Conferi em 27/08/2026: a tabela exige conta e **não tem consulta pública
por modelo**. Os únicos campos de `/tabela-auto-avaliar/` são e-mail e
senha. Por isso o link na etapa P leva só à página do produto.

*Destrava com:* resposta deles sobre API. Se houver, o trabalho é um
`api/autoavaliar.js` no mesmo molde do `api/desvalorizacao.js`.

*Plano B, se não houver API:* as propostas dos lojistas registradas na
etapa de Espera **são a nossa própria tabela de repasse**. Com alguns
meses de uso dá para mostrar "carros como este receberam entre X e Y
nos últimos 90 dias" — dado nosso, não de terceiro.

---

## Segurança e acesso

### `/api/placa`, `/api/cota` e `/api/desvalorizacao` estão abertos
São os únicos endpoints sem login. **Quem descobrir a URL queima as 20
consultas diárias da Placa Fipe.** Ficaram assim porque mexer no
`placa.js` estava fora do combinado na época.

*Conserto:* o mesmo `tokenDe()` que os outros usam. Uma linha em cada
arquivo.

### Só o Derek tem conta
Todo perfil nasce **desativado** e só gerente ativa. Os outros
negociadores precisam ser criados em Authentication → Users e liberados.

*Falta também* uma tela de gerente para ativar perfil — hoje é SQL no
painel.

### Storage sem política em `storage.objects`
A 0002 criou o bucket privado sem política, então `api/foto.js` mantém a
chave de serviço só para o Storage. O que protege é a ordem: toda ida ao
Storage vem depois de uma consulta ao banco feita pelo usuário.

*Quando houver política,* essa exceção sai e o `foto.js` passa a usar só
o token do usuário.

### LGPD
O banco guarda nome e telefone desde a 0004, **CPF, RG e endereço desde
a 0007, e conta bancária e chave PIX desde a 0008**. Dado bancário é
sensível ao ponto de fraude: quem tiver acesso desvia pagamento. Não há política
de retenção, nem registro de consentimento, nem rotina de exclusão a
pedido do titular. **Vale conversar com o jurídico antes de escalar o
uso.**

---

## Dados que ainda vivem só no aparelho

Trocou de celular, perdeu. Só a ficha do veículo, as fotos, os
documentos e o atendimento estão no banco.

- **Rodadas de negociação** (extrato impresso e contraproposta)
- **Notas da espera**
- **Indicações** da etapa E
- **Toggles do APONTE** (carro subiu, decisor presente, mostrou o vídeo…)
- **`fipeDesval`** — a chave do desvalorizômetro. Reabrir o atendimento
  em outro aparelho perde o gráfico até reconsultar a placa (gasta cota).

*Conserto:* migração nova com uma tabela de rodadas e colunas para o
resto, ou um campo JSON no atendimento para o que não precisa de
consulta.

---

## Lacunas de tela

| o que | situação |
|-------|----------|
| `renavam` | tem coluna no banco e não tem campo na tela. Saiu dos documentos por isso — volta quando houver campo, e só interessa em carro que fecha |
| conferência da FIPE | `fipeConferida` e o código de autenticação vivem só no aparelho — não têm coluna no banco |
| `positivos`, `lataria`, `mecanica` | vão no JSON do Shinkai, sempre vazios — não têm campo |
| `proposta.apresentada` | coluna existe, não há botão para marcar |
| Ativar perfil de negociador | só por SQL |
| Editar dados do atendimento | dá para mudar status, não cliente/telefone/origem |

---

## Dívidas técnicas conhecidas

### Cache mensal da consulta de placa nunca foi feito
O `api/placa.js` põe `s-maxage=86400` (24 h na borda) e **zero no
navegador**, apesar do comentário falar em 30 dias. O valor FIPE muda uma
vez por mês. Falta subir o `s-maxage` e guardar por placa no
`localStorage` com a data de referência.

### Duas fichas para a mesma placa
Não há índice único cobrindo "uma ficha por atendimento" — são duas
requisições (`select` e depois `insert`). Dois aparelhos salvando ao
mesmo tempo criam duas linhas.

*Conserto:* índice único parcial em `veiculo (atendimento_id)`.

### A fórmula do SCORE de confiabilidade

O dashboard reproduz a aba FLUXO X CONVERSÃO, inclusive a faixa
CONFIABILIDADE. O que falta é o **SCORE**: tentei derivar a conta dos
números da planilha e não fecha com nenhuma combinação que testei —
ANDRÉ BRUNO dá 360,00% com 1 prospecção, 10 avaliações e 7 "ficou
mais"; ALESSANDRO dá 180,00% com 0, 5 e 2.

Chutar peso de avaliação de gente é pior que deixar em branco, então o
campo sai com travessão e a tela diz por quê.

**O que destrava:** o Derek clicar na célula do SCORE na planilha e
mandar a fórmula.

### As 262 linhas já importadas estão com o mapeamento antigo

A primeira importação (262 linhas) rodou com o parser procurando NEGOCIADOR,
PROSPEC e ANO/MOD, e o cabeçalho real diz NEGOCIADORES, PROSPECTO e
ANO. O parser foi corrigido em 28/08/2026, **mas as linhas que já estão
no banco não se corrigem sozinhas**: seguem sem negociador, sem
prospecto, sem ano, sem motivo da venda e com o status achatado em
"aberto".

O efeito visível é o dashboard por negociador vazio — a tabela avisa
"251 atendimentos sem negociador".

**O que destrava:** apagar as linhas importadas e importar de novo com
o parser novo. É destrutivo e leva junto veículos e propostas dessas
linhas, então **depende do Derek mandar** — e de conferir antes se
alguém já editou algum desses atendimentos à mão.

### Importador não é transação
Se o lote de veículos falhar, os atendimentos do lote anterior ficam.
Aceitável para algo que se faz uma vez; se virar rotina, vira função no
banco.

### Funil tem teto de 2000 linhas
Acima disso o número fica incompleto. A tela avisa (`truncado: true`),
mas o certo seria agregar no banco.

### Apagar veículo deixa arquivo órfão
O `on delete cascade` limpa as linhas de `foto`, não os objetos do
Storage. **Hoje não existe tela que apague veículo** — quando existir,
ela precisa varrer o bucket antes.

### Link de foto vence em 1 h
As miniaturas usam URL assinada. Atendimento que passe disso sem
recarregar mostra imagem quebrada. Recarregar refaz os links.

### Tabela `ERPVAAPPTY` no banco
Não veio de nenhuma migração nossa, e o nome tem dois P. Ninguém aponta
para ela. *Falta:* olhar o que tem dentro e decidir se apaga.

### `documentos.js` é cópia morta
O que roda é o bloco colado no `index.html`. Editar o arquivo da raiz
não muda nada na tela. Decisão consciente do Derek, anotada nos dois
lugares — mas é uma armadilha.

### README desatualizado
Cita `vaapty_schema.sql` e `.env.example`, que não existem. O esquema
vive em `supabase/migrations/`.

### Teto de 12 funções no plano Hobby da Vercel
**São 12 hoje — o teto.** Não cabe mais nenhuma; os anexos do
fechamento vão ter que entrar dentro do `api/foto.js`, que já cuida do
Storage. O décimo terceiro arquivo em `api/` **derrubou o build
inteiro** — não é aviso, é erro de deploy. O contorno foi juntar por
fonte: tudo da Placa Fipe em `api/placa.js`, atrás de `?acao=`.

*Quando o espaço acabar de novo:* ou junta mais por fonte, ou o plano
Pro. Vale contar antes de criar arquivo novo.

### Nada tem teste automatizado
Não há Node na máquina do Derek, então nem `node --check` roda. A
verificação é leitura, checagem de balanceamento por script, e teste
manual no site publicado.

---

## Promessas visíveis ao usuário

São os `<Pendente>` na tela. **Só saem de lá junto com a entrega** —
apagar sem entregar é mentir para o negociador.

| onde | o que falta | de quem depende |
|------|-------------|-----------------|
| Etapa O | vídeo explicando o processo | vocês gravarem |
| Etapa O | biblioteca de testemunhais, filtrada pela necessidade do cliente | vocês reunirem prints, fotos e vídeos |
| Etapa N | argumentos de IA por objeção | coletar com os negociadores o que funciona |
| Etapa T | assinatura por ZapSign | integração |
| Espera | resumo da conversa por IA de verdade | chave paga de LLM e uma função — a Vercel está em 12 de 12. A escuta e a transcrição já estão no ar (28/08/2026); o que existe hoje são sinais por palavra-chave, e a tela diz isso |

---

## Abertos pela escuta (28/08/2026)

O parecer saiu e a escuta está no ar, com consentimento gravado antes de
o microfone ligar. O que ficou:

- **O áudio passa por Google/Apple.** É o `SpeechRecognition` do
  navegador que transcreve, não nós. Está escrito na tela de
  consentimento; se o jurídico quiser processamento local, o caminho é
  outro e custa serviço próprio.
- **A transcrição fica só no aparelho.** Trocou de celular, perdeu — o
  mesmo limite das rodadas e das notas da espera.
- **Retenção não foi decidida.** Ninguém definiu por quanto tempo a
  transcrição pode ficar guardada. Enquanto ela não sai do aparelho, o
  problema é pequeno; no dia em que for para o banco, precisa de regra.

---

## Ideias que ficaram para depois

- **KBB por modelo.** O link para na marca porque o modelo lá fica sob a
  carroceria (`/hatchback/i30/`), que a FIPE não devolve.
- **Chaves na Mão.** Não responde a nenhum padrão de URL; ficaria
  quebrado e, com a trava da etapa P, impediria o atendimento de seguir.
- **Transição automática de status.** Descartada: o sistema não tem como
  saber que o cliente desistiu. Status errado é pior que desatualizado.
