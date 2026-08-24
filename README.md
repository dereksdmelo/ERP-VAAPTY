# Vaapty — Ficha do veículo e negociação (APONTE)

Protótipo em produção-leve. Uma página estática mais duas funções de
servidor na Vercel. Sem banco de dados e sem login ainda — os dados
ficam no navegador de cada aparelho.

## O que faz

- Consulta a placa e traz marca, modelo, ano, cor, chassi e as versões
  FIPE candidatas com o valor de cada uma.
- Filtra as versões pelo câmbio, que é o que quase sempre separa as
  opções empatadas (Onix LTZ manual R$ 51.371 x automático R$ 55.188).
- Ficha do veículo com trava: descritivo e envio ao Shinkai só liberam
  com todos os campos obrigatórios preenchidos e ao menos uma foto.
- Fotos pela câmera do celular, reduzidas para 1280px antes de sair do
  aparelho.
- Fluxo APONTE com registro das rodadas de negociação (impresso e contra).
- Gera o descritivo do WhatsApp com a placa mascarada e o JSON do Shinkai.

## Estrutura

```
index.html        aplicação inteira (React via CDN, sem build)
api/placa.js      consulta a Placa Fipe — o token fica aqui, no servidor
api/cota.js       consumo diário de consultas (não gasta cota)
```

## Publicar

```bash
npm i -g vercel      # só na primeira vez
vercel login
vercel --prod
```

Depois de publicado, cadastre o token no painel da Vercel em
Settings → Environment Variables:

```
PLACAFIPE_TOKEN = seu_token_aqui
```

Salve e rode `vercel --prod` de novo para a variável valer.

Para atualizar depois: troque o arquivo e rode `vercel --prod`.

## Rodar na sua máquina

```bash
vercel dev
```

Crie um `.env` na raiz com o `PLACAFIPE_TOKEN` (veja `.env.example`).
O `.env` não pode ir para o Git.

## Limites conhecidos

- **Sem login.** O endereço é público. Não coloque dado real de cliente
  antes de o backend existir.
- **Dados por aparelho.** Cada celular guarda os seus. Serve para testar
  o fluxo, não para rodar a loja.
- **Cota de 20 consultas por dia** no plano atual da Placa Fipe. A tela
  mostra o consumo. O endpoint de cota não gasta consulta.
- **Chassi nem sempre completo.** Em placas de veículos mais novos a base
  devolveu só os últimos dígitos. Quando vem completo (17 caracteres) a
  ficha preenche sozinha; quando não, precisa digitar do CRLV.
- **Renavam não vem** na consulta por placa. Sempre digitado.
- **Sem Babel em produção.** O `index.html` compila o JSX no navegador,
  o que custa cerca de um segundo no primeiro carregamento. Aceitável
  para protótipo; na versão com backend isso some.

## Próximo passo

Banco Postgres no Supabase (esquema em `vaapty_schema.sql`), login por
papel — pré-venda, negociador, gerente, prep —, fotos no Storage e as
fichas saindo do aparelho para o servidor.
