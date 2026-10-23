/* A LEITURA DAS MÍDIAS DO CLIENTE (0073, 22/10/2026; ao vivo, 0077).
 *
 * Mora fora de api/ pelo mesmo motivo do ia/flavia.js: é usada pelo
 * treino (api/atendimento.js, com o token do gerente) e pela Flávia ao
 * vivo (ia/atender.js, pelo cron, com o IA_SEGREDO). Duas leituras
 * escritas em dois lugares divergiriam na primeira correção — e já
 * houve três: o ano pela placa, o modelo chutado e o ruído do vídeo.
 *
 * Nada aqui toca banco nem chave de serviço: recebe o arquivo já
 * baixado (api/foto.js, decisão 9) e devolve o texto. */
/*
 * O Derek, 22/10/2026: a IA precisa abrir foto, vídeo, documento e
 * áudio, e com isso saber de que carro o cliente está falando. Cada
 * mídia é lida UMA vez e a leitura fica na mensagem:
 *
 *   foto e PDF   o próprio Claude lê (imagem e documento)
 *   áudio        o Whisper do Cloudflare transcreve (Workers AI)
 *   vídeo        o Claude não aceita vídeo: só a fala é transcrita, e
 *                a Flávia pergunta o carro se a fala não disser
 *
 * **Só as do cliente**, e no máximo `MIDIAS_POR_VEZ` por rascunho: uma
 * conversa com doze fotos leria tudo de uma vez e o rascunho levaria
 * um minuto. As que sobram são lidas no próximo ponto.
 *
 * **A leitura não traz CPF, RG, nome do dono nem RENAVAM** — a
 * instrução manda deixar de fora, e o `semNumeros` da Flávia corta o
 * que escapar. O que interessa é o carro.
 *
 * **Falhar não derruba o rascunho.** Mídia que não deu para ler vira
 * leitura que diz isso, e a Flávia pergunta ao cliente.
 */
const MIDIAS_POR_VEZ = 4;
const IMAGEM_IA = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// O teto da API para imagem é 5 MB; o arquivo do WhatsApp já vem
// comprimido e quase nunca passa disso.
const IMAGEM_MAX = 5 * 1024 * 1024;

const INSTRUCAO_LEITURA = [
  "Um cliente mandou este arquivo pelo WhatsApp a uma loja de Joinville que intermedeia a venda de carros usados.",
  "Diga, em até três frases curtas em português, o que importa para a loja saber QUAL É O CARRO dele:",
  "o que é o arquivo (foto do carro, CRLV, ATPV, print de anúncio, outro), e o que aparecer de marca, modelo, versão,",
  "ano de fabricação/modelo, cor, combustível e placa; e, se for foto do carro, o estado que se vê (amassado, pneu, interior).",
  "NUNCA escreva CPF, RG, nome do proprietário, endereço, RENAVAM, chassi ou número de documento — mesmo que apareçam.",
  "Não chute: se não der para saber o carro, comece a resposta com 'NÃO IDENTIFICADO:' e diga o que se vê.",
  // O primeiro teste (22/10/2026) leu "ano 2014, conforme placa UK14"
  // numa foto de um Fiat Pulse, que nem existia em 2014, e chamou de
  // Tiguan a foto de um Polo Track. Ano errado e modelo errado são
  // piores que nenhum: a Flávia repete para o cliente.
  "ANO: só escreva o ano se ele estiver ESCRITO no documento ou no anúncio. Nunca deduza ano pela placa, pela aparência ou pelo modelo.",
  "MODELO: em foto, só diga marca e modelo se der para reconhecer com segurança (emblema, nome escrito, desenho inconfundível); na dúvida, diga só a marca ou 'NÃO IDENTIFICADO'.",
  "Texto corrido, sem negrito nem marcadores.",
].join("\n");

async function lerComClaude(item, chave, modelo) {
  const bloco = item.mime === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: item.base64 } }
    : { type: "image", source: { type: "base64", media_type: item.mime, data: item.base64 } };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelo, max_tokens: 300, system: INSTRUCAO_LEITURA,
      messages: [{ role: "user", content: [bloco, { type: "text", text: "O que é, e qual é o carro?" }] }] }),
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => ({}));
  return ((d.content || []).find((x) => x.type === "text") || {}).text || null;
}

/* O Whisper roda no próprio Cloudflare, pelo binding `AI` que o
 * adaptador do Worker entrega em `req.ai`. Na Vercel não existe, e aí o
 * áudio fica sem leitura — dito na própria leitura, para a Flávia
 * pedir que o cliente escreva. O turbo pede base64; o antigo, os
 * bytes — tenta um e cai no outro. */
async function transcrever(ai, item) {
  if (!ai) return null;
  try {
    const d = await ai.run("@cf/openai/whisper-large-v3-turbo", { audio: item.base64, language: "pt" });
    if (d && d.text) return String(d.text).trim();
  } catch (e) {}
  try {
    const d = await ai.run("@cf/openai/whisper", { audio: [...Buffer.from(item.base64, "base64")] });
    if (d && d.text) return String(d.text).trim();
  } catch (e) {}
  return null;
}


/* A leitura de UM arquivo, já baixado. Devolve o texto, o modelo que
 * leu e se a falha é definitiva — falha que pode passar (rede, modelo
 * fora do ar) não é gravada, para tentar de novo na próxima volta;
 * falha definitiva (sem arquivo, tipo que não se lê) é, para não
 * insistir. */
async function lerArquivo(m, a, op) {
  const tipo = (m.anexo && m.anexo.tipo) || a.tipo || "";
  let leitura = null, modelo = null;
  try {
    if (a.erro) {
      leitura = `NÃO LIDO: ${a.erro}.`;
    } else if (tipo === "audio") {
      const t = await transcrever(op.ai, a);
      leitura = t ? `Áudio transcrito: "${t.slice(0, 1500)}"` : "NÃO LIDO: o áudio não pôde ser transcrito.";
      modelo = t ? "whisper" : null;
    } else if (tipo === "video") {
      /* A fala do vídeo só entra quando é frase de verdade. O
       * Whisper "ouve" frases no barulho de motor e de rua — no
       * primeiro teste saiu "A CIDADE NO BRASIL" de um vídeo do
       * carro —, e a Flávia trataria isso como o cliente falando. */
      const t = await transcrever(op.ai, a);
      const fala = t && t.split(/\s+/).filter(Boolean).length >= 6 ? t : null;
      leitura = "Vídeo: a imagem não pode ser vista aqui" + (fala ? `; a fala transcrita: "${fala.slice(0, 1200)}"` : "") + ".";
      modelo = "whisper";
    } else if (op.chave && ((IMAGEM_IA.has(a.mime) && a.bytes <= IMAGEM_MAX) || a.mime === "application/pdf")) {
      const t = await lerComClaude(a, op.chave, op.modelo);
      leitura = t ? t.replace(/\*\*|__|^#+\s*/gm, "").replace(/\s*\n+\s*/g, " ").trim().slice(0, 1500) : "NÃO LIDO: a leitura falhou.";
      modelo = t ? op.modelo : null;
    } else {
      leitura = `NÃO LIDO: arquivo ${a.mime || tipo || "desconhecido"} não é lido aqui.`;
    }
  } catch (e) { leitura = "NÃO LIDO: a leitura falhou."; }
  const definitiva = !!modelo || !/falhou|não pôde ser transcrito/.test(leitura);
  return { leitura, modelo, definitiva };
}

/* As mídias do cliente ainda não lidas, as mais recentes primeiro — é o
 * fim da conversa que a resposta precisa entender. */
const faltaLer = (msgs) => (msgs || []).filter((m) => !m.eco && m.tipo === "midia" && !m.leitura
  && m.anexo && m.anexo.tipo !== "sticker" && m.anexo.chave).slice(-MIDIAS_POR_VEZ);

module.exports = { MIDIAS_POR_VEZ, lerArquivo, faltaLer };
