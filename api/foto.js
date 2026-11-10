/**
 * /api/foto — as imagens do veículo no Supabase Storage.
 *
 * POST   { veiculo_id, imagem_base64, ordem }   sobe a imagem e grava a linha
 * GET    ?veiculo_id=                           as fotos em ordem, link de 1 h
 * PATCH  { ordens: [{ id, ordem }] }            reordena / define a capa
 * DELETE ?id=                                   apaga do Storage e da tabela
 *
 * Mesmas regras do api/veiculo.js: fetch puro, sem biblioteca, e a
 * chave de serviço não sai daqui — nem em resposta, nem em log.
 *
 * Depende da migração 0002: tabela `foto` (id, veiculo_id, caminho,
 * ordem, largura, altura, bytes) e o bucket privado `fotos-veiculo`.
 *
 * A 0002 tem índice único em (veiculo_id, ordem) — "evita duas capas".
 * Isso é o que torna a reordenação um caso especial: ver o PATCH.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_KEY || "";

const BUCKET = "fotos-veiculo";
const VALIDADE = 3600;                 // 1 hora de link assinado
const MAX_BYTES = 5 * 1024 * 1024;     // o mesmo file_size_limit do bucket

const REST = (tabela) => `${URL_BASE}/rest/v1/${tabela}`;
const STORAGE = () => `${URL_BASE}/storage/v1`;

const ANON = process.env.SUPABASE_ANON_KEY || "";

/**
 * O token do usuário logado, repassado como veio. Quem valida é o
 * PostgREST. Não pode virar variável de módulo: duas requisições
 * simultâneas na mesma instância trocariam de usuário.
 */
const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const SEM_LOGIN = { erro: "Sessão expirada. Entre de novo." };

// Banco: fala pelo usuário, então a RLS da 0004 vale.
const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

/**
 * Storage: continua na chave de serviço. A 0002 criou o bucket privado
 * e não criou política em storage.objects — com o token do usuário, o
 * upload e a leitura seriam recusados.
 *
 * Quem protege aqui é a ordem das operações: toda chamada ao Storage
 * vem depois de uma consulta ao banco feita pelo usuário. Se a RLS não
 * devolver a linha, a função para antes de tocar no arquivo.
 */
const hArquivo = (extra) => ({ apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, ...extra });
const jsonArquivo = (extra) => hArquivo({ "Content-Type": "application/json", ...extra });

// Rede de segurança: se a chave aparecer em qualquer texto, some.
const limpar = (s) => {
  const t = String(s == null ? "" : s);
  return CHAVE ? t.split(CHAVE).join("[oculto]") : t;
};

const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const falha = (msg, status) => {
  const e = new Error(limpar(msg));
  e.status = status || 502;
  return e;
};

/* ------------------ conversa com o Supabase ------------------ */

async function pedir(url, opcoes, oQue) {
  let r;
  try {
    r = await fetch(url, opcoes);
  } catch (e) {
    throw falha(`Não consegui falar com o ${oQue}.`, 502);
  }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (dado && (dado.message || dado.error || dado.hint || dado.details)) ||
      `O ${oQue} recusou a operação.`;
    throw falha(msg, r.status === 401 || r.status === 403 ? 500 : 502);
  }
  return dado;
}

const banco = (url, opcoes) => pedir(url, opcoes, "banco");
const arquivos = (url, opcoes) => pedir(url, opcoes, "Storage");

/* ------------------ imagem ------------------ */

// Aceita data URL ("data:image/jpeg;base64,…") ou base64 puro.
function decodificar(dado) {
  let s = String(dado == null ? "" : dado).trim();
  if (s.slice(0, 5) === "data:") {
    const v = s.indexOf(",");
    if (v < 0) return null;
    s = s.slice(v + 1);
  }
  s = s.replace(/\s/g, "");
  if (!s || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const buf = Buffer.from(s, "base64");
  // Só JPEG: o caminho termina em .jpg e é o que comprimir() gera.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  return buf;
}

function sufixo() {
  try { return globalThis.crypto.randomUUID().slice(0, 8); }
  catch (e) { return Math.random().toString(36).slice(2, 10); }
}

const paraURL = (caminho) => caminho.split("/").map(encodeURIComponent).join("/");

async function assinar(caminhos) {
  if (!caminhos.length) return {};
  const r = await arquivos(`${STORAGE()}/object/sign/${BUCKET}`, {
    method: "POST",
    headers: jsonArquivo(),
    body: JSON.stringify({ expiresIn: VALIDADE, paths: caminhos }),
  });
  const mapa = {};
  (Array.isArray(r) ? r : []).forEach((x) => {
    const assinada = x && (x.signedURL || x.signedUrl);
    if (!assinada) return;
    mapa[x.path] = assinada.charAt(0) === "/" ? `${STORAGE()}${assinada}` : assinada;
  });
  return mapa;
}

async function apagarArquivo(caminho) {
  try {
    await arquivos(`${STORAGE()}/object/${BUCKET}/${paraURL(caminho)}`, {
      method: "DELETE",
      headers: hArquivo(),
    });
  } catch (e) {
    // Arquivo que já não existe é sucesso: o retry precisa convergir.
  }
}

/* ------------------ handler ------------------ */

const BUCKET_DOC = "documentos-veiculo";
const MAX_DOC = 10 * 1024 * 1024;      // o mesmo file_size_limit da 0008

// O que o bucket aceita (0008). PDF entra aqui e não no de fotos.
const TIPOS_DOC = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

// Os tipos que a tela oferece (`ROTULOS_ATENDIMENTO`). As CNHs separadas e
// o dossiê entraram na tela em 03/11/2026 e só aqui em 05/11 — até lá
// caíam como "Outro". **Quem acrescentar tipo na tela acrescenta aqui.**
const ROTULOS = [
  "CRLV", "CNH", "CNH do contratante", "CNH do proprietário", "CNH (contratante e proprietário)",
  "Identidade", "Comprovante de residência", "Dossiê do Detran",
  "Laudo cautelar", "Comprovante de pagamento", "Contrato assinado", "Outro",
];

/**
 * O envio do carro para o Shinkai.
 *
 * **Por que isto mora no api/foto.js e não no api/veiculo.js**, que é
 * onde o estoque vive: o Shinkai pede as fotos como URLs que ele possa
 * baixar, e o bucket é privado. Assinar link é a única coisa que usa a
 * `SUPABASE_SERVICE_KEY`, e a decisão 9 confina essa chave a este
 * arquivo. Levar o envio para outro lugar significaria espalhar a
 * chave — que é exatamente o que aquela decisão evita.
 *
 * O link assinado vale 1 h. É de sobra: o Shinkai **baixa e guarda
 * cópia** na hora do POST, então o que precisa estar de pé é o momento
 * da chamada, não o dia seguinte.
 *
 * A chave da conta (`SHINKAI_API_KEY`) só existe em variável de
 * ambiente. Não está no repositório, não vai ao navegador, não aparece
 * em log — mesma regra do ZapSign. O GET responde apenas se ela
 * existe, nunca o valor: sem esse teste, descobrir que a variável não
 * subiu seria errar com o carro já no pátio.
 */
const SHINKAI_URL = "https://www.shinkai.com.br/api/public/veiculo";
/* A CHAVE É APARADA, e a FORMA dela é conferível por fora (09/10/2026).
 * O envio funcionava pela Vercel e falhava pelo Cloudflare — o
 * negociador só via "não foi" —, e a rede estava inocente: da borda da
 * Cloudflare o Shinkai responde igual. Sobrava a chave, e o GET abaixo
 * só dizia "configurada", que um placeholder de 11 caracteres, um
 * espaço colado junto ou uma quebra de linha também são. `fetch`
 * recusa cabeçalho com quebra de linha, e o `catch` engolia o motivo.
 *
 * **A forma nunca devolve o valor**: só a classe — ausente, curta
 * (o tamanho do placeholder que `vercel env pull` entrega para
 * variável Sensitive, ver `worker/mudar-segredos.mjs`), com caractere
 * inválido, ou ok. Mesma régua do `configurado`, e é o que distingue
 * "não subiu" de "subiu errado" sem abrir o painel com o carro na mesa. */
const SHINKAI_BRUTA = process.env.SHINKAI_API_KEY || "";
const SHINKAI_KEY = SHINKAI_BRUTA.trim();
const formaDaChave = () => !SHINKAI_KEY ? "ausente"
  : SHINKAI_KEY.length <= 20 ? "curta"
  : /[^\x21-\x7E]/.test(SHINKAI_KEY) ? "caractere_invalido"
  : SHINKAI_BRUTA !== SHINKAI_KEY ? "ok_com_espaco_nas_pontas" : "ok";
const SHINKAI_ORIGEM = process.env.SHINKAI_ORIGEM || "vaapty-joinville";

// Os opcionais sao CHIPS na ficha do Shinkai, e o casamento e pelo
// NOME EXATO: o que nao bate com um chip deles e descartado em
// silencio. Esta casa supunha o contrario ate 21/09/2026 -- estava
// escrito na decisao 36 que opcional sem chip "entra como texto livre
// e aparece igual". Nao entra: a secao OPCIONAIS da ficha deles sao
// nove botoes e nao tem campo de texto nenhum.
//
// Conferido na ficha do QUI3D81, enviada as 13:35 daquele dia: foram
// quatro opcionais ("Completo", "Ar condicionado", "Direcao
// hid./elet.", "Travas eletricas") e a ficha deles mostrou dois.
//
// Os nove chips, lidos na tela deles na mesma data: Completo, Ar
// condicionado, Direcao hidraulica/eletrica, ABS, Som / Multimidia,
// Sensor de re, Camera de re, Rodas de liga, Bancos em couro. Oito
// batem letra a letra com os nossos; o nono e abreviado aqui, e e o
// unico que esta traducao conserta.
//
// Mesma forma do `shinkai_nome` (decisao 44): traducao entre dois
// mundos e CADASTRO, nunca aproximacao. **Quem acrescentar entrada
// aqui confere o rotulo na ficha deles, nao de memoria** -- chip
// errado poe na mao do lojista equipamento que o carro nao tem, e o
// erro e silencioso dos dois lados.
const OPCIONAL_SHINKAI = {
  "Direção hid./elét.": "Direção hidráulica/elétrica",
};

const numeroOuNulo = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

async function shinkai(req, res, tok) {
  if (req.method === "GET") return res.status(200).json({ configurado: !!SHINKAI_KEY, forma: formaDaChave() });
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Use GET ou POST." });
  }
  if (!SHINKAI_KEY) {
    return res.status(503).json({
      erro: "A chave do Shinkai não está configurada. Ela vai em SHINKAI_API_KEY, nas variáveis de ambiente da Vercel.",
    });
  }

  // ---------------------------------------------------------------
  // Dois caminhos, e são dois momentos diferentes da vida do carro.
  //
  //   veiculo_id — o LANÇAMENTO: a ficha em avaliação, com o cliente
  //                na mesa, indo à rede para receber proposta. O carro
  //                ainda não é nosso, então não há valor de compra —
  //                e é por isso que o Shinkai o recebe como "em
  //                avaliação", que é o estado certo para ele.
  //   estoque_id — a VENDA: o carro já comprado, com valor de compra,
  //                indo à rede para ser repassado.
  //
  // O resultado de cada um fica na sua própria linha (0030 e 0039):
  // são dois envios com respostas diferentes, e misturá-los faria
  // "já está lá" responder pela viagem errada.
  // ---------------------------------------------------------------
  const eid = String(req.query.estoque_id || "");
  const vid = String(req.query.veiculo_id || "");
  if (!RX_UUID.test(eid) && !RX_UUID.test(vid)) {
    return res.status(400).json({ erro: "Informe estoque_id ou veiculo_id." });
  }

  const CAMPOS_V = "id,placa,chassi,marca_modelo,marca,modelo,versao,ano_fabricacao,ano_modelo,cor,combustivel," +
    "cambio,km_atual,fipe_codigo,fipe_valor,leilao_sinistro,gnv," +
    // Os tres codigos que movem os seletores da ficha deles (0043).
    "fipe_marca_codigo,fipe_modelo_codigo,fipe_ano_codigo,tipo_veiculo," +
    // O carro chegava pelado do outro lado: pneu, opcional e ressalva
    // ficavam de fora do corpo, e são justamente os campos que a tela
    // deles pede para o carro poder ser ofertado.
    "pneu_de,pneu_dd,pneu_te,pneu_td,opcionais,gastos_descricao,ressalvas_lojista,pontos_positivos," +
    // A PEDIDA (0053) — outro número, não o `valor_por`.
    "preco_pedido";

  // A leitura vai pelo TOKEN DO USUÁRIO: é a RLS que decide se esta
  // pessoa enxerga este carro. A chave de serviço entra depois, e só
  // para assinar os links das fotos.
  let e = null, v = null;
  if (RX_UUID.test(eid)) {
    const achado = await banco(
      `${REST("estoque")}?select=id,valor_compra,preco_pedido,negociador_nome,veiculo(${CAMPOS_V})&id=eq.${eid}&limit=1`,
      { headers: cabecalhos(tok) }
    );
    e = Array.isArray(achado) ? achado[0] : null;
    if (!e || !e.veiculo) return res.status(404).json({ erro: "Carro não encontrado no estoque." });
    v = e.veiculo;
  } else {
    // O `atendimento` embutido só existe para pegar o negociador: a
    // 0001 nunca deu coluna de negociador ao veículo, e o nome do
    // responsável é o que a ficha do Shinkai pede.
    const achado = await banco(
      `${REST("veiculo")}?select=${CAMPOS_V},valor_por,atendimento(negociador_nome)&id=eq.${vid}&limit=1`,
      { headers: cabecalhos(tok) }
    );
    v = Array.isArray(achado) ? achado[0] : null;
    if (!v) return res.status(404).json({ erro: "Ficha não encontrada." });
  }

  // Quem responde pelo carro do lado de lá. No estoque é o negociador
  // gravado na entrada; na avaliação é o do atendimento. **O nome
  // precisa existir na equipe da franquia** — quando não existe, o
  // carro entra sem responsável e a resposta traz um aviso com os
  // nomes válidos, que a tela mostra. É assim que se descobre um erro
  // de grafia na hora, em vez de descobrir pelo carro sem dono.
  const nomeDaqui = (e && e.negociador_nome)
    || (v.atendimento && v.atendimento.negociador_nome)
    || null;

  // **A tradução é cadastro, não aproximação.** Aqui a pessoa é
  // "TIAGO"; lá ela é "Tiago Tisott" — e a equipe deles tem também um
  // "Thiago Santos de Souza", que é outra pessoa. Casar pelo primeiro
  // nome acertaria Dimas, erraria Tiago, e o erro seria **silencioso**:
  // o carro entra com o responsável trocado e ninguém vê. Então quem
  // traduz é `negociador.shinkai_nome` (0044), escrito uma vez.
  //
  // Sem tradução cadastrada vai o nome daqui, e o aviso do Shinkai
  // volta listando os nomes válidos — que é justamente como se
  // descobre o que escrever no cadastro.
  let responsavel = nomeDaqui;
  if (nomeDaqui) {
    try {
      const achados = await banco(
        `${REST("negociador")}?select=shinkai_nome&nome=eq.${encodeURIComponent(nomeDaqui)}&limit=1`,
        { headers: cabecalhos(tok) },
      );
      const t = ((achados || [])[0] || {}).shinkai_nome;
      if (t) responsavel = t;
    } catch (err) { /* sem cadastro, segue com o nome daqui */ }
  }
  if (!v.placa) return res.status(400).json({ erro: "O carro precisa de placa para ir ao Shinkai." });

  const fotos = await banco(
    `${REST("foto")}?select=caminho,ordem&veiculo_id=eq.${v.id}&order=ordem.asc`,
    { headers: cabecalhos(tok) }
  ) || [];
  const links = await assinar(fotos.map((f) => f.caminho));
  const urls = fotos.map((f) => links[f.caminho]).filter(Boolean);

  // O ano vai como "2009/2010" quando os dois diferem — é o formato que
  // eles leem e devolvem separado.
  const ano = v.ano_fabricacao && v.ano_modelo && v.ano_fabricacao !== v.ano_modelo
    ? `${v.ano_fabricacao}/${v.ano_modelo}`
    : String(v.ano_modelo || v.ano_fabricacao || "");

  const corpo = {
    origem: SHINKAI_ORIGEM,
    veiculo: {
      placa: v.placa,
      chassi: v.chassi || undefined,
      // **As três partes quando existem, a string única quando não.**
      // A documentação deles diz que marca/modelo/versao separados é
      // melhor, e a tela deles tem três selects ligados à FIPE: com a
      // string única os três ficam vazios do lado de lá — foi o que o
      // Derek viu em 11/09/2026 ("está indo sem os dados do carro").
      //
      // As partes vêm da 0041, preenchidas pela fonte: consulta de
      // placa ou tabela FIPE oficial. **Nunca são derivadas aqui por
      // corte de token** — Land Rover e Alfa Romeo quebrariam o corte,
      // e ficha antiga sem as colunas cai na string inteira, que é
      // exatamente o comportamento anterior.
      marca: v.marca || undefined,
      modelo: v.modelo || undefined,
      versao: v.versao || undefined,
      marca_modelo: v.marca && v.modelo ? undefined : (v.marca_modelo || undefined),
      ano_modelo: ano || undefined,
      cor: v.cor || undefined,
      combustivel: v.combustivel || undefined,
      cambio: v.cambio || undefined,
      km_atual: numeroOuNulo(v.km_atual) || undefined,
      fipe_codigo: v.fipe_codigo || undefined,
      fipe_valor: numeroOuNulo(v.fipe_valor) || undefined,
      // "o que a loja pagou … é o alvo da negociação", pela
      // documentação deles. Comprado, é o `valor_compra`; ainda em
      // avaliação não há o que a loja pagou, e o alvo é o POR — o
      // número que o negociador quer ver voltar da rede. Sem nenhum
      // dos dois o Shinkai recebe o carro como "em avaliação", e diz
      // isso nos avisos.
      valor_investimento: numeroOuNulo(e ? e.valor_compra : v.valor_por) || undefined,
      // **A PEDIDA é outro número, e ficou R$ 0 em todos os carros até
      // 17/09/2026.** O `valor_investimento` acima vira o POR do
      // descritivo deles (conferido na ficha da AWA1F10); a `pedida` é
      // o que se pede ao lojista. O Mateus confirmou o nome no mesmo
      // dia — `valor_minimo_aceitavel` é o apelido antigo dela.
      //
      // Comprado, é o preço pedido do estoque (0019); em avaliação, o
      // da ficha (0053). Mesmo par do `valor_compra`/`valor_por`.
      // UM NÚMERO SÓ (19/09/2026, correção do Derek): a pedida é o mesmo valor do POR. O campo
      // separado saiu da tela; o `valor_por` entra como reserva para as fichas gravadas antes
      // disso, senão elas voltariam a chegar lá com pedida R$ 0 — o defeito que a 0053 corrigiu.
      pedida: numeroOuNulo(e ? (e.preco_pedido || e.valor_compra) : (v.preco_pedido || v.valor_por)) || undefined,
      // `leilao` e `sinistro` separados também, porque a documentação
      // diz que eles aceitam os dois formatos e o nosso é um só.
      leilao_sinistro: !!v.leilao_sinistro,
      leilao: !!v.leilao_sinistro,
      sinistro: !!v.leilao_sinistro,
      gnv: !!v.gnv,
      // Deixou de ser "carros" fixo em 14/09/2026: a conferência da FIPE
      // passou a perguntar o tipo, e moto entrava aqui como carro.
      // Ficha sem a coluna (0045) cai em carro, que é o padrão dela.
      tipo_veiculo: ({ 2: "motos", 3: "caminhoes" })[v.tipo_veiculo] || "carros",
      // **Os três códigos juntos, ou nenhum.** É regra da API deles:
      // mandar um ou dois deixa os seletores vazios do mesmo jeito e
      // ainda gera aviso. Ficha que não passou pela conferência da
      // tabela oficial não tem os três, e aí vai sem — o nome continua
      // preenchendo o resto.
      ...(v.fipe_marca_codigo && v.fipe_modelo_codigo && v.fipe_ano_codigo ? {
        fipe_marca_codigo: v.fipe_marca_codigo,
        fipe_modelo_codigo: v.fipe_modelo_codigo,
        fipe_ano_codigo: v.fipe_ano_codigo,
      } : {}),
      comprador_responsavel: responsavel || undefined,
      // Os quatro pneus, com os nomes que a tela deles usa. Iam de
      // fora do corpo até 11/09/2026 — o carro entrava sem condição de
      // pneu nenhuma.
      pneus: {
        dianteiro_esquerdo: v.pneu_de || undefined,
        dianteiro_direito: v.pneu_dd || undefined,
        traseiro_esquerdo: v.pneu_te || undefined,
        traseiro_direito: v.pneu_td || undefined,
      },
      // O que nao tem chip do lado deles continua indo assim mesmo.
      // Custa nada -- hoje e ignorado -- e no dia em que a lista deles
      // crescer, o carro passa a chegar inteiro sem precisar de deploy
      // aqui. Empurrar esses para `pontos_positivos` para "aparecer de
      // algum jeito" e o erro que a decisao 46 proibe: o campo que o
      // lojista le nao e lugar de dado que nao coube em outro.
      opcionais: Array.isArray(v.opcionais) && v.opcionais.length
        ? v.opcionais.map((o) => OPCIONAL_SHINKAI[o] || o)
        : undefined,
      gastos: v.gastos_descricao || undefined,
      // Ressalva vai; observação interna NUNCA (decisão 2). O Shinkai
      // é a plataforma da casa, mas o que está nesse campo foi escrito
      // para ser lido pelo lojista, e o outro não.
      ressalvas: Array.isArray(v.ressalvas_lojista) && v.ressalvas_lojista.length ? v.ressalvas_lojista : undefined,
      pontos_positivos: Array.isArray(v.pontos_positivos) && v.pontos_positivos.length ? v.pontos_positivos : undefined,
      fotos: urls.length ? urls : undefined,
    },
  };

  let r;
  try {
    r = await fetch(SHINKAI_URL, {
      method: "POST",
      headers: { "x-api-key": SHINKAI_KEY, "content-type": "application/json" },
      body: JSON.stringify(corpo),
    });
  } catch (err) {
    /* O MOTIVO NÃO SE ENGOLE, e também não se repassa cru: a mensagem
     * de um `fetch` que recusa cabeçalho pode trazer o próprio valor
     * dele — a chave. Vai o NOME do erro e a forma da chave; o resto
     * fica no registro do servidor. */
    const forma = formaDaChave();
    console.error("shinkai: fetch falhou", err && err.name, "forma da chave:", forma, "tamanho:", SHINKAI_KEY.length);
    return res.status(502).json({
      erro: forma === "caractere_invalido"
        ? "A chave do Shinkai guardada tem espaço, acento ou quebra de linha no meio. Grave-a de novo em SHINKAI_API_KEY."
        : forma === "curta"
        ? "A chave do Shinkai guardada é curta demais — parece o placeholder da Vercel, não a chave. Grave-a de novo em SHINKAI_API_KEY."
        : `Não consegui falar com o Shinkai (${String((err && err.name) || "erro de rede").slice(0, 40)}).`,
    });
  }
  const texto = await r.text();
  let d = null;
  try { d = texto ? JSON.parse(texto) : null; } catch (err) {}

  if (!r.ok) {
    // Os erros de campo vêm em `erros`, e é isso que resolve o problema
    // de quem está com o carro na frente. Engolir a lista e dizer só
    // "falhou" obrigaria a abrir o log da Vercel.
    const detalhe = d && Array.isArray(d.erros) ? d.erros.join(" · ") : "";
    const msg = r.status === 401 ? `O Shinkai recusou a chave (401). Confira SHINKAI_API_KEY — a que está guardada aqui é "${formaDaChave()}".`
      : r.status === 422 ? `O Shinkai não aceitou os dados: ${detalhe || "sem detalhe"}`
      : `O Shinkai respondeu ${r.status}.${detalhe ? ` ${detalhe}` : ""}`;
    console.error("shinkai: respondeu", r.status, "forma da chave:", formaDaChave());
    return res.status(502).json({ erro: limpar(msg), erros: (d && d.erros) || null });
  }

  // O que voltou fica gravado: sem isso ninguém sabe se o carro já
  // está lá, e reenviar vira adivinhação.
  // O endereço do carro na plataforma deles, que é o que o descritivo
  // leva ao grupo dos lojistas. A resposta DOCUMENTADA não traz isso —
  // então procuro os nomes plausíveis e aceito o primeiro que vier, em
  // vez de montar a URL a partir do `id`: chutar o formato do site
  // deles poria link quebrado no grupo. Enquanto nenhum vier, fica
  // nulo e o descritivo diz que o link ainda não existe.
  const endereco = (() => {
    if (!d) return null;
    // O `url` vem pronto na resposta desde 11/09/2026. Os outros
    // nomes ficam por tolerância: custam nada e cobrem o dia em que
    // alguém renomear o campo do lado de lá.
    for (const k of ["url", "link", "permalink", "oferta_url", "veiculo_url", "url_publica"]) {
      const u = d[k];
      if (typeof u === "string" && /^https?:\/\//i.test(u)) return u.slice(0, 500);
    }
    // **A montagem manual saiu, e de propósito.** Ela existiu por
    // algumas horas em 11/09/2026, enquanto a resposta não trazia
    // endereço: o formato tinha sido conferido no botão "Link do app"
    // do painel deles. O Mateus incluiu o campo `url` no mesmo dia e
    // pediu para apagá-la — o app deve ganhar domínio próprio, e um
    // link montado aqui passaria a apontar para o lugar errado sem
    // ninguém perceber. Link quebrado no grupo dos lojistas é pior que
    // link nenhum, e sem endereço o descritivo apenas não imprime a
    // linha.
    return null;
  })();

  const marca = {
    shinkai_id: (d && d.id) || null,
    shinkai_status: (d && d.status) || null,
    shinkai_url: endereco,
    shinkai_em: new Date().toISOString(),
  };
  // Duas tentativas, e a segunda é sem o endereço. `shinkai_url` é
  // coluna nova (0040): num banco que ainda não a tenha, o PATCH
  // inteiro seria recusado e levaria junto o `shinkai_em` — que é o
  // que libera o descritivo. Mesmo remédio do casamento de títulos na
  // decisão 29: o que se perde é só a amarração, nunca o principal.
  const alvo = e ? `${REST("estoque")}?id=eq.${eid}` : `${REST("veiculo")}?id=eq.${v.id}`;
  try {
    await banco(alvo, { method: "PATCH", headers: json(tok), body: JSON.stringify(marca) });
  } catch (err) {
    const { shinkai_url, ...semUrl } = marca;
    await banco(alvo, { method: "PATCH", headers: json(tok), body: JSON.stringify(semUrl) }).catch(() => {});
  }

  return res.status(200).json({
    ok: true,
    id: d && d.id, acao: d && d.acao, status: d && d.status,
    url: endereco,
    fotos: d && d.fotos, avisos: (d && d.avisos) || [],
    fotos_enviadas: urls.length,
  });
}

/* ---------------------------------------------------------------
 * A VENDA VAI AO SHINKAI (0071, 20/10/2026).
 *
 *   POST ?recurso=shinkai-venda&estoque_id=   { acao: "vendido" | "cancelado", motivo?, substituir? }
 *
 * O formato é o do Mateus (`POST /api/public/venda`, a mesma chave da
 * entrada de veículos): placa, valor, data e comprador. O comprador vai
 * COMO ESTÁ no cadastro — o casamento lá é DDD + os 8 últimos dígitos, e
 * ele pediu para não completar o 9 aqui, para não mexer no dado da
 * origem. Sem DDD, sem telefone ou fora da base, lá vira "por fora do
 * CRM" com aviso, e isso NÃO é erro: a venda nunca se perde porque o
 * cadastro está diferente nos dois lados.
 *
 * Mora aqui pelo mesmo motivo do envio do veículo (decisão 36): é o
 * arquivo onde a `SHINKAI_API_KEY` vive. A leitura do carro vai pelo
 * token do usuário — se a RLS não devolver a linha, nada sai.
 *
 * **Comissão de indicação não vai** (decisão 57): o carro nunca foi
 * nosso, e normalmente nem existe no estoque deles.
 *
 * **409 é o carro vendido lá para OUTRO comprador.** Não se resolve
 * sozinho: a tela pergunta, e com `substituir` manda o cancelamento e a
 * venda nova, na ordem que o Mateus pediu. Trocar o comprador do lado
 * de lá sem ninguém decidir apagaria uma venda que alguém registrou.
 * --------------------------------------------------------------- */
const SHINKAI_VENDA_URL = "https://www.shinkai.com.br/api/public/venda";

async function shinkaiVenda(req, res, tok) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
  if (!SHINKAI_KEY) return res.status(503).json({ erro: "A chave do Shinkai não está configurada (SHINKAI_API_KEY)." });
  const eid = String(req.query.estoque_id || "");
  if (!RX_UUID.test(eid)) return res.status(400).json({ erro: "estoque_id inválido." });
  let c = req.body;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (err) { c = null; } }
  c = c && typeof c === "object" ? c : {};
  const acao = c.acao === "cancelado" ? "cancelado" : "vendido";

  const achado = await banco(
    `${REST("estoque")}?select=id,natureza,situacao,valor_venda,vendido_em,veiculo(placa),comprador(id,nome,telefone)&id=eq.${eid}&limit=1`,
    { headers: cabecalhos(tok) });
  const e = Array.isArray(achado) ? achado[0] : null;
  if (!e || !e.veiculo || !e.veiculo.placa) return res.status(404).json({ erro: "Carro não encontrado no estoque." });
  if (e.natureza === "indicacao" || e.natureza === "multa") return res.status(200).json({ ok: true, pulado: e.natureza });

  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const cancelamento = { placa: e.veiculo.placa, status: "cancelado", motivo: String(c.motivo || "venda desfeita no ERP").slice(0, 200) };
  let corpo = cancelamento;
  if (acao === "vendido") {
    if (e.situacao !== "vendido") return res.status(409).json({ erro: "O carro não está como vendido aqui." });
    const comp = e.comprador || {};
    const dia = e.vendido_em ? String(e.vendido_em).slice(0, 10) : null;
    corpo = {
      placa: e.veiculo.placa, status: "vendido",
      valor: Number(e.valor_venda) || undefined,
      // Data futura o Shinkai recusa; sem data, vale a hora do envio.
      data_venda: dia && dia <= hoje ? dia : undefined,
      comprador: { telefone: comp.telefone || undefined, nome: comp.nome || undefined },
    };
  }

  const mandar = async (b) => {
    let r;
    try {
      r = await fetch(SHINKAI_VENDA_URL, {
        method: "POST", headers: { "x-api-key": SHINKAI_KEY, "content-type": "application/json" }, body: JSON.stringify(b),
      });
    } catch (err) {
      console.error("shinkai-venda: fetch falhou", err && err.name);
      return { status: 0, d: null };
    }
    const t = await r.text();
    let d = null; try { d = t ? JSON.parse(t) : null; } catch (err) {}
    return { status: r.status, d };
  };

  let resp;
  if (acao === "vendido" && c.substituir) {
    const can = await mandar(cancelamento);
    if (can.status && can.status !== 200) return res.status(502).json({ erro: `O Shinkai não desfez a venda anterior (${can.status}).` });
  }
  resp = await mandar(corpo);
  const { status, d } = resp;

  if (status === 0) return res.status(502).json({ erro: "Não consegui falar com o Shinkai. A venda aqui está gravada; tente mandar de novo." });
  if (status === 401) return res.status(502).json({ erro: `O Shinkai recusou a chave (401). A guardada aqui é "${formaDaChave()}".` });
  // Carro que não está no estoque deles (nunca foi enviado): a venda
  // daqui vale do mesmo jeito, e a tela só avisa.
  if (status === 404) {
    const aviso = "Este carro não está no estoque do Shinkai — nada a marcar lá.";
    await banco(`${REST("estoque")}?id=eq.${eid}`, { method: "PATCH", headers: json(tok),
      body: JSON.stringify({ shinkai_venda_acao: "fora_do_shinkai", shinkai_venda_origem: null, shinkai_venda_avisos: [aviso], shinkai_venda_em: new Date().toISOString() }) }).catch(() => {});
    return res.status(200).json({ ok: false, acao: "fora_do_shinkai", avisos: [aviso] });
  }
  if (status === 409) {
    return res.status(409).json({ conflito: true,
      erro: "No Shinkai este carro já está vendido para OUTRO comprador. Confirme para desfazer a venda de lá e registrar esta." });
  }
  if (status < 200 || status >= 300) {
    const detalhe = d && Array.isArray(d.erros) ? d.erros.join(" · ") : "";
    return res.status(502).json({ erro: limpar(`O Shinkai respondeu ${status}.${detalhe ? ` ${detalhe}` : ""}`) });
  }

  const avisos = (d && Array.isArray(d.avisos)) ? d.avisos.map((x) => limpar(String(x))).slice(0, 10) : [];
  await banco(`${REST("estoque")}?id=eq.${eid}`, { method: "PATCH", headers: json(tok),
    body: JSON.stringify({
      shinkai_venda_acao: (d && d.acao) || acao, shinkai_venda_origem: (d && d.origem) || null,
      shinkai_venda_avisos: avisos, shinkai_venda_em: new Date().toISOString(),
    }) }).catch(() => {});
  // O id do lojista que eles casaram fica no cadastro do comprador: é a
  // prova de que os dois lados falam da mesma loja (o `shinkai_id` existe
  // desde a 0019 e nunca tinha sido preenchido).
  const lojista = d && d.comprador && d.comprador.lojista_id;
  if (acao === "vendido" && lojista && e.comprador && e.comprador.id) {
    await banco(`${REST("comprador")}?id=eq.${e.comprador.id}`, { method: "PATCH", headers: json(tok),
      body: JSON.stringify({ shinkai_id: String(lojista).slice(0, 120) }) }).catch(() => {});
  }
  return res.status(200).json({ ok: true, acao: d && d.acao, origem: d && d.origem, avisos, comprador: d && d.comprador ? { nome: d.comprador.nome } : null });
}

const ZAPSIGN = "https://api.zapsign.com.br/api/v1";
const ZAP_TOKEN = process.env.ZAPSIGN_TOKEN || "";

/**
 * Anexos do negócio (0008): CRLV em PDF, CNH ou identidade do cliente,
 * comprovante de residência, laudo, comprovante de pagamento.
 *
 * Mora sob /api/foto porque é o arquivo que já fala com o Storage — e
 * porque a Vercel do plano Hobby para em 12 funções e nós estamos nas
 * 12. Acomodação de teto, não arquitetura.
 *
 * A chave de serviço continua sendo só para o Storage. O que protege é
 * a ordem: toda ida ao arquivo acontece depois de uma consulta ao banco
 * feita com o token do usuário — se a RLS não devolver o atendimento, a
 * função para antes de tocar no arquivo.
 *
 * **Aqui trafega documento de identidade.** Nada é escrito em log, o
 * bucket é privado e o link é assinado por uma hora. A conversa sobre
 * por quanto tempo isso pode ficar guardado é do jurídico — está em
 * PENDENCIAS.md.
 */
async function anexos(req, res, tok) {
  const assinarDoc = async (caminhos) => {
    if (!caminhos.length) return {};
    const r = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}`, {
      method: "POST", headers: jsonArquivo(),
      body: JSON.stringify({ expiresIn: VALIDADE, paths: caminhos }),
    });
    const mapa = {};
    (Array.isArray(r) ? r : []).forEach((x) => {
      const a = x && (x.signedURL || x.signedUrl);
      if (a) mapa[x.path] = a.charAt(0) === "/" ? `${STORAGE()}${a}` : a;
    });
    return mapa;
  };

  if (req.method === "GET") {
    const aid = String(req.query.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });
    const linhas = await banco(
      `${REST("anexo")}?select=*&atendimento_id=eq.${aid}&order=criado_em.desc`,
      { headers: cabecalhos(tok) }
    );
    const lista = Array.isArray(linhas) ? linhas : [];
    const urls = await assinarDoc(lista.map((x) => x.caminho));
    return res.status(200).json({
      anexos: lista.map((x) => ({ ...x, url: urls[x.caminho] || null })),
      rotulos: ROTULOS,
    });
  }

  if (req.method === "POST") {
    let corpo = req.body;
    if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
    if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
    if (!corpo || typeof corpo !== "object") return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });

    /* A VIA ASSINADA DO LOJISTA vai sozinha para o item "Contrato
     * Lojista" do check list (05/11/2026, o Derek: "quando o lojista
     * assina … já tem que ficar automaticamente anexado, sem necessidade
     * do adm anexar"). O contrato é do carro vendido (0109), o check list
     * é do atendimento: a ponte é `estoque.atendimento_id`. A tela chama
     * isto ao abrir o check list e a ficha do carro vendido — quem chega
     * primeiro guarda, e repetir não empilha vias. Barato quando não há o
     * que fazer: o ZapSign só é consultado com contrato enviado e sem a
     * via guardada. */
    if (String(req.query.acao || "") === "contrato-lojista-assinado") {
      const eidL = String(corpo.estoque_id || ""), aidL = String(corpo.atendimento_id || "");
      if (!RX_UUID.test(eidL) && !RX_UUID.test(aidL)) return res.status(400).json({ erro: "estoque_id ou atendimento_id inválido." });
      const filtro = RX_UUID.test(eidL) ? `id=eq.${eidL}` : `atendimento_id=eq.${aidL}&lojista_zapsign_token=not.is.null`;
      const es = (await banco(`${REST("estoque")}?select=id,atendimento_id,lojista_zapsign_token,lojista_assinado_em&${filtro}&order=lojista_enviado_em.desc.nullslast&limit=1`,
        { headers: cabecalhos(tok) }) || [])[0];
      if (!es || !es.lojista_zapsign_token) return res.status(200).json({ ok: true, nada: true });
      if (!es.atendimento_id) return res.status(200).json({ ok: true, sem_atendimento: true });
      const ROT = "doc:arq_contrato_lojista", NOME = "contrato-lojista-assinado.pdf";
      const jaTemL = await banco(`${REST("anexo")}?select=id&atendimento_id=eq.${es.atendimento_id}&rotulo=eq.${encodeURIComponent(ROT)}&nome=eq.${NOME}&limit=1`,
        { headers: cabecalhos(tok) });
      if (Array.isArray(jaTemL) && jaTemL[0]) return res.status(200).json({ ok: true, ja_guardado: true });
      if (!ZAP_TOKEN) return res.status(200).json({ ok: true, sem_chave: true });

      let docL;
      try {
        const r = await fetch(`${ZAPSIGN}/docs/${encodeURIComponent(es.lojista_zapsign_token)}/`, { headers: { Authorization: `Bearer ${ZAP_TOKEN}` } });
        if (!r.ok) return res.status(502).json({ erro: "O ZapSign não devolveu o contrato do lojista." });
        docL = await r.json();
      } catch (e) { return res.status(502).json({ erro: "Não consegui falar com o ZapSign." }); }
      if (String(docL.status || "").toLowerCase() !== "signed") return res.status(200).json({ ok: true, ainda: true });
      if (!es.lojista_assinado_em) {
        await banco(`${REST("estoque")}?id=eq.${es.id}`, { method: "PATCH", headers: json(tok), body: JSON.stringify({ lojista_assinado_em: new Date().toISOString() }) }).catch(() => {});
      }
      const urlL = docL.signed_file || docL.original_file;
      if (!urlL) return res.status(502).json({ erro: "O ZapSign não devolveu o arquivo assinado." });
      let pdfL;
      try {
        const r = await fetch(urlL);
        if (!r.ok) throw new Error("download");
        pdfL = Buffer.from(await r.arrayBuffer());
      } catch (e) { return res.status(502).json({ erro: "Não consegui baixar o contrato assinado do lojista." }); }
      if (!pdfL.length || pdfL.length > MAX_DOC) return res.status(413).json({ erro: "Arquivo assinado vazio ou maior que 10 MB." });

      const caminhoL = `${es.atendimento_id}/${Date.now()}-${sufixo()}.pdf`;
      await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminhoL)}`, {
        method: "POST",
        headers: hArquivo({ "Content-Type": "application/pdf", "Cache-Control": "3600", "x-upsert": "false" }),
        body: pdfL,
      });
      let salvoL;
      try {
        const r = await banco(REST("anexo"), {
          method: "POST", headers: json(tok, { Prefer: "return=representation" }),
          body: JSON.stringify({ atendimento_id: es.atendimento_id, caminho: caminhoL, tipo: "application/pdf", bytes: pdfL.length, nome: NOME, rotulo: ROT }),
        });
        salvoL = Array.isArray(r) ? r[0] : r;
      } catch (e) { await apagarDoc(caminhoL); throw e; }
      return res.status(201).json({ ok: true, guardado: true, anexo: salvoL });
    }

    const aid = String(corpo.atendimento_id || "");
    if (!RX_UUID.test(aid)) return res.status(400).json({ erro: "atendimento_id inválido." });

    /* Guardar o contrato assinado.
     *
     * O webhook só marca a data: ele chega sem login e não pode escrever
     * arquivo. Aqui há sessão, então é onde a via assinada entra para o
     * bucket e vira anexo como qualquer outro documento do negócio.
     *
     * Sem isto, "assinado" seria uma data no banco e um PDF que só
     * existe dentro do ZapSign — e contrato que a casa não tem em mãos
     * não serve quando alguém pede. */
    if (String(req.query.acao || "") === "contrato-assinado") {
      if (!ZAP_TOKEN) return res.status(503).json({ erro: "A chave do ZapSign não está configurada." });

      // A leitura pelo token do usuário é o que confirma o acesso.
      const at = await banco(
        `${REST("atendimento")}?select=contrato_zapsign_token,contrato_assinado_em,contrato_enviado_em&id=eq.${aid}&limit=1`,
        { headers: cabecalhos(tok) }
      );
      const linhaAt = Array.isArray(at) ? at[0] : null;
      const zapTok = linhaAt && linhaAt.contrato_zapsign_token;
      if (!zapTok) return res.status(404).json({ erro: "Este atendimento não tem contrato no ZapSign." });

      /* Idempotente POR DOCUMENTO (0146): o nome leva o começo do token do
       * ZapSign. Antes a marca era "já tem um Contrato assinado", e o
       * contrato reenviado nunca guardava a via nova. A via de antes de
       * 10/11/2026 (nome sem token) vale se é posterior ao último envio. */
      const nomeVia = `contrato-assinado-${String(zapTok).slice(0, 8)}.pdf`;
      const jaTem = await banco(
        `${REST("anexo")}?select=id,nome,criado_em&atendimento_id=eq.${aid}&rotulo=eq.${encodeURIComponent("Contrato assinado")}`,
        { headers: cabecalhos(tok) }
      );
      const enviado = linhaAt.contrato_enviado_em ? Date.parse(linhaAt.contrato_enviado_em) : 0;
      if ((jaTem || []).some((x) => x.nome === nomeVia || (x.nome === "contrato-assinado.pdf" && Date.parse(x.criado_em) >= enviado))) {
        return res.status(200).json({ ok: true, ja_guardado: true });
      }

      let doc;
      try {
        const r = await fetch(`${ZAPSIGN}/docs/${encodeURIComponent(zapTok)}/`, {
          headers: { Authorization: `Bearer ${ZAP_TOKEN}` },
        });
        if (!r.ok) return res.status(502).json({ erro: "O ZapSign não devolveu o documento." });
        doc = await r.json();
      } catch (e) {
        return res.status(502).json({ erro: "Não consegui falar com o ZapSign." });
      }

      if (String(doc.status || "").toLowerCase() !== "signed") {
        return res.status(409).json({ erro: "O contrato ainda não está assinado no ZapSign." });
      }
      const urlPdf = doc.signed_file || doc.original_file;
      if (!urlPdf) return res.status(502).json({ erro: "O ZapSign não devolveu o arquivo assinado." });

      let pdf;
      try {
        const r = await fetch(urlPdf);
        if (!r.ok) throw new Error("download");
        pdf = Buffer.from(await r.arrayBuffer());
      } catch (e) {
        return res.status(502).json({ erro: "Não consegui baixar o contrato assinado." });
      }
      if (!pdf.length || pdf.length > MAX_DOC) {
        return res.status(413).json({ erro: "Arquivo assinado vazio ou maior que 10 MB." });
      }

      const caminhoAss = `${aid}/${Date.now()}-${sufixo()}.pdf`;
      await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminhoAss)}`, {
        method: "POST",
        headers: hArquivo({ "Content-Type": "application/pdf", "Cache-Control": "3600", "x-upsert": "false" }),
        body: pdf,
      });

      let salvo;
      try {
        const r = await banco(REST("anexo"), {
          method: "POST",
          headers: json(tok, { Prefer: "return=representation" }),
          body: JSON.stringify({
            atendimento_id: aid, caminho: caminhoAss, tipo: "application/pdf",
            bytes: pdf.length, nome: nomeVia, rotulo: "Contrato assinado",
          }),
        });
        salvo = Array.isArray(r) ? r[0] : r;
      } catch (e) {
        await apagarDoc(caminhoAss);
        throw e;
      }

      const urls = await assinarDoc([caminhoAss]);
      return res.status(201).json({ ok: true, anexo: { ...salvo, url: urls[caminhoAss] || null } });
    }

    const tipo = String(corpo.tipo || "");
    const ext = TIPOS_DOC[tipo];
    if (!ext) return res.status(415).json({ erro: "Só PDF, JPEG, PNG ou WEBP." });

    // Aqui não dá para conferir magic bytes como nas fotos: são quatro
    // formatos. O bucket da 0008 recusa o que não estiver na lista, e é
    // ele a última palavra.
    let bruto = String(corpo.dados || "").trim();
    const virgula = bruto.indexOf(",");
    if (bruto.slice(0, 5) === "data:" && virgula > 0) bruto = bruto.slice(virgula + 1);
    bruto = bruto.replace(/\s/g, "");
    if (!bruto || !/^[A-Za-z0-9+/]+={0,2}$/.test(bruto)) return res.status(400).json({ erro: "Arquivo vazio ou fora do formato." });
    const buf = Buffer.from(bruto, "base64");
    if (!buf.length) return res.status(400).json({ erro: "Arquivo vazio." });
    if (buf.length > MAX_DOC) return res.status(413).json({ erro: "Arquivo maior que 10 MB." });

    // A consulta pelo token confirma que o atendimento existe e que a
    // RLS deixa este usuário vê-lo. Só depois o arquivo sobe.
    const achado = await banco(`${REST("atendimento")}?select=id&id=eq.${aid}&limit=1`, { headers: cabecalhos(tok) });
    if (!Array.isArray(achado) || !achado[0]) return res.status(404).json({ erro: "Atendimento não encontrado." });

    const caminho = `${aid}/${Date.now()}-${sufixo()}.${ext}`;
    await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
      method: "POST",
      headers: hArquivo({ "Content-Type": tipo, "Cache-Control": "3600", "x-upsert": "false" }),
      body: buf,
    });

    let linha;
    try {
      const r = await banco(REST("anexo"), {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({
          atendimento_id: aid, caminho, tipo, bytes: buf.length,
          nome: String(corpo.nome || "").slice(0, 200) || null,
          // "doc:<item>" é o anexo de um item do check list de
          // documentações (0027): o rótulo é o código do item, e a lista
          // deles vive no api/checklist.js, não aqui.
          rotulo: /^doc:[a-z_]{2,40}$/.test(String(corpo.rotulo || "")) ? corpo.rotulo
            : ROTULOS.indexOf(String(corpo.rotulo || "")) >= 0 ? corpo.rotulo : "Outro",
        }),
      });
      linha = Array.isArray(r) ? r[0] : r;
    } catch (e) {
      // Linha falhou depois do upload: o arquivo não pode ficar órfão.
      await apagarDoc(caminho);
      throw e;
    }

    // CRLV anexado depois da venda: vai para o lojista na hora (05/11/2026).
    let crlv = null;
    if (/crlv/i.test(String((linha && linha.rotulo) || ""))) {
      try { crlv = await require("./checklist.js").crlvPendente(req, tok, aid); } catch (e) {}
    }
    const urls = await assinarDoc([caminho]);
    return res.status(201).json({ ok: true, anexo: { ...linha, url: urls[caminho] || null }, crlv });
  }

  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const achado = await banco(`${REST("anexo")}?select=caminho&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
    const alvo = Array.isArray(achado) && achado[0] ? achado[0].caminho : null;
    if (!alvo) return res.status(404).json({ erro: "Anexo não encontrado." });
    // Arquivo primeiro, linha depois: assim repetir a chamada converge.
    await apagarDoc(alvo);
    await banco(`${REST("anexo")}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos(tok) });
    return res.status(200).json({ ok: true });
  }

  /* TROCAR O TIPO DE UM ANEXO (04/11/2026). As CNHs do MGX1133 subiram
   * como "Outro" no fechamento e ficaram fora dos itens CNH do check
   * list: reenviar o arquivo só para trocar a etiqueta seria atrito à
   * toa. Só a linha muda, pelo token de quem pede — o arquivo não. */
  if (req.method === "PATCH") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    let c = req.body;
    if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
    if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
    const rotulo = String((c && c.rotulo) || "").trim().slice(0, 80);
    if (!rotulo) return res.status(400).json({ erro: "Diga o novo tipo." });
    const r = await banco(`${REST("anexo")}?id=eq.${id}`, {
      method: "PATCH", headers: json(tok, { Prefer: "return=representation" }), body: JSON.stringify({ rotulo }),
    });
    if (!Array.isArray(r) || !r.length) return res.status(404).json({ erro: "Anexo não encontrado." });
    let crlv = null;
    if (/crlv/i.test(rotulo) && r[0].atendimento_id) {
      try { crlv = await require("./checklist.js").crlvPendente(req, tok, r[0].atendimento_id); } catch (e) {}
    }
    return res.status(200).json({ ok: true, anexo: r[0], crlv });
  }

  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
}

/* OS DOCUMENTOS DO COLABORADOR (0079): RG/CNH, comprovante, o contrato
 * de prestação de serviços. Mesmo bucket privado e mesma ordem dos anexos
 * do negócio (decisão 9): a consulta pelo token de quem pede vem antes de
 * tocar no arquivo, e só o financeiro e o gerente passam por ela. */
/* OS PAPÉIS DA EMPRESA (0137): contrato social, cartão CNPJ, alvará, certidões. Mesma ordem dos
 * anexos do colaborador (decisão 9): a LEITURA vai pelo token (a RLS só devolve a linha ao gerente e ao
 * financeiro) e só então a chave assina o link; a gravação sobe o arquivo e a linha entra pelo token
 * — se a RLS recusar (não é gerente), o arquivo é apagado. */
const ROTULOS_EMPRESA = ["Contrato social", "Cartão CNPJ", "Alvará", "Inscrição estadual", "Certidão negativa", "Procuração", "Documento do sócio", "Outro"];
async function anexosEmpresa(req, res, tok) {
  const assinar = async (caminhos) => {
    if (!caminhos.length) return {};
    const r = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}`, {
      method: "POST", headers: jsonArquivo(), body: JSON.stringify({ expiresIn: VALIDADE, paths: caminhos }),
    });
    const mapa = {};
    (Array.isArray(r) ? r : []).forEach((x) => {
      const a = x && (x.signedURL || x.signedUrl);
      if (a) mapa[x.path] = a.charAt(0) === "/" ? `${STORAGE()}${a}` : a;
    });
    return mapa;
  };
  if (req.method === "GET") {
    const linhas = await banco(`${REST("empresa_anexo")}?select=*&order=criado_em.desc`, { headers: cabecalhos(tok) });
    const lista = Array.isArray(linhas) ? linhas : [];
    const urls = await assinar(lista.map((x) => x.caminho));
    return res.status(200).json({ anexos: lista.map((x) => ({ ...x, url: urls[x.caminho] || null })), rotulos: ROTULOS_EMPRESA });
  }
  if (req.method === "POST") {
    let corpo = req.body;
    if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
    if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
    if (!corpo || typeof corpo !== "object") return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const tipo = String(corpo.tipo || "");
    const ext = TIPOS_DOC[tipo];
    if (!ext) return res.status(415).json({ erro: "Só PDF, JPEG, PNG ou WEBP." });
    let bruto = String(corpo.dados || "").trim();
    const virgula = bruto.indexOf(",");
    if (bruto.slice(0, 5) === "data:" && virgula > 0) bruto = bruto.slice(virgula + 1);
    bruto = bruto.replace(/\s/g, "");
    if (!bruto || !/^[A-Za-z0-9+/]+={0,2}$/.test(bruto)) return res.status(400).json({ erro: "Arquivo vazio ou fora do formato." });
    const buf = Buffer.from(bruto, "base64");
    if (!buf.length) return res.status(400).json({ erro: "Arquivo vazio." });
    if (buf.length > MAX_DOC) return res.status(413).json({ erro: "Arquivo maior que 10 MB." });
    const caminho = `empresa/${Date.now()}-${sufixo()}.${ext}`;
    await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
      method: "POST", headers: hArquivo({ "Content-Type": tipo, "Cache-Control": "3600", "x-upsert": "false" }), body: buf,
    });
    let linha;
    try {
      const validade = /^\d{4}-\d{2}-\d{2}$/.test(String(corpo.validade || "")) ? corpo.validade : null;
      const r = await banco(REST("empresa_anexo"), {
        method: "POST", headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({ caminho, tipo, bytes: buf.length, validade,
          nome: String(corpo.nome || "").slice(0, 200) || null,
          rotulo: ROTULOS_EMPRESA.indexOf(String(corpo.rotulo || "")) >= 0 ? corpo.rotulo : "Outro" }),
      });
      linha = Array.isArray(r) ? r[0] : r;
      if (!linha) throw Object.assign(new Error("Só o gerente anexa documentos da empresa."), { status: 403 });
    } catch (e) { await apagarDoc(caminho); throw e; }
    const urls = await assinar([caminho]);
    return res.status(201).json({ ok: true, anexo: { ...linha, url: urls[caminho] || null } });
  }
  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const achado = await banco(`${REST("empresa_anexo")}?select=caminho&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
    const alvo = Array.isArray(achado) && achado[0] ? achado[0].caminho : null;
    if (!alvo) return res.status(404).json({ erro: "Documento não encontrado." });
    const apagou = await banco(`${REST("empresa_anexo")}?id=eq.${id}`, { method: "DELETE", headers: json(tok, { Prefer: "return=representation" }) });
    if (!(Array.isArray(apagou) && apagou.length)) return res.status(403).json({ erro: "Só o gerente apaga documentos da empresa." });
    await apagarDoc(alvo);
    return res.status(200).json({ ok: true });
  }
  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ erro: "Use GET, POST ou DELETE." });
}

const ROTULOS_COLAB = ["Documento (RG/CNH)", "CPF", "Comprovante de residência", "Contrato de prestação de serviços", "Distrato / desligamento", "Outro"];
async function anexosColaborador(req, res, tok) {
  const assinar = async (caminhos) => {
    if (!caminhos.length) return {};
    const r = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}`, {
      method: "POST", headers: jsonArquivo(), body: JSON.stringify({ expiresIn: VALIDADE, paths: caminhos }),
    });
    const mapa = {};
    (Array.isArray(r) ? r : []).forEach((x) => {
      const a = x && (x.signedURL || x.signedUrl);
      if (a) mapa[x.path] = a.charAt(0) === "/" ? `${STORAGE()}${a}` : a;
    });
    return mapa;
  };
  const daFicha = async (cid) => {
    const r = await banco(`${REST("colaborador")}?select=id&id=eq.${cid}&limit=1`, { headers: cabecalhos(tok) });
    return Array.isArray(r) && r[0];
  };

  if (req.method === "GET") {
    const cid = String(req.query.colaborador_id || "");
    if (!RX_UUID.test(cid)) return res.status(400).json({ erro: "colaborador_id inválido." });
    const linhas = await banco(`${REST("colaborador_anexo")}?select=*&colaborador_id=eq.${cid}&order=criado_em.desc`, { headers: cabecalhos(tok) });
    const lista = Array.isArray(linhas) ? linhas : [];
    const urls = await assinar(lista.map((x) => x.caminho));
    return res.status(200).json({ anexos: lista.map((x) => ({ ...x, url: urls[x.caminho] || null })), rotulos: ROTULOS_COLAB });
  }

  if (req.method === "POST") {
    let corpo = req.body;
    if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
    if (!corpo || typeof corpo !== "object") return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
    const cid = String(corpo.colaborador_id || "");
    if (!RX_UUID.test(cid)) return res.status(400).json({ erro: "colaborador_id inválido." });
    const tipo = String(corpo.tipo || "");
    const ext = TIPOS_DOC[tipo];
    if (!ext) return res.status(415).json({ erro: "Só PDF, JPEG, PNG ou WEBP." });
    let bruto = String(corpo.dados || "").trim();
    const virgula = bruto.indexOf(",");
    if (bruto.slice(0, 5) === "data:" && virgula > 0) bruto = bruto.slice(virgula + 1);
    bruto = bruto.replace(/\s/g, "");
    if (!bruto || !/^[A-Za-z0-9+/]+={0,2}$/.test(bruto)) return res.status(400).json({ erro: "Arquivo vazio ou fora do formato." });
    const buf = Buffer.from(bruto, "base64");
    if (!buf.length) return res.status(400).json({ erro: "Arquivo vazio." });
    if (buf.length > MAX_DOC) return res.status(413).json({ erro: "Arquivo maior que 10 MB." });
    if (!(await daFicha(cid))) return res.status(404).json({ erro: "Ficha não encontrada — ou você não tem acesso a ela." });

    const caminho = `equipe/${cid}/${Date.now()}-${sufixo()}.${ext}`;
    await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
      method: "POST", headers: hArquivo({ "Content-Type": tipo, "Cache-Control": "3600", "x-upsert": "false" }), body: buf,
    });
    let linha;
    try {
      const r = await banco(REST("colaborador_anexo"), {
        method: "POST", headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({
          colaborador_id: cid, caminho, tipo, bytes: buf.length,
          nome: String(corpo.nome || "").slice(0, 200) || null,
          rotulo: ROTULOS_COLAB.indexOf(String(corpo.rotulo || "")) >= 0 ? corpo.rotulo : "Outro",
        }),
      });
      linha = Array.isArray(r) ? r[0] : r;
      if (!linha) throw new Error("O banco recusou o anexo.");
    } catch (e) { await apagarDoc(caminho); throw e; }
    const urls = await assinar([caminho]);
    return res.status(201).json({ ok: true, anexo: { ...linha, url: urls[caminho] || null } });
  }

  if (req.method === "DELETE") {
    const id = String(req.query.id || "");
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });
    const achado = await banco(`${REST("colaborador_anexo")}?select=caminho&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
    const alvo = Array.isArray(achado) && achado[0] ? achado[0].caminho : null;
    if (!alvo) return res.status(404).json({ erro: "Anexo não encontrado." });
    await apagarDoc(alvo);
    await banco(`${REST("colaborador_anexo")}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos(tok) });
    return res.status(200).json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ erro: "Use GET, POST ou DELETE." });
}

async function apagarDoc(caminho) {
  try {
    await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
      method: "DELETE", headers: hArquivo(),
    });
  } catch (e) { /* já não existe é sucesso */ }
}

/* O ANEXO DO LOJISTA, QUE CHEGA SEM LOGIN.
 *
 * CNH, comprovante de residência e a ATPV já preenchida. O lojista não
 * tem conta aqui, então este é o segundo caminho público do sistema —
 * o primeiro é o assinador (decisão 42).
 *
 * **Mora neste arquivo porque é onde a chave de serviço já está**
 * (decisão 9): escrever no Storage exige ela, e espalhá-la seria
 * desfazer aquela decisão. A LINHA no banco, essa não usa a chave:
 * vai pela função estreita `dut_anexar()` da 0057, que só grava anexo
 * e só para quem apresentar o token daquele pedido.
 *
 * **O que segura uma rota pública que escreve arquivo**, em ordem:
 * o token do pedido (32 bytes, guardado em hash), a janela de duas
 * horas, o teto de 10 MB e os quatro tipos que o bucket aceita. Sem o
 * token não se sobe nada — não é uma porta aberta para o bucket.
 */
async function dutAnexo(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "método" }); }
  const id = String(req.query.id || "");
  const token = String(req.query.token || "");
  if (!RX_UUID.test(id) || !token) return res.status(400).json({ erro: "pedido inválido" });

  /* O ARQUIVO VEM EM BASE64 DENTRO DE JSON, como o anexo que já
   * existe — e não como corpo binário cru. **No Cloudflare o corpo é
   * lido como TEXTO** pelo adaptador do Worker, então binário cru
   * chegaria corrompido sem erro nenhum: o arquivo subiria quebrado e
   * só se descobriria ao abrir o PDF. */
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  if (!c || typeof c !== "object") return res.status(400).json({ erro: "Envio inválido." });

  const tipo = String(c.tipo || "").split(";")[0].trim();
  const ext = TIPOS_DOC[tipo];
  if (!ext) return res.status(415).json({ erro: "Aceito PDF, JPG, PNG ou WebP." });

  let cru = String(c.arquivo_base64 || "").trim();
  if (cru.slice(0, 5) === "data:") { const v = cru.indexOf(","); cru = v < 0 ? "" : cru.slice(v + 1); }
  cru = cru.replace(/\s/g, "");
  if (!cru || !/^[A-Za-z0-9+/]+={0,2}$/.test(cru)) return res.status(400).json({ erro: "Arquivo inválido." });
  const buf = Buffer.from(cru, "base64");
  if (!buf.length) return res.status(400).json({ erro: "Arquivo vazio." });
  if (buf.length > MAX_DOC) return res.status(413).json({ erro: "O arquivo passa de 10 MB." });

  const rotulo = String(c.rotulo || "Outro").slice(0, 60);
  const nome = String(c.nome || `arquivo.${ext}`).slice(0, 120);
  const caminho = `dut/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // `arquivos()` LANÇA quando o Storage recusa; não devolve `ok`.
  try {
    await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
      method: "POST",
      headers: hArquivo({ "Content-Type": tipo, "Cache-Control": "3600", "x-upsert": "false" }),
      body: buf,
    });
  } catch (e) { return res.status(502).json({ erro: "Não consegui guardar o arquivo." }); }

  const r = await fetch(`${URL_BASE}/rest/v1/rpc/dut_anexar`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_id: id, p_token_hash: require("crypto").createHash("sha256").update(token).digest("hex"),
      p_caminho: caminho, p_nome: nome, p_tipo: tipo, p_bytes: buf.length, p_rotulo: rotulo,
    }),
  });
  const ok = await r.json().catch(() => false);
  if (!r.ok || ok !== true) {
    /* NADA FICA ÓRFÃO: se a linha não entrou, o arquivo sai do bucket
     * antes de devolver o erro — a mesma ordem da decisão 6. Sem isso,
     * token errado deixaria lixo no Storage que ninguém sabe apagar. */
    try {
      await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, { method: "DELETE", headers: hArquivo() });
    } catch (e) {}
    return res.status(403).json({ erro: "Este envio não está mais válido." });
  }
  return res.status(200).json({ ok: true });
}

/* ===================== A MÍDIA DO WHATSAPP =====================
 *
 * Foto, áudio e PDF que chegam na conversa. Até 06/10/2026 o sistema
 * guardava só o registro de que veio algo — e o Derek bateu nisso três
 * vezes: CRLV de cliente e áudio de negociação ficavam fora do
 * alcance de quem precisa deles.
 *
 * **Isto é a exceção que a decisão 9 pedia para não ser aberta
 * sozinha, e o Derek abriu.** Guardar arquivo exige a
 * `SUPABASE_SERVICE_KEY` no Storage — e é por isso que o endpoint
 * mora NESTE arquivo, que já é o único lugar com ela. Levá-lo para
 * outro seria espalhar a chave, que é o que aquela decisão evita.
 *
 * **São dois caminhos e só um usa a chave para entrar:**
 *
 *  - a PONTE sobe o arquivo (sem login, pelo `PONTE_SEGREDO`), e a
 *    chave só toca o Storage — a linha da mensagem é da ponte, pela
 *    função estreita da 0055;
 *  - a EQUIPE pede o link, e aí a ordem é a da decisão 9: lê-se a
 *    mensagem **com o token do usuário** e só depois se assina. Se a
 *    RLS não devolver a linha, a função para antes de tocar no
 *    arquivo.
 */
const PASTA_WA = "wa";

/* O WhatsApp manda mais tipo que o DUT: áudio de voz, vídeo e
 * figurinha. Mapa SEPARADO de propósito — o anexo do lojista continua
 * aceitando só documento e imagem, e misturar os dois abriria por
 * acidente o que não foi decidido. */
const TIPOS_WA = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf",
  "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/aac": "aac", "audio/amr": "amr", "audio/wav": "wav",
  "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
};

async function waMidia(req, res) {
  const segredo = process.env.PONTE_SEGREDO || "";
  if (!segredo || req.headers["x-ponte-segredo"] !== segredo) {
    return res.status(401).json({ ok: false, erro: "sem permissão" });
  }
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false }); }

  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  if (!c || typeof c !== "object") return res.status(400).json({ ok: false, erro: "envio inválido" });

  const tipo = String(c.tipo || "").split(";")[0].trim();
  /* O bucket da 0008 aceita quatro tipos; o WhatsApp manda áudio
   * (ogg/opus), vídeo e figurinha também. O que ele não aceita é
   * recusado AQUI, com nome — em vez de voltar erro cru do Storage no
   * meio de uma conversa. */
  const ext = TIPOS_WA[tipo];
  if (!ext) return res.status(200).json({ ok: true, chave: "", erro: `tipo não guardado: ${tipo || "desconhecido"}` });

  let cru = String(c.arquivo_base64 || "").trim();
  if (cru.slice(0, 5) === "data:") { const v = cru.indexOf(","); cru = v < 0 ? "" : cru.slice(v + 1); }
  cru = cru.replace(/\s/g, "");
  if (!cru || !/^[A-Za-z0-9+/]+={0,2}$/.test(cru)) return res.status(400).json({ ok: false, erro: "arquivo inválido" });
  const buf = Buffer.from(cru, "base64");
  if (!buf.length) return res.status(400).json({ ok: false, erro: "arquivo vazio" });
  if (buf.length > MAX_DOC) return res.status(200).json({ ok: true, chave: "", erro: "passa de 10 MB" });

  const canal = String(c.canal || "x").replace(/[^\w-]/g, "").slice(0, 40);
  const caminho = `${PASTA_WA}/${canal}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
      method: "POST",
      headers: hArquivo({ "Content-Type": tipo, "Cache-Control": "3600", "x-upsert": "false" }),
      body: buf,
    });
  } catch (e) {
    // Falhar aqui NÃO pode derrubar a mensagem: o texto e o registro
    // valem mesmo sem o arquivo, e a ponte reentregaria em laço.
    return res.status(200).json({ ok: true, chave: "", erro: "não consegui guardar" });
  }
  return res.status(200).json({ ok: true, chave: caminho, bytes: buf.length });
}

/* MANDAR ARQUIVO PELA CAIXA DE CONVERSAS (03/11/2026, o Derek: "o whats do
 * ADM … mandar comprovantes, CRLV, tudo que é importante nos grupos").
 *
 * A ordem é a da decisão 9: a conversa é lida com o TOKEN de quem manda
 * (sem a RLS devolvendo, nada sai); só depois a chave de serviço guarda o
 * arquivo e assina um link de uma hora, que a ponte baixa para mandar. O
 * arquivo fica na mesma pasta das mídias que chegam (`wa/`), então abre na
 * conversa pelo mesmo `wa-arquivo`. Os tipos são os que o bucket aceita
 * (TIPOS_WA); Word e Excel não vão — mandar em PDF. */
async function waEnvio(req, res, tok) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  if (!c || typeof c !== "object") return res.status(400).json({ erro: "Envio inválido." });
  const cid = String(c.conversa_id || "");
  if (!RX_UUID.test(cid)) return res.status(400).json({ erro: "Conversa inválida." });
  const tipo = String(c.tipo || "").split(";")[0].trim().toLowerCase();
  const ext = TIPOS_WA[tipo];
  if (!ext) return res.status(415).json({ erro: `Esse tipo de arquivo não vai pelo sistema (${tipo || "desconhecido"}). Mande PDF, foto, áudio ou vídeo.` });
  let cru = String(c.arquivo_base64 || "").trim();
  if (cru.slice(0, 5) === "data:") { const v = cru.indexOf(","); cru = v < 0 ? "" : cru.slice(v + 1); }
  cru = cru.replace(/\s/g, "");
  if (!cru || !/^[A-Za-z0-9+/]+={0,2}$/.test(cru)) return res.status(400).json({ erro: "Arquivo inválido." });
  const buf = Buffer.from(cru, "base64");
  if (!buf.length) return res.status(400).json({ erro: "Arquivo vazio." });
  if (buf.length > MAX_DOC) return res.status(413).json({ erro: "O arquivo passa de 10 MB." });
  const nome = String(c.nome || `arquivo.${ext}`).replace(/[\r\n]/g, " ").slice(0, 120);
  const legenda = String(c.legenda || "").slice(0, 1000);

  const cv = ((await banco(`${REST("wa_conversa")}?select=id,telefone,grupo,wa_canal(slug,ativo)&id=eq.${cid}`, { headers: cabecalhos(tok) })) || [])[0];
  const ca = cv && (Array.isArray(cv.wa_canal) ? cv.wa_canal[0] : cv.wa_canal);
  if (!cv || !ca) return res.status(404).json({ erro: "Conversa não encontrada." });
  if (ca.ativo === false) return res.status(409).json({ erro: "Este número está desativado." });
  const segredo = process.env.PONTE_SEGREDO || "";
  const base = process.env.PONTE_URL || "";
  if (!segredo || (!req.ponte && !base)) return res.status(503).json({ erro: "A ponte do WhatsApp não está configurada." });

  const caminho = `${PASTA_WA}/${String(ca.slug).replace(/[^\w-]/g, "")}/envio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
    method: "POST", headers: hArquivo({ "Content-Type": tipo, "Cache-Control": "3600", "x-upsert": "false" }), body: buf,
  });
  const assinado = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}/${paraURL(caminho)}`, {
    method: "POST", headers: hArquivo({ "Content-Type": "application/json" }), body: JSON.stringify({ expiresIn: 3600 }),
  });
  const link = assinado && assinado.signedURL ? `${STORAGE()}${assinado.signedURL}` : "";
  if (!link) return res.status(502).json({ erro: "Não consegui preparar o arquivo." });

  // Áudio de voz é ogg; outro áudio (mp3, m4a) vai como documento, que
  // abre em qualquer celular — mandado como "voz" ele não tocaria.
  const qual = tipo.indexOf("image/") === 0 ? "image" : tipo.indexOf("video/") === 0 ? "video" : tipo === "audio/ogg" ? "audio" : "document";
  const conteudo = qual === "document"
    ? { type: "document", document: { link, filename: nome, mime_type: tipo, caption: legenda || undefined } }
    : qual === "audio" ? { type: "audio", audio: { link } }
    : { type: qual, [qual]: { link, caption: legenda || undefined } };
  let d = {};
  try {
    const alvo = `${base || "https://ponte"}/enviar?canal=${encodeURIComponent(ca.slug)}`;
    const pedido = {
      method: "POST", signal: AbortSignal.timeout(60000),
      headers: { "x-ponte-segredo": segredo, "Content-Type": "application/json" },
      body: JSON.stringify({ para: cv.telefone, conteudo }),
    };
    const r = req.ponte ? await req.ponte.fetch(alvo, pedido) : await fetch(alvo, pedido);
    d = await r.json().catch(() => ({ ok: false, erro: `a ponte respondeu ${r.status}` }));
  } catch (e) { d = { ok: false, erro: "a ponte não respondeu" }; }
  if (!d || !d.ok) return res.status(502).json({ erro: `Não foi enviado: ${limpar((d && d.erro) || "a ponte não mandou")}.` });

  // Gravado como mensagem da loja, com o arquivo — a ponte não ecoa o que
  // ela mesma manda.
  const agora = Date.now();
  const anexo = { tipo: qual === "document" ? "document" : qual, mime: tipo, nome, legenda, voz: qual === "audio", chave: caminho };
  const wa = String(d.id || `erp-${agora}`);
  const comum = { p_canal: ca.slug, p_wa_id: wa, p_eco: true, p_tipo: "midia", p_texto: legenda, p_anexo: anexo, p_quando: new Date(agora).toISOString(), p_segredo: process.env.IA_SEGREDO || "" };
  let msgId = null;
  try {
    if (cv.grupo) {
      msgId = await banco(`${URL_BASE}/rest/v1/rpc/wa_receber_grupo`, { method: "POST", headers: json(tok),
        body: JSON.stringify({ ...comum, p_grupo: cv.telefone, p_nome: "", p_autor: "" }) });
    } else {
      msgId = await banco(`${URL_BASE}/rest/v1/rpc/wa_receber`, { method: "POST", headers: json(tok),
        body: JSON.stringify({ ...comum, p_telefone: cv.telefone, p_nome: "", p_anuncio: null }) });
    }
  } catch (e) { return res.status(200).json({ ok: true, registrada: false }); }
  // Quem mandou o arquivo (0112): o login de quem estava na caixa.
  try {
    const meio = String(tok).replace(/^Bearer\s+/, "").split(".")[1];
    const eu = meio ? JSON.parse(Buffer.from(meio.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).sub : null;
    if (eu && typeof msgId === "string" && RX_UUID.test(msgId)) {
      const p = (await banco(`${REST("perfil")}?select=nome&id=eq.${eu}&limit=1`, { headers: cabecalhos(tok) }) || [])[0];
      await banco(`${REST("wa_mensagem")}?id=eq.${msgId}`, { method: "PATCH", headers: json(tok),
        body: JSON.stringify({ enviado_por: eu, enviado_por_nome: (p && p.nome) || null }) });
    }
  } catch (e) {}
  return res.status(200).json({ ok: true, registrada: true });
}

/* ENCAMINHAR (09/11/2026, o administrativo: "no whats do ADM, no sistema,
 * precisamos das opções de responder e encaminhar"). O CRLV que o lojista
 * mandou vai para o grupo do despachante sem baixar e subir de novo.
 *
 * Mora aqui pelo mesmo motivo do `waEnvio`: arquivo guardado só se assina
 * com a chave de serviço, e ela fica neste arquivo (decisão 9). A ordem é a
 * mesma: a mensagem e cada conversa de destino são lidas com o TOKEN de
 * quem encaminha — sem a RLS devolver, nada sai —, e só então a chave
 * assina o link que a ponte baixa. O arquivo não é copiado: a mensagem
 * nova aponta para a mesma chave no bucket. Cada destino sai pelo número
 * da conversa de destino. */
async function waEncaminhar(req, res, tok) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ erro: "Use POST." }); }
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  if (!c || typeof c !== "object") return res.status(400).json({ erro: "Envio inválido." });
  const mid = String(c.mensagem_id || "");
  if (!RX_UUID.test(mid)) return res.status(400).json({ erro: "Mensagem inválida." });
  const destinos = [...new Set((Array.isArray(c.conversas) ? c.conversas : []).map(String).filter((x) => RX_UUID.test(x)))];
  if (!destinos.length) return res.status(400).json({ erro: "Escolha para quem encaminhar." });
  if (destinos.length > 5) return res.status(400).json({ erro: "No máximo 5 conversas de cada vez." });

  const m = ((await banco(`${REST("wa_mensagem")}?select=id,tipo,texto,anexo,conversa_id&id=eq.${mid}`, { headers: cabecalhos(tok) })) || [])[0];
  if (!m) return res.status(404).json({ erro: "Mensagem não encontrada." });
  const an = m.anexo && typeof m.anexo === "object" ? m.anexo : {};
  const texto = String(m.texto || "").trim();
  const ehArquivo = m.tipo === "midia";
  if (ehArquivo && (!an.chave || String(an.chave).slice(0, PASTA_WA.length + 1) !== `${PASTA_WA}/`)) {
    return res.status(409).json({ erro: "Este arquivo chegou antes de o sistema guardar arquivos — encaminhe pelo celular." });
  }
  if (!ehArquivo && !texto) return res.status(409).json({ erro: "Não há o que encaminhar nesta mensagem." });

  const segredo = process.env.PONTE_SEGREDO || "";
  const base = process.env.PONTE_URL || "";
  if (!segredo || (!req.ponte && !base)) return res.status(503).json({ erro: "A ponte do WhatsApp não está configurada." });

  let conteudo = null, anexo = null;
  if (ehArquivo) {
    const assinado = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}/${paraURL(an.chave)}`, {
      method: "POST", headers: hArquivo({ "Content-Type": "application/json" }), body: JSON.stringify({ expiresIn: 3600 }),
    });
    const link = assinado && assinado.signedURL ? `${STORAGE()}${assinado.signedURL}` : "";
    if (!link) return res.status(502).json({ erro: "Não consegui preparar o arquivo." });
    const tipo = String(an.mime || "").split(";")[0];
    const legenda = String(an.legenda || texto || "").slice(0, 1000);
    const qual = an.tipo === "image" ? "image" : an.tipo === "video" ? "video" : an.tipo === "audio" && tipo === "audio/ogg" ? "audio" : "document";
    conteudo = qual === "document"
      ? { type: "document", document: { link, filename: an.nome || `arquivo.${TIPOS_WA[tipo] || "bin"}`, mime_type: tipo || "application/octet-stream", caption: legenda || undefined } }
      : qual === "audio" ? { type: "audio", audio: { link } }
      : { type: qual, [qual]: { link, caption: legenda || undefined } };
    anexo = { ...an, legenda, encaminhada: true };
  } else {
    conteudo = { type: "text", text: { body: texto.slice(0, 4000) } };
    anexo = { encaminhada: true };
  }
  conteudo.encaminhada = true;

  // Quem encaminhou (0112): o login de quem estava na caixa.
  let eu = null, euNome = null;
  try {
    const meio = String(tok).replace(/^Bearer\s+/, "").split(".")[1];
    eu = meio ? JSON.parse(Buffer.from(meio.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).sub : null;
    if (eu) euNome = ((await banco(`${REST("perfil")}?select=nome&id=eq.${eu}&limit=1`, { headers: cabecalhos(tok) }) || [])[0] || {}).nome || null;
  } catch (e) {}

  const resultado = [];
  for (const cid of destinos) {
    const cv = ((await banco(`${REST("wa_conversa")}?select=id,nome,telefone,grupo,wa_canal(slug,ativo)&id=eq.${cid}`, { headers: cabecalhos(tok) })) || [])[0];
    const ca = cv && (Array.isArray(cv.wa_canal) ? cv.wa_canal[0] : cv.wa_canal);
    if (!cv || !ca) { resultado.push({ conversa_id: cid, ok: false, erro: "conversa não encontrada" }); continue; }
    if (ca.ativo === false) { resultado.push({ conversa_id: cid, ok: false, erro: "número desativado" }); continue; }
    let d = {};
    try {
      const alvo = `${base || "https://ponte"}/enviar?canal=${encodeURIComponent(ca.slug)}`;
      const pedido = {
        method: "POST", signal: AbortSignal.timeout(60000),
        headers: { "x-ponte-segredo": segredo, "Content-Type": "application/json" },
        body: JSON.stringify({ para: cv.telefone, conteudo }),
      };
      const r = req.ponte ? await req.ponte.fetch(alvo, pedido) : await fetch(alvo, pedido);
      d = await r.json().catch(() => ({ ok: false, erro: `a ponte respondeu ${r.status}` }));
    } catch (e) { d = { ok: false, erro: "a ponte não respondeu" }; }
    if (!d || !d.ok) { resultado.push({ conversa_id: cid, ok: false, erro: limpar((d && d.erro) || "a ponte não mandou") }); continue; }
    const agora = Date.now();
    const comum = { p_canal: ca.slug, p_wa_id: String(d.id || `erp-${agora}`), p_eco: true, p_tipo: ehArquivo ? "midia" : "texto",
      p_texto: ehArquivo ? anexo.legenda : texto, p_anexo: anexo, p_quando: new Date(agora).toISOString(), p_segredo: process.env.IA_SEGREDO || "" };
    let msgId = null;
    try {
      msgId = cv.grupo
        ? await banco(`${URL_BASE}/rest/v1/rpc/wa_receber_grupo`, { method: "POST", headers: json(tok), body: JSON.stringify({ ...comum, p_grupo: cv.telefone, p_nome: "", p_autor: "" }) })
        : await banco(`${URL_BASE}/rest/v1/rpc/wa_receber`, { method: "POST", headers: json(tok), body: JSON.stringify({ ...comum, p_telefone: cv.telefone, p_nome: "", p_anuncio: null }) });
      if (eu && typeof msgId === "string" && RX_UUID.test(msgId)) {
        await banco(`${REST("wa_mensagem")}?id=eq.${msgId}`, { method: "PATCH", headers: json(tok),
          body: JSON.stringify({ enviado_por: eu, enviado_por_nome: euNome }) });
      }
    } catch (e) {}
    resultado.push({ conversa_id: cid, ok: true, nome: cv.nome || cv.telefone, registrada: !!msgId });
  }
  const falhas = resultado.filter((x) => !x.ok);
  return res.status(falhas.length === resultado.length ? 502 : 200).json({
    ok: falhas.length < resultado.length, resultado,
    ...(falhas.length === resultado.length ? { erro: `Não foi encaminhada: ${falhas[0].erro}.` } : {}),
  });
}

async function waArquivo(req, res, tok) {
  const id = String(req.query.id || "");
  if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido" });

  /* A ORDEM É A DA DECISÃO 9: a mensagem é lida com o TOKEN DO
   * USUÁRIO, então é a RLS da 0054 que decide se aquela pessoa pode
   * ver aquela conversa. Só depois a chave de serviço assina o link.
   * Invertida, a chave viraria uma porta para o bucket inteiro. */
  const r = await fetch(`${URL_BASE}/rest/v1/wa_mensagem?select=anexo&id=eq.${id}`,
    { headers: { apikey: ANON, Authorization: tok } });
  if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler a mensagem." });
  const linha = (await r.json().catch(() => []))[0];
  const chave = linha && linha.anexo && linha.anexo.chave;
  if (!chave || String(chave).slice(0, PASTA_WA.length + 1) !== `${PASTA_WA}/`) {
    return res.status(404).json({ erro: "Esta mensagem não tem arquivo guardado." });
  }

  try {
    const d = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}/${paraURL(chave)}`, {
      method: "POST", headers: hArquivo({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const url = d && d.signedURL ? `${STORAGE()}${d.signedURL}` : null;
    if (!url) return res.status(502).json({ erro: "Não consegui assinar o link." });
    return res.status(200).json({ url });
  } catch (e) { return res.status(502).json({ erro: "Não consegui assinar o link." }); }
}

/* O ARQUIVO QUE O LOJISTA MANDOU COM O DUT (13/10/2026). O pedido
 * guardava CNH e comprovante desde a 0057, e a tela mostrava o nome de
 * cada um como etiqueta — sem link nenhum. O Derek: "não tá dando pra
 * abrir os arquivos anexados".
 *
 * Mesma ordem do `waArquivo`: a linha é lida com o TOKEN DO USUÁRIO (a
 * RLS da 0057 abre `dut_anexo` à equipe) e só então a chave assina. E
 * o caminho tem que estar na pasta `dut/` — o bucket é o dos documentos
 * do veículo, e um caminho de outra pasta não se assina por aqui. */
async function dutArquivo(req, res, tok) {
  const id = String(req.query.id || "");
  if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido" });
  const r = await fetch(`${URL_BASE}/rest/v1/dut_anexo?select=caminho&id=eq.${id}`,
    { headers: { apikey: ANON, Authorization: tok } });
  if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler o anexo." });
  const linha = (await r.json().catch(() => []))[0];
  const chave = linha && linha.caminho;
  if (!chave || String(chave).slice(0, 4) !== "dut/") return res.status(404).json({ erro: "Este anexo não tem arquivo guardado." });
  try {
    const d = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}/${paraURL(chave)}`, {
      method: "POST", headers: hArquivo({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    const url = d && d.signedURL ? `${STORAGE()}${d.signedURL}` : null;
    if (!url) return res.status(502).json({ erro: "Não consegui assinar o link." });
    return res.status(200).json({ url });
  } catch (e) { return res.status(502).json({ erro: "Não consegui assinar o link." }); }
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !CHAVE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL, SUPABASE_ANON_KEY ou SUPABASE_SERVICE_KEY não configurados." });
  }

  // A ponte chega sem login, pelo segredo compartilhado.
  if (String(req.query.recurso || "") === "wa-midia") {
    try { return await waMidia(req, res); }
    catch (e) { return res.status(200).json({ ok: true, chave: "", erro: "falhou" }); }
  }

  // O lojista chega sem login: antes da checagem de sessão.
  if (String(req.query.recurso || "") === "dut-anexo") {
    try { return await dutAnexo(req, res); }
    catch (e) { return res.status(500).json({ erro: "Não consegui guardar o arquivo." }); }
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json(SEM_LOGIN);

  if (String(req.query.recurso || "") === "wa-envio") {
    try { return await waEnvio(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: limpar(e.message) || "Não consegui mandar o arquivo." }); }
  }

  if (String(req.query.recurso || "") === "wa-encaminhar") {
    try { return await waEncaminhar(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: limpar(e.message) || "Não consegui encaminhar." }); }
  }

  if (String(req.query.recurso || "") === "wa-arquivo") {
    try { return await waArquivo(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: "Não consegui abrir o arquivo." }); }
  }

  if (String(req.query.recurso || "") === "dut-arquivo") {
    try { return await dutArquivo(req, res, tok); }
    catch (e) { return res.status(502).json({ erro: "Não consegui abrir o arquivo." }); }
  }

  if (String(req.query.recurso || "") === "shinkai-venda") {
    try { return await shinkaiVenda(req, res, tok); }
    catch (e) { return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha ao mandar a venda ao Shinkai." }); }
  }

  if (String(req.query.recurso || "") === "shinkai") {
    try { return await shinkai(req, res, tok); }
    catch (e) { return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no envio ao Shinkai." }); }
  }

  if (String(req.query.recurso || "") === "empresa-anexo") {
    try { return await anexosEmpresa(req, res, tok); }
    catch (e) { return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no documento." }); }
  }
  if (String(req.query.recurso || "") === "colaborador-anexo") {
    try { return await anexosColaborador(req, res, tok); }
    catch (e) { return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no anexo." }); }
  }

  if (String(req.query.recurso || "") === "anexo") {
    try { return await anexos(req, res, tok); }
    catch (e) { return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha no anexo." }); }
  }

  try {
    /* ---------- GET: fotos do veículo, em ordem ---------- */
    /* A CAPA DE VÁRIOS CARROS de uma vez (05/11/2026, o Derek: "aparecer
     * a foto principal ao lado na linha" do Estoque). A capa é a menor
     * ordem (decisão 6). Uma consulta e uma assinatura para a lista
     * inteira, em vez de uma por carro. A leitura vai pelo token do
     * usuário antes de a chave tocar o Storage (decisão 9). */
    if (req.method === "GET" && req.query.capas) {
      const ids = String(req.query.capas).split(",").filter((x) => RX_UUID.test(x)).slice(0, 150);
      if (!ids.length) return res.status(200).json({ capas: {} });
      const linhas = await banco(
        `${REST("foto")}?select=veiculo_id,caminho,ordem&veiculo_id=in.(${ids.join(",")})&order=ordem.asc&limit=2000`,
        { headers: cabecalhos(tok) }) || [];
      const capa = {}, n = {};
      linhas.forEach((l) => { n[l.veiculo_id] = (n[l.veiculo_id] || 0) + 1; if (!capa[l.veiculo_id]) capa[l.veiculo_id] = l.caminho; });
      const links = await assinar(Object.values(capa));
      const out = {};
      Object.keys(capa).forEach((v) => { out[v] = { url: links[capa[v]] || null, fotos: n[v] }; });
      return res.status(200).json({ capas: out });
    }

    if (req.method === "GET") {
      const vid = String(req.query.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const linhas = await banco(
        `${REST("foto")}?select=id,caminho,ordem&veiculo_id=eq.${vid}&order=ordem.asc`,
        { headers: cabecalhos(tok) }
      ) || [];

      const links = await assinar(linhas.map((l) => l.caminho));
      return res.status(200).json({
        fotos: linhas.map((l) => ({ id: l.id, caminho: l.caminho, ordem: l.ordem, url: links[l.caminho] || null })),
      });
    }

    /* ---------- POST: sobe a imagem e grava a linha ---------- */
    if (req.method === "POST") {
      let corpo = req.body;
      if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
      if (!corpo || typeof corpo !== "object") {
        return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
      }

      const vid = String(corpo.veiculo_id || "");
      if (!RX_UUID.test(vid)) return res.status(400).json({ erro: "veiculo_id inválido." });

      const imagem = decodificar(corpo.imagem_base64);
      if (!imagem) return res.status(400).json({ erro: "Imagem vazia ou não é JPEG." });
      if (imagem.length > MAX_BYTES) return res.status(413).json({ erro: "Imagem grande demais." });

      // A placa vem do banco: é ela que nomeia a pasta, e a busca já
      // confirma que o veículo existe.
      const achado = await banco(`${REST("veiculo")}?select=placa&id=eq.${vid}&limit=1`, { headers: cabecalhos(tok) });
      const placa = Array.isArray(achado) && achado[0] ? achado[0].placa : null;
      if (!placa) return res.status(404).json({ erro: "Veículo não encontrado. Salve a ficha antes das fotos." });

      const ordem = Number.isFinite(Number(corpo.ordem)) ? Math.trunc(Number(corpo.ordem)) : 0;
      const medida = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.trunc(Number(v)) : null);
      const caminho = `${String(placa).replace(/[^A-Za-z0-9]/g, "")}/${Date.now()}-${sufixo()}.jpg`;

      /* A MESMA FOTO NÃO ENTRA DUAS VEZES (0116, 07/11/2026). O hash do
       * arquivo é a impressão digital: se este carro já tem esta foto, a
       * resposta é a que existe — nada sobe, nada se grava. Cobre o
       * celular que reenvia ao reabrir a tela, os dois aparelhos e o
       * mesmo arquivo escolhido duas vezes. Sem a coluna (antes da 0116),
       * segue como antes. */
      let hash = null;
      try {
        const d = await globalThis.crypto.subtle.digest("SHA-256", imagem);
        hash = Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
      } catch (e) { hash = null; }
      const jaExiste = async () => {
        if (!hash) return null;
        try {
          const r = await banco(`${REST("foto")}?select=id,caminho,ordem&veiculo_id=eq.${vid}&hash=eq.${hash}&limit=1`, { headers: cabecalhos(tok) });
          return Array.isArray(r) && r[0] ? r[0] : null;
        } catch (e) { return null; }
      };
      const devolver = async (x) => {
        const links = await assinar([x.caminho]);
        return res.status(200).json({ ok: true, repetida: true, id: x.id, caminho: x.caminho, ordem: x.ordem, url: links[x.caminho] || null });
      };
      const antes = await jaExiste();
      if (antes) return devolver(antes);

      await arquivos(`${STORAGE()}/object/${BUCKET}/${paraURL(caminho)}`, {
        method: "POST",
        headers: hArquivo({ "Content-Type": "image/jpeg", "Cache-Control": "3600", "x-upsert": "false" }),
        body: imagem,
      });

      /* A POSIÇÃO OCUPADA NÃO DERRUBA A FOTO (28/10/2026). A ordem vem da
       * tela (a posição na lista dela), e o índice único da 0002 recusa a
       * repetida — o que acontece com o celular e o computador no mesmo
       * carro, ou com a lista do aparelho desatualizada: a foto virava
       * "Falhou" com um erro de chave duplicada. Na recusa, ela vai para
       * depois da última; a capa não muda, porque só a posição 0 é capa
       * e quem pediu a 0 já a tem por outra foto. */
      const gravar = (o) => banco(REST("foto"), {
        method: "POST",
        headers: json(tok, { Prefer: "return=representation" }),
        body: JSON.stringify({
          veiculo_id: vid, caminho, ordem: o,
          largura: medida(corpo.largura), altura: medida(corpo.altura),
          bytes: imagem.length, ...(hash ? { hash } : {}),
        }),
      });
      let linha;
      try {
        let r;
        try { r = await gravar(ordem); }
        catch (e) {
          // Duas cópias da mesma foto chegando juntas: a segunda perde
          // para o índice do hash e devolve a primeira.
          if (/foto_hash_unico/i.test(String(e.message || ""))) {
            await apagarArquivo(caminho);
            const x = await jaExiste();
            if (x) return devolver(x);
            throw e;
          }
          if (!/duplicate|23505|foto_ordem_unica/i.test(String(e.message || ""))) throw e;
          const ult = await banco(`${REST("foto")}?select=ordem&veiculo_id=eq.${vid}&order=ordem.desc&limit=1`, { headers: cabecalhos(tok) });
          r = await gravar(Math.max(0, ((Array.isArray(ult) && ult[0] && ult[0].ordem) || 0) + 1));
        }
        linha = Array.isArray(r) ? r[0] : r;
      } catch (e) {
        // Linha não gravou: o arquivo não pode ficar órfão no bucket.
        await apagarArquivo(caminho);
        throw e;
      }

      const links = await assinar([caminho]);
      return res.status(201).json({
        ok: true,
        id: linha ? linha.id : null,
        caminho,
        ordem: linha && linha.ordem != null ? linha.ordem : ordem,
        url: links[caminho] || null,
      });
    }

    /* ---------- PATCH: reordenar / definir capa ---------- */
    if (req.method === "PATCH") {
      let corpo = req.body;
      if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
      if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
      /* CAPA EM UMA LINHA (28/10/2026). Com o teto subindo de 12 para 40
       * fotos, renumerar todas eram 80 idas ao banco por troca de capa —
       * além do teto de subrequisições do Worker. A capa é a menor ordem;
       * a escolhida passa a ser a menor menos um, e mais nada muda. */
      if (corpo && RX_UUID.test(String(corpo.capa || ""))) {
        const fid = String(corpo.capa);
        const f = (await banco(`${REST("foto")}?select=veiculo_id,ordem&id=eq.${fid}&limit=1`, { headers: cabecalhos(tok) }) || [])[0];
        if (!f) return res.status(404).json({ erro: "Foto não encontrada." });
        const menor = (await banco(`${REST("foto")}?select=ordem&veiculo_id=eq.${f.veiculo_id}&order=ordem.asc&limit=1`, { headers: cabecalhos(tok) }) || [])[0];
        if (menor && menor.ordem < f.ordem) {
          await banco(`${REST("foto")}?id=eq.${fid}`, { method: "PATCH", headers: json(tok), body: JSON.stringify({ ordem: menor.ordem - 1 }) });
        }
        return res.status(200).json({ ok: true });
      }

      const ordens = corpo && Array.isArray(corpo.ordens) ? corpo.ordens : null;
      if (!ordens || !ordens.length) return res.status(400).json({ erro: "Mande ordens: [{ id, ordem }]." });

      const alvos = [];
      for (const o of ordens) {
        const id = String((o && o.id) || "");
        if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id de foto inválido." });
        alvos.push({ id, ordem: Math.trunc(Number(o.ordem) || 0) });
      }

      // O índice único (veiculo_id, ordem) não é deferrable: trocar a
      // capa passando 2→0 esbarra em quem ainda está no 0. Por isso a
      // troca acontece em duas voltas — todo mundo estaciona no
      // negativo, que ninguém usa, e só depois assume a posição final.
      const mover = (id, ordem) => banco(`${REST("foto")}?id=eq.${id}`, {
        method: "PATCH",
        headers: json(tok),
        body: JSON.stringify({ ordem }),
      });

      // Estaciona bem longe: a capa pode ter ordem negativa (acima).
      for (let i = 0; i < alvos.length; i++) await mover(alvos[i].id, -(1000000 + i));
      for (const a of alvos) await mover(a.id, a.ordem);

      return res.status(200).json({ ok: true, atualizadas: alvos.length });
    }

    /* ---------- DELETE: some do Storage e da tabela ---------- */
    if (req.method === "DELETE") {
      const id = String(req.query.id || "");
      if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido." });

      const achado = await banco(`${REST("foto")}?select=caminho&id=eq.${id}&limit=1`, { headers: cabecalhos(tok) });
      const caminho = Array.isArray(achado) && achado[0] ? achado[0].caminho : null;
      if (!caminho) return res.status(404).json({ erro: "Foto não encontrada." });

      // Arquivo primeiro: se a linha falhar, o retry converge.
      await apagarArquivo(caminho);
      await banco(`${REST("foto")}?id=eq.${id}`, { method: "DELETE", headers: cabecalhos(tok) });
      return res.status(200).json({ ok: true, id });
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    return res.status(405).json({ erro: "Use GET, POST, PATCH ou DELETE." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha na operação com a foto." });
  }
};

/* A MÍDIA LIDA PELA IA (22/10/2026). A Flávia precisa ver a foto, o
 * documento e ouvir o áudio que o cliente mandou — e o arquivo está no
 * bucket privado, que só a chave de serviço abre (decisão 9).
 *
 * **Por isso a função mora aqui e é exportada, em vez de a chave ir
 * para o api/atendimento.js.** Quem chama passa o token do usuário, e a
 * ordem é a de sempre: a mensagem é lida PELO TOKEN, a RLS da 0054
 * decide o que ele enxerga, e só então a chave baixa o arquivo — e só
 * os arquivos das mensagens que a RLS devolveu, na pasta `wa/`.
 *
 * Devolve os bytes em base64, não um link: o modelo de voz não aceita
 * endereço, e o da Anthropic aceita os dois do mesmo jeito. */
async function midiaParaIA(tok, ids, teto) {
  const lista = (ids || []).filter((x) => RX_UUID.test(String(x))).slice(0, 10);
  if (!lista.length || !URL_BASE || !CHAVE) return [];
  const r = await fetch(`${URL_BASE}/rest/v1/wa_mensagem?select=id,anexo&id=in.(${lista.join(",")})`,
    { headers: { apikey: ANON, Authorization: tok } });
  if (!r.ok) return [];
  return baixarParaIA(await r.json().catch(() => []), teto);
}

/* O mesmo download, para a Flávia AO VIVO (0077, 23/10/2026). O cron não
 * tem usuário, então quem diz quais mensagens podem ser baixadas é a
 * `ia_midias()`, que exige o IA_SEGREDO e só devolve mídia DO CLIENTE.
 * A chave de serviço continua só aqui, e só para o que aquela função
 * devolveu — a mesma ordem da decisão 9, com o segredo no lugar do
 * token. */
async function midiaParaIAServidor(segredo, ids, teto) {
  const lista = (ids || []).filter((x) => RX_UUID.test(String(x))).slice(0, 10);
  if (!lista.length || !segredo || !URL_BASE || !CHAVE || !ANON) return [];
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/ia_midias`, {
    method: "POST", signal: AbortSignal.timeout(20000),
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_segredo: segredo, p_ids: lista }),
  });
  if (!r.ok) return [];
  return baixarParaIA(await r.json().catch(() => []), teto);
}

async function baixarParaIA(linhas, teto) {
  const saida = [];
  for (const l of linhas || []) {
    const a = l.anexo || {};
    const chave = String(a.chave || "");
    if (!chave || chave.slice(0, PASTA_WA.length + 1) !== `${PASTA_WA}/`) { saida.push({ id: l.id, erro: "sem arquivo guardado" }); continue; }
    try {
      const b = await fetch(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(chave)}`, { headers: hArquivo(), signal: AbortSignal.timeout(30000) });
      if (!b.ok) { saida.push({ id: l.id, erro: "arquivo não baixou" }); continue; }
      const buf = Buffer.from(await b.arrayBuffer());
      if (buf.length > (teto || MAX_DOC)) { saida.push({ id: l.id, erro: "arquivo grande demais" }); continue; }
      const mime = String(a.mime || b.headers.get("content-type") || "").split(";")[0];
      saida.push({ id: l.id, tipo: a.tipo || "", mime, voz: !!a.voz, bytes: buf.length, base64: buf.toString("base64") });
    } catch (e) { saida.push({ id: l.id, erro: "arquivo não baixou" }); }
  }
  return saida;
}
module.exports.midiaParaIA = midiaParaIA;
module.exports.midiaParaIAServidor = midiaParaIAServidor;

/* O CRLV DO CARRO, PARA MANDAR AO LOJISTA (0092, 28/10/2026). O Derek:
 * "o sistema pode mandar automaticamente o CRLV do veículo para o lojista,
 * algo que eles sempre pedem". O arquivo é o anexo do item "CRLV" do
 * check list de documentações (`doc:crlv`) ou um anexo rotulado CRLV na
 * negociação. A ordem é a da decisão 9: o anexo é LIDO com o token de
 * quem pediu — sem a RLS devolver a linha, a chave não toca o bucket — e
 * só então o link é assinado, por uma hora, que é o tempo de a ponte
 * baixar. Nada aqui vai para log. */
async function crlvParaLojista(tok, atendimentoId) {
  if (!RX_UUID.test(String(atendimentoId || ""))) return null;
  const ls = await banco(`${REST("anexo")}?select=id,caminho,nome,tipo,rotulo,criado_em&atendimento_id=eq.${atendimentoId}` +
    `&rotulo=ilike.*crlv*&order=criado_em.desc&limit=1`, { headers: cabecalhos(tok) });
  const a = Array.isArray(ls) ? ls[0] : null;
  if (!a || !a.caminho) return null;
  const r = await arquivos(`${STORAGE()}/object/sign/${BUCKET_DOC}`, {
    method: "POST", headers: jsonArquivo(), body: JSON.stringify({ expiresIn: VALIDADE, paths: [a.caminho] }),
  });
  const x = Array.isArray(r) ? r[0] : null;
  const url = x && (x.signedURL || x.signedUrl);
  if (!url) return null;
  return { url: url.charAt(0) === "/" ? `${STORAGE()}${url}` : url, nome: a.nome || "CRLV.pdf", tipo: a.tipo || "application/pdf" };
}
module.exports.crlvParaLojista = crlvParaLojista;

/* A VIA ASSINADA ENTRA NA HORA, PELO WEBHOOK (0146, 10/11/2026, o Derek: "o
 * contrato que o cliente assina no ZapSign não tá ficando salvo o PDF no
 * sistema pra conferência do adm"). Ela só entrava quando alguém abria o
 * atendimento. O webhook chega sem login: o documento já foi confirmado
 * "signed" consultando o próprio ZapSign com a nossa chave (decisão 21), o
 * atendimento sai do token por `contrato_por_token`, e a linha do anexo
 * entra por `anexar_contrato_assinado` — as duas estreitas, só para o token
 * que o envio gravou. A chave de serviço toca SÓ o Storage, como em todo
 * este arquivo (decisão 9). Falha em silêncio: o abrir do atendimento e do
 * check list continua guardando, como antes. */
async function viaAssinadaDoWebhook(tokenDoc, doc) {
  if (!CHAVE || !doc) return null;
  const rpc = (fn, corpo) => banco(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  });
  const aid = await rpc("contrato_por_token", { tok: tokenDoc });
  if (!aid || !RX_UUID.test(String(aid))) return null;
  const antes = await rpc("anexar_contrato_assinado", { tok: tokenDoc, p_caminho: null, p_bytes: 0 });
  if (!antes || antes.ja) return antes;
  const urlPdf = doc.signed_file || doc.original_file;
  if (!urlPdf) return null;
  const r = await fetch(urlPdf);
  if (!r.ok) return null;
  const pdf = Buffer.from(await r.arrayBuffer());
  if (!pdf.length || pdf.length > MAX_DOC) return null;
  const caminho = `${aid}/${Date.now()}-${sufixo()}.pdf`;
  await arquivos(`${STORAGE()}/object/${BUCKET_DOC}/${paraURL(caminho)}`, {
    method: "POST", headers: hArquivo({ "Content-Type": "application/pdf", "Cache-Control": "3600", "x-upsert": "false" }), body: pdf,
  });
  const fim = await rpc("anexar_contrato_assinado", { tok: tokenDoc, p_caminho: caminho, p_bytes: pdf.length }).catch(() => null);
  // Outro caminho guardou no meio (o abrir do atendimento): o arquivo daqui sobra e sai.
  if (!fim || fim.ja || !fim.id) await apagarDoc(caminho).catch(() => {});
  return fim;
}
module.exports.viaAssinadaDoWebhook = viaAssinadaDoWebhook;
