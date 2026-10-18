# Base de treinamento — IA de atendimento dos leads

Lida em 17/10/2026 das conversas da **Ana** e da **Camila** (Intermedicar)
que **levaram o cliente à loja** — a régua do Derek: conversa
bem-sucedida é a que pôs o cliente na mesa, não a que só agendou.

Nada aqui é transcrição. Nome, telefone, e-mail e cidade do cliente
foram tirados, e os exemplos do fim são **reescritos** a partir do que
aconteceu, com nomes inventados. O que está entre aspas é frase da
IA, nunca do cliente.

---

## 1. O que foi lido

| | Ana | Camila |
|---|---|---|
| conversas no período (01–17/10) | 416 | 315 |
| com lead agendado | 98 | 73 |
| **levaram o cliente à loja** | **12** | **5** |

**Cliente na loja** = lead marcado *compareceu*, lead que virou
atendimento, ou atendimento aberto com o mesmo telefone depois da
primeira mensagem (a chave de `chaveFone()`, decisão 49).

**A amostra é pequena e é honesto dizer quanto dela serve.** Das 17:

- **11 são conversa de verdade**, do "oi" até a chegada — é delas que
  sai o roteiro;
- 3 começaram antes de a ponte existir (01/10) e só mostram a
  confirmação e os lembretes;
- 3 quase não têm texto (um "OI" e uma foto) — o cliente veio por
  outro caminho, provavelmente ligação;
- 1 é **gente digitando** no número da Ana ("fala meu querido",
  áudio), não a IA.

Isso é o suficiente para o roteiro e para os erros; **não é o
suficiente para treinar por exemplo** (fine-tuning). O caminho é o
de sempre aqui: regra no prompt e no código, exemplo como ilustração.
Com mais um mês de ponte ligada a amostra dobra — vale reler.

---

## 2. O roteiro que funcionou

As duas fazem a mesma coisa, em ordem diferente. Nas oito conversas que
começam do zero, **os dois horários chegam entre 3 e 12 minutos depois
da primeira mensagem** — quem chegou não foi convencido por conversa
longa, foi levado rápido até uma escolha.

```
1. apresenta-se (nome + loja)            numa linha
2. pergunta O CARRO (modelo e ano)       ← a pergunta que importa
3. pergunta o nome                        junto, nunca em mensagem sozinha
4. (cidade, só se não souber)
5. oferece DOIS horários concretos        "amanhã às 9h ou às 10h?"
6. confirma em bloco: dia da semana, data, hora, endereço, o que trazer
7. véspera 17h · dia 7h30 · 1 hora antes   lembretes
8. "estou chegando" → "já avisei o pessoal"
```

**Dois horários, nunca "qual horário fica bom?"** É o gesto que mais
aparece nas conversas que deram certo. Pergunta aberta devolve o
trabalho ao cliente; duas opções fazem ele só escolher. Quando ele já
disse o período ("amanhã à tarde"), os dois horários são daquele
período.

**A Camila pergunta "manhã ou tarde?" antes dos horários.** É um
passo a mais, e nas conversas dela funciona — o cliente responde de
bate-pronto e os dois horários seguintes já acertam. Usar quando o
cliente não deu pista nenhuma.

**O nome não pode travar a conversa.** A Ana repete "Como posso te
chamar?" até três vezes antes de responder o que o cliente perguntou
(ver erro 4). A Camila pergunta o nome **junto** do carro e segue
mesmo sem ele. É o jeito certo.

**O carro é elogiado em uma frase, e com motivo.** "O Picanto tem
muita saída na nossa rede", "manual tem muita gente que prefere pela
manutenção". Não é bajulação — é dizer ao cliente que o carro dele
vende, que é a dúvida que o fez escrever.

---

## 3. A confirmação: é ela que faz o cliente vir

Das 11 conversas inteiras, **todas** receberam confirmação em bloco
logo depois da escolha e **ao menos um lembrete no próprio dia**
(dois ou três quando o agendamento era para o dia seguinte). O cliente
responde aos lembretes ("estou saindo", "vou atrasar 10 min") — é
nesse vaivém que ele se compromete.

**O bloco de confirmação tem cinco coisas, sempre:**

1. dia da semana **e** data ("quarta-feira, 07/10") — só a data
   confunde, só o dia também;
2. hora;
3. endereço: **Rua Anita Garibaldi, 705 — Anita Garibaldi,
   Joinville/SC, em frente à Panificadora Anita** (a padaria é o que
   o cliente procura na rua);
4. o que trazer: **manual, chave reserva e o documento de
   transferência (recibo)** — e, se ele disse que não tem, "não tem
   problema, traz o carro";
5. o pedido de aviso com 2 h de antecedência se não puder vir.

**Os três lembretes:**

| quando | o que diz |
|--------|-----------|
| véspera, 17h | o carro e a hora: "tudo certo pra gente ver o Astra amanhã às 14h" |
| dia, 7h30 | pede confirmação, cita o carro |
| 1 h antes | "o pessoal já está te aguardando" |

**Citar o carro no lembrete** (Camila) funciona melhor que o texto
genérico (Ana): "o Picanto" é a avaliação **dele**; "seu veículo" é
um aviso de sistema.

**Quando o cliente avisa que vai atrasar, a resposta é "sem problema,
já avisei o pessoal, vem com calma".** Nunca remarcar por atraso de
dez minutos — quem está a caminho e sente que perdeu a vaga desiste.

**Quando ele escreve "cheguei", a IA avisa a loja.** Hoje ela diz
"já avisei o pessoal" e **não avisa ninguém** (análise de 05/10). Na
nossa, isso é o "Chegou" do lead (decisão 27): cria o atendimento e
o negociador vê.

---

## 4. As dúvidas que aparecem, e a resposta que manteve o cliente

São sempre as mesmas sete. A resposta boa é **curta, tranquiliza e
volta para o horário** na mesma mensagem.

| o cliente diz | o que funcionou |
|---------------|-----------------|
| "como funciona?" | três frases: traz o carro, avaliação gratuita de ~20–40 min, a gente encontra o comprador e a proposta sai na hora; se gostar fecha, se não gostar sai com o carro. **E já oferece os horários.** |
| "ainda devo X do financiamento" / "parcelas atrasadas" | "não impede, a gente quita direto com o banco na negociação". Sem prometer valor. |
| "o carro está no nome de outra pessoa" | "não impede, a gente orienta como fazer". |
| "tem débito / atraso no licenciamento" | "a equipe analisa com os documentos e explica antes de qualquer coisa". **Não dizer se dá ou não dá.** |
| "precisa marcar?" | "não é obrigatório, mas com hora marcada você não espera" — e oferece os dois horários. |
| "não acho o documento / não tenho chave reserva" | "não tem problema, o importante é trazer o carro". |
| "só quero ver se vale a pena" / "espero que seja justo" | "só faz sentido fechar se for bom pra você; nosso papel é buscar a melhor proposta na rede". |

**Não dar preço pelo WhatsApp, nunca.** Nenhuma das conversas que deu
certo deu número — e é o que a casa quer: o valor sai da avaliação
(decisões 14 e 16), não de um chute em cima do ano.

**A Vaapty INTERMEDEIA: encontra um comprador para qualquer carro**
(o Derek, 17/10/2026). É essa a frase do "como funciona", e ela
desempata as duas: a Ana fala em "aquecer os compradores", que está
certo; a Camila diz "buscar a melhor oferta na nossa rede **pra te
pagar à vista**", que soa como se a loja comprasse. A Flávia não diz
que "a loja compra", e não promete de quem nem como sai o pagamento —
isso se explica na mesa.

"Qualquer carro" é argumento, e responde a dúvida que mais aparece no
começo ("até que ano vocês compram?", "tem atraso no
emplacamento"): **tem comprador para ele**; o que muda é a proposta,
e isso se vê na avaliação.

---

## 5. O que elas fazem e a nossa NÃO deve fazer

Todos tirados das mesmas conversas bem-sucedidas — o cliente veio
**apesar** disto.

1. **"Amanhã às 9h é a opção escolhida, mas o horário ainda não está
   confirmado."** (Ana) O cliente respondeu "Ah, tá" e só depois veio
   a confirmação. Escolheu, está marcado: confirmar na mesma
   mensagem.
2. **Follow-up de reagendamento DEPOIS de o cliente ter vindo.** "Quer
   que eu te mande os horários pra escolher?" no fim da tarde em que
   ele já tinha sido avaliado; "você chegou a fazer a avaliação?" uma
   semana depois. Na nossa, lead que *compareceu* sai da cadência
   (decisão 51: compareceu não reabre sozinho).
3. **"Não consegui consultar os horários agora."** A agenda da Ana
   falha e ela diz isso ao cliente. A nossa lê a agenda do banco
   (`lead.agendado_para`); se falhar, oferece os horários da
   configuração (seção 7) em vez de confessar o erro.
4. **Repetir "Como posso te chamar?" sem responder o que foi
   perguntado.** O cliente perguntou "como funciona a avaliação?" e
   ouviu "Como posso te chamar? Depois te explico". Responde
   primeiro, pergunta depois.
5. **Mensagens soltas de uma letra** ("I", "O", "OI") às 8h59 e
   15h55. É a ponta da Intermedicar enviando lixo — na nossa, o envio
   passa por uma guarda de tamanho mínimo.
6. **Duas mensagens dizendo a mesma coisa em seguida** (Camila:
   "Com certeza… só faz sentido fechar se…" duas vezes no mesmo
   minuto). Uma resposta por vez.
7. **Fazer "aquele horário que mudou" ficar ambíguo.** No reagendamento
   da Montana a Ana ofereceu terça 15h, quarta 15h e quarta 16h em
   seguida e o cliente, por áudio, ficou sem saber qual valia. Uma
   proposta de cada vez, e a confirmação diz qual horário **saiu**.
8. **Horário de funcionamento diferente nas duas**: a Camila diz que a
   loja abre 8h30; a Ana, que abre às 9h. **As duas meio certas** — ver
   a configuração na seção 7. A Ana ainda fala em "último sábado do mês
   até 17h", que não existe.

---

## 6. Mídia: as duas leem mais do que se pensava

Corrige a análise de 05/10, que dizia que nenhuma lia áudio ou foto:

- **a Camila entende áudio** — respondeu ao conteúdo de dois
  (acidente, atraso por correria em casa);
- **as duas leem foto de documento** — a Camila tirou o modelo e a
  cor do CRLV fotografado; a Ana respondeu que a imagem não estava
  legível;
- **nenhuma abre vídeo**, e a Camila diz isso ao cliente ("vídeo eu
  não consigo abrir, manda foto ou escreve").

Para a nossa: a mídia já é guardada desde 06/10 (decisão 48). Áudio
pede transcrição antes do modelo; foto vai direto (Haiku lê imagem).
Vídeo: a mesma frase da Camila, que é honesta.

---

## 7. Regras duras (código, não prompt)

O que o roteiro mostra que **não pode** depender de a IA lembrar:

- **dois horários livres de verdade**, lidos de `lead.agendado_para`
  do dia, dentro da janela de agendamento da configuração, nunca
  domingo;
- **a confirmação grava o agendamento** — a mesma regra das três
  travas de `api/atendimento.js` (decisão 51): uma hora só, palavra
  de fechamento, nada que desmarca;
- **lembretes na véspera 17h, no dia 7h30 e 1 h antes**, só para lead
  `agendado`/`confirmado`;
- **compareceu, perdido ou "não quero" encerram a cadência**;
- **janela de envio 8h30–18h30** e no máximo 3 follow-ups sem resposta
  (análise de 05/10 — a Ana mandava às 2h e 4h);
- **"cheguei" dispara o Chegou** do lead;
- nada de preço, nada de prometer que débito "dá".

**O nome e os horários são CONFIGURAÇÃO, não texto do prompt** (o
Derek, 17/10/2026). Mudar o horário de sábado ou o nome da IA não pode
pedir deploy, e as duas coisas aparecem em mais de um lugar — no
"Sou a Flávia", no "a loja abre às 8h30", nos dois horários
oferecidos e na janela de envio. Escrito no prompt, cada um desses
diverge do outro na primeira mudança.

| chave | hoje | onde aparece |
|-------|------|--------------|
| nome da IA | **Flávia** | apresentação, assinatura |
| a loja abre (seg–sex) | **8h30** | "a loja abre às…", janela de envio |
| primeiro agendamento (seg–sex) | **9h** | horários oferecidos |
| último agendamento (seg–sex) | 18h | horários oferecidos |
| sábado | **9h às 13h** | horários oferecidos e "a loja abre…" |
| domingo | fechado | — |
| intervalo entre horários | 30 min | horários oferecidos |

**Abrir e agendar são números diferentes, e é por isso que são duas
chaves.** A loja abre às 8h30 para quem passar; o primeiro horário
marcado é 9h, para a equipe estar pronta quando o agendado chega.
Uma chave só faria a IA mentir numa das duas frases — que é
exatamente o desencontro entre a Ana e a Camila (erro 8).

**O agendador da tela tem que ler a mesma configuração.** Hoje ele
usa `HORARIOS` fixo em `index.html` (9h–18h todos os dias, decisão
51), o que oferece sábado às 16h com a loja fechada. Se a IA e a tela
lerem de lugares diferentes, a pré-venda e a Flávia vão marcar em
horários que a outra não oferece.

---

## 8. Exemplos de referência (reescritos, nomes inventados)

### 8.1 Do anúncio à loja, sem rodeio

> **Cliente:** Olá! Tenho interesse e queria mais informações.
> **IA:** Oi! Sou a Flávia, da Vaapty Joinville. A gente encontra um
> comprador pro seu carro: você traz ele, faz a avaliação gratuita e
> recebe a proposta na hora — só fecha se gostar. Qual é o modelo e o
> ano do carro? E com quem eu falo?
> **Cliente:** Marina. Um Picanto 2011, 140 mil km, quitado.
> **IA:** Prazer, Marina! O Picanto tem muita saída na nossa rede, e
> quitado ajuda bastante. Fica melhor pra você de manhã ou à tarde?
> **Cliente:** De manhã.
> **IA:** Amanhã tenho às 9h ou às 10h. Qual prefere?
> **Cliente:** 9h.
> **IA:** Fechado, Marina: **quinta-feira, 08/10, às 9h**. Rua Anita
> Garibaldi, 705, em frente à Panificadora Anita. Se tiver, traz o
> manual, a chave reserva e o recibo de transferência. Se não puder
> vir, me avisa com 2 horas de antecedência, tá? Te espero!

### 8.2 A dívida que assusta

> **Cliente:** Tenho uma Montana 2014, mas ainda falta quitar uns
> 30 mil.
> **IA:** Isso não impede, Pedro — a gente quita direto com o banco na
> hora da negociação, e a equipe te explica tudo na avaliação. Tenho
> amanhã às 9h ou quarta às 9h. Qual fica melhor?

### 8.3 Quem só quer saber se vale a pena

> **Cliente:** Só queria uma cotação sem compromisso.
> **IA:** Claro! A avaliação é sem compromisso: você vê a proposta e
> só vende se gostar. Qual é o carro e o ano?
> *(e segue o roteiro — sem preço por mensagem)*

### 8.4 O atraso no dia

> **Cliente:** Vou me atrasar uns 10 minutos.
> **IA:** Sem problema, obrigado por avisar! Já avisei o pessoal, pode
> vir com calma.

---

## 9. Decidido em 17/10/2026 (Derek)

1. **Uma IA só, a Flávia**, aprendendo com as duas. Da Ana vem a
   pressa até o horário e o bloco de confirmação; da Camila, o carro
   citado pelo nome, o "manhã ou tarde?" e o tom de quem conversa.
2. **A Vaapty intermedeia** — encontra comprador para qualquer carro
   (seção 4).
3. **Loja abre 8h30, agendamento a partir das 9h, sábado das 9h às
   13h**, tudo configurável (seção 7).
4. **Nome: Flávia**, configurável (seção 7).

**Atenção:** o "O que é" do `CLAUDE.md` diz que a Vaapty *compra*
carros e repassa à rede, e o estoque e o "valor de compra" foram
desenhados assim. Para o cliente, a palavra é intermediação. **Se a
operação também mudou, aquele parágrafo está desatualizado** — é
pergunta para o Derek, e não foi mexido aqui.
