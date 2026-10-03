/**
 * GET /api/funil?de=aaaa-mm-dd&ate=aaaa-mm-dd
 *
 * A aba PIPELINE da planilha: fluxo → avaliações → propostas → vendas,
 * quebrado por origem, com conversão e valores médios.
 *
 * Sem período, usa o mês corrente.
 *
 * Por que aqui e não na tela: a lista do CRM é paginada, e contar em
 * cima do que coube na página daria número errado — no mês da planilha
 * foram 173 atendimentos. Aqui a consulta é enxuta (sem foto, sem
 * observação) e cabe de uma vez.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const TETO = 2000;

const ORIGENS = ["fluxo_loja", "prospeccao", "indicacao", "tv", "google",
                 "facebook", "outdoor", "recuperacao", "faceleads", "outro"];

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const dia = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null);

/**
 * Hoje em Joinville, no formato aaaa-mm-dd.
 *
 * Em UTC isto quebra de verdade: das 21h à meia-noite do dia 31, o
 * relógio de Greenwich já virou o mês, e o dashboard trocava o período
 * inteiro — o mês que a loja estava fechando sumia da tela por três
 * horas. `en-CA` é o truque para sair ISO sem montar a string à mão.
 */
const hojeAqui = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * A rentabilidade líquida de um carro vendido.
 *
 * Terceira cópia desta conta — a tela e o `api/financeiro.js` têm as
 * outras duas, porque o servidor não carrega o `index.html`. **Mudar
 * uma obriga a mudar as três.**
 *
 * É a **líquida**, que é onde a planilha de rentabilidade fecha e o
 * que o DRE já usa (decisão 26). O fechamento (decisão 32) usa a bruta
 * de propósito, porque lá cautelar e comissão externa aparecem logo
 * abaixo como despesa variável e entrariam duas vezes.
 */
const CUSTO_DO_CARRO = ["debitos", "quitacao", "deducao"];
function liquidaDe(e) {
  const custos = Array.isArray(e.estoque_custo) ? e.estoque_custo : [];
  const val = (l) => (l.realizado == null ? Number(l.previsto) || 0 : Number(l.realizado) || 0);
  const gasto = custos.reduce((t, l) => t + val(l), 0);
  return (Number(e.valor_venda) || 0) - (Number(e.valor_compra) || 0) - gasto;
}

/**
 * De qual CANAL COMERCIAL veio o carro.
 *
 * Duas fontes, nesta ordem: o atendimento ligado, que tem `origem` de
 * verdade; e, quando não há (109 dos 135 carros de hoje vieram da
 * planilha, sem vínculo), o texto `meio_alcance` que a importação
 * trouxe.
 *
 * **E esse texto está sujo.** Vinte grafias para oito canais:
 * "INDICAÇÃO" e "INDICA√á√ÉO" são o mesmo canal — a segunda é UTF-8
 * lido como MacRoman em algum ponto da planilha —, "FACHADA DA LOJA"
 * e "FACHADA LOJA" também, e há "J√Å √â CLINETE" com o erro de
 * digitação dentro. Contar o texto cru partiria indicação em duas e
 * faria o canal parecer metade do que é.
 *
 * **Casa por PREFIXO ASCII, não por igualdade.** O pedaço estragado
 * fica sempre depois da parte que distingue ("INDICA…", "RECUPERA…"),
 * então comparar o começo atravessa a sujeira sem precisar listar cada
 * grafia errada — e sobrevive à próxima, que virá escrita de um jeito
 * novo.
 *
 * **Nada é jogado fora em silêncio:** o que não casa vai para `outro`
 * e volta na resposta em `sem_canal`, para a tela mostrar o que está
 * sendo amontoado ali. É o caso de "JÁ É CLIENTE", que é um canal de
 * verdade e ainda não tem entrada em ORIGENS.
 */
const CANAL_POR_TEXTO = [
  [/^INDICA/, "indicacao"],
  [/^RECUPERA/, "recuperacao"],
  [/^PROSPEC/, "prospeccao"],
  [/^(FACEBOOK|INSTAGRAM|FACE)/, "facebook"],
  [/^FACELEAD/, "faceleads"],
  [/^GOOGLE/, "google"],
  [/^OUTDOOR/, "outdoor"],
  [/^TV\b|^TV$/, "tv"],
  [/^(FLUXO|FACHADA|RETORNO|LIGA)/, "fluxo_loja"],
];
function canalDe(e) {
  const at = Array.isArray(e.atendimento) ? e.atendimento[0] : e.atendimento;
  if (at && at.origem) return at.origem;
  const cru = String(e.meio_alcance || "").trim().toUpperCase();
  if (!cru) return null;
  for (const [rx, id] of CANAL_POR_TEXTO) if (rx.test(cru)) return id;
  return "outro";
}

const media = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
const pct = (parte, todo) => (todo ? Math.round((parte / todo) * 1000) / 10 : null);

/* ===================== O FUNIL DA PRÉ-VENDA =====================
 *
 * `GET /api/funil?recurso=prevendas&de=&ate=`
 *
 * **Outro funil, outra equipe.** O de cima mede o negociador: fluxo na
 * loja → avaliação → proposta → venda. Este mede a PRÉ-VENDA, e a
 * cadeia é a da decisão 37:
 *
 *     conversas → agendamento → cliente na loja
 *
 * E o recorte é por CANAL DE WHATSAPP — o número da TV, o da
 * prospecção ativa, o da loja, os dois que a IA atende. É a pergunta
 * do Derek em 03/10/2026: qual canal comercial da pré-venda funciona.
 *
 * **O vínculo é calculado na leitura, não gravado.** `wa_conversa`
 * tem `lead_id` e `atendimento_id` desde a 0054 e os dois estão
 * nulos; preenchê-los pediria uma rotina que ninguém roda e que
 * envelhece calada. O telefone é o que as duas pontas têm, então o
 * casamento acontece aqui — mesma razão pela qual o "Meu dia" mescla
 * agenda e atendimento na hora de desenhar em vez de copiar um para o
 * outro (decisão 41).
 *
 * **O telefone não vem igual dos dois lados.** O WhatsApp manda
 * `554792331281` (com o 55 do país); o lead guarda `47996241555`. E o
 * nono dígito aparece num e falta no outro conforme quem digitou.
 * `chaveFone()` corta o 55, e a comparação é pelos **oito últimos
 * dígitos mais o DDD** — o que sobra quando o nono dígito está em
 * dúvida. Casar pela string inteira perderia justamente os números
 * antigos, que são os do cliente que já ligou antes.
 */
const chaveFone = (f) => {
  let d = String(f || "").replace(/\D/g, "");
  if (d.length > 11 && d.slice(0, 2) === "55") d = d.slice(2);
  if (d.length < 10) return null;
  // DDD + os oito finais: o nono dígito é o que varia entre as fontes.
  return d.slice(0, 2) + d.slice(-8);
};

const vazioPre = () => ({
  conversas: 0, esperando: 0, respondidas: 0,
  leads: 0, agendados: 0, compareceram: 0, nao_compareceram: 0, perdidos: 0,
  // A ponta do dinheiro: o Derek pediu o resultado de cada IA
  // separadamente, e "na loja" não é resultado -- é meio do caminho.
  fecharam: 0, carros: 0, resultado: 0,
});

async function preVendas(req, res, tok, de, ate) {
  const puxar = async (url) => {
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: tok } });
    if (!r.ok) { const e = new Error("Não consegui ler o funil da pré-venda."); e.status = r.status === 401 ? 401 : 502; throw e; }
    return JSON.parse((await r.text()) || "[]");
  };

  const [convs, leads, canais, ats] = await Promise.all([
    puxar(`${URL_BASE}/rest/v1/wa_conversa?select=telefone,nome,lead_id,primeira_em,ultima_em,ultima_de_fora,respondida_em,anuncio,wa_canal(slug,nome,atendente)` +
          `&primeira_em=gte.${de}&primeira_em=lte.${ate}T23:59:59&limit=${TETO}`),
    // O lead é procurado numa janela MAIOR que o período: quem escreveu
    // no dia 30 costuma ser agendado em seguida, e cortar no último dia
    // do mês faria o canal parecer que não converte.
    puxar(`${URL_BASE}/rest/v1/lead?select=id,telefone,status,origem,agendado_para,atendimento_id,criado_em&limit=${TETO}`),
    puxar(`${URL_BASE}/rest/v1/wa_canal?select=slug,nome,atendente,ativo&order=slug`),
    /* O CAMINHO CURTO, que o uso real revelou: a equipe abre o
     * ATENDIMENTO direto da conversa, sem passar pelo lead -- há
     * atendimento de 03/10/2026 com prospector "IA – CAMILA". Medir só
     * pelo lead diria que a Camila não traz ninguém, quando ela acabou
     * de trazer. Cliente na loja é cliente na loja, por qualquer
     * caminho. */
    puxar(`${URL_BASE}/rest/v1/atendimento?select=id,cliente_telefone,status,data&data=gte.${de}&data=lte.${ate}&limit=${TETO}`),
  ]);

  /* O CARRO QUE SAIU DE CADA CONVERSA.
   *
   * O atendimento liga a conversa ao carro, e o carro à margem. Sem
   * esta perna a tela parava em "sentou na mesa" -- que é meio do
   * caminho, não resultado: duas IAs podem trazer o mesmo tanto de
   * gente e uma delas trazer quem fecha.
   *
   * Falha em silêncio porque é a parte mais frágil da corrente: só 26
   * dos 135 carros de hoje têm `atendimento_id`, e o que vier daqui
   * para frente terá. Sem ela a cadeia continua até "na loja", que já
   * é a pergunta principal. */
  let porAtendimento = {};
  const idsAt = ats.map((a) => a.id).filter(Boolean);
  if (idsAt.length) {
    try {
      const car = await puxar(`${URL_BASE}/rest/v1/estoque?select=atendimento_id,valor_compra,valor_venda,situacao,` +
        `estoque_custo(tipo,previsto,realizado)&atendimento_id=in.(${idsAt.join(",")})&limit=${TETO}`);
      car.forEach((e) => {
        if (!e.atendimento_id) return;
        const x = porAtendimento[e.atendimento_id] || (porAtendimento[e.atendimento_id] = { carros: 0, margem: 0 });
        x.carros += 1;
        // Só carro revendido tem margem: o que está no pátio ainda não
        // produziu nada, e somar a compra daria prejuízo em todo canal.
        if (e.situacao === "vendido") x.margem += liquidaDe(e);
      });
    } catch (e) { porAtendimento = {}; }
  }

  // O lead mais adiantado de cada telefone manda: a mesma pessoa pode
  // ter voltado, e contar o retorno como "não compareceu" esconderia a
  // visita que aconteceu.
  const ORDEM = { perdido: 0, novo: 1, em_contato: 2, nao_compareceu: 3, agendado: 4, confirmado: 5, compareceu: 6 };
  const porFone = {};
  const porId = {};
  leads.forEach((l) => {
    porId[l.id] = l;
    const k = chaveFone(l.telefone);
    if (!k) return;
    const atual = porFone[k];
    if (!atual || (ORDEM[l.status] || 0) >= (ORDEM[atual.status] || 0)) porFone[k] = l;
  });

  // Telefones que viraram atendimento no período, com o atendimento
  // junto: é por ele que se chega ao carro e à margem.
  const naLoja = {};
  ats.forEach((a) => { const k = chaveFone(a.cliente_telefone); if (k) naLoja[k] = a; });

  const por = {};
  const caixa = (c) => por[c] || (por[c] = { ...vazioPre() });
  canais.forEach((c) => { por[c.slug] = { ...vazioPre(), slug: c.slug, nome: c.nome, atendente: c.atendente, ativo: c.ativo }; });

  let semCanal = 0;
  convs.forEach((c) => {
    const ca = Array.isArray(c.wa_canal) ? c.wa_canal[0] : c.wa_canal;
    if (!ca) { semCanal += 1; return; }
    const x = caixa(ca.slug);
    x.slug = x.slug || ca.slug; x.nome = x.nome || ca.nome; x.atendente = x.atendente || ca.atendente;
    x.conversas += 1;

    // "Esperando" é a mesma regra da caixa de entrada, e é medida de
    // ATENDIMENTO, não de venda: canal que converte mal porque ninguém
    // responde é outro problema que a mesma tabela resolve.
    const esperando = !!(c.ultima_de_fora && (!c.respondida_em || c.respondida_em < c.ultima_de_fora));
    if (esperando) x.esperando += 1; else if (c.respondida_em) x.respondidas += 1;

    // O vínculo gravado manda; o telefone é a rede para o lead que
    // nasceu por outro caminho, onde o número pode ter sido digitado
    // de um jeito diferente.
    const k = chaveFone(c.telefone);
    const l = (c.lead_id && porId[c.lead_id]) || porFone[k];
    // Sentou na mesa, por qualquer caminho: o lead que compareceu, ou
    // o atendimento aberto direto da conversa.
    const at = naLoja[k] || null;
    const sentou = !!(at || (l && (l.status === "compareceu" || l.atendimento_id)));
    if (sentou) x.compareceram += 1;

    const atId = (at && at.id) || (l && l.atendimento_id) || null;
    if (at && at.status === "fechado") x.fecharam += 1;
    const carro = atId ? porAtendimento[atId] : null;
    if (carro) { x.carros += carro.carros; x.resultado += carro.margem; }
    if (!l) {
      // Virou atendimento sem nunca ter sido lead: conta como na loja,
      // e também como lead -- senão a conversão de agendamento ficaria
      // acima de 100% para quem pula a fila.
      if (sentou) { x.leads += 1; x.agendados += 1; }
      return;
    }
    x.leads += 1;
    if (l.agendado_para) x.agendados += 1;
    else if (sentou) x.agendados += 1;
    if (!sentou && l.status === "nao_compareceu") x.nao_compareceram += 1;
    else if (!sentou && l.status === "perdido") x.perdidos += 1;
  });

  const linhas = Object.values(por).filter((x) => x.slug).map((x) => ({
    ...x,
    // As duas conversões da decisão 37, agora medidas em vez de só
    // digitadas como meta.
    conv_agendamento: pct(x.agendados, x.conversas),
    conv_comparecimento: pct(x.compareceram, x.agendados),
    // Ponta a ponta: de cada cem que escreveram, quantos sentaram na
    // mesa. É o número que compara canal com canal.
    // ATÉ AQUI É DA PRÉ-VENDA. O Derek fechou a régua em 03/10/2026:
    // "a métrica de sucesso do pré-vendas é trazer o cliente na loja,
    // a métrica do negociador é transformar essa visita em venda".
    // Por isso `conv_total` -- conversa até a mesa -- é a nota da
    // pré-venda, e não se mistura com a de baixo.
    conv_total: pct(x.compareceram, x.conversas),
    // **DAQUI PARA BAIXO É DO NEGOCIADOR**: de quem chegou, quantos
    // fecharam. Canal que traz muita gente que não compra é problema
    // do canal; canal que traz pouca gente que compra toda é problema
    // de volume -- e só separando dá para saber qual dos dois.
    conv_venda: pct(x.fecharam, x.compareceram),
    // **O número que compara uma IA com a outra**: quanto cada
    // conversa daquele número acabou valendo. Volume alto sem fechar
    // deixa de parecer sucesso -- a mesma régua do `por_atendimento`
    // dos canais do negociador.
    por_conversa: x.conversas ? Math.round(x.resultado / x.conversas) : null,
    margem_media: x.carros ? Math.round(x.resultado / x.carros) : null,
  })).sort((a, b) => b.conversas - a.conversas);

  // Pessoa contra IA, somado — era a razão de `atendente` existir na
  // 0054, e até aqui ninguém tinha lido.
  const juntar = (quais) => quais.reduce((t, x) => {
    Object.keys(vazioPre()).forEach((k) => { t[k] += x[k]; });
    return t;
  }, { ...vazioPre() });
  const sofre = (lista) => {
    const t = juntar(lista);
    return { ...t, conv_agendamento: pct(t.agendados, t.conversas), conv_comparecimento: pct(t.compareceram, t.agendados),
      conv_total: pct(t.compareceram, t.conversas),
      conv_venda: pct(t.fecharam, t.compareceram),
      por_conversa: t.conversas ? Math.round(t.resultado / t.conversas) : null,
      margem_media: t.carros ? Math.round(t.resultado / t.carros) : null };
  };

  return res.status(200).json({
    de, ate,
    por_canal: linhas,
    humano: sofre(linhas.filter((x) => x.atendente !== "ia")),
    ia: sofre(linhas.filter((x) => x.atendente === "ia")),
    total: sofre(linhas),
    sem_canal: semCanal,
    // A coleta começou em 01/10/2026: antes disso nenhuma conversa foi
    // registrada, e período que pega os dois lados dessa data mostra
    // canal zerado que não estava parado — estava sem ponte.
    coleta_desde: "2026-10-01",
    truncado: convs.length >= TETO,
  });
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }
  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  const hoje = hojeAqui();
  const de = dia(req.query.de) || `${hoje.slice(0, 8)}01`;
  const ate = dia(req.query.ate) || hoje;

  if (String(req.query.recurso || "") === "prevendas") {
    try { return await preVendas(req, res, tok, de, ate); }
    catch (e) { return res.status(e.status || 502).json({ erro: e.message || "Falhou." }); }
  }

  const campos = "origem,status,data,valor_fechado,negociador_nome,veiculo(fipe_valor),proposta(id)";
  const url = `${URL_BASE}/rest/v1/atendimento?select=${campos}` +
              `&data=gte.${de}&data=lte.${ate}&limit=${TETO}`;

  let linhas;
  try {
    const r = await fetch(url, { headers: { apikey: ANON, Authorization: tok } });
    const corpo = await r.text();
    if (!r.ok) return res.status(r.status === 401 ? 401 : 502).json({ erro: "Não consegui ler o funil." });
    linhas = JSON.parse(corpo || "[]");
  } catch (e) {
    return res.status(502).json({ erro: "Não consegui falar com o banco." });
  }

  // `semanas` são os quatro blocos da META SEMANAL da planilha: dias
  // 1–7, 8–14, 15–21 e 22 em diante. Não é semana de calendário, é a
  // divisão do mês em quatro — que é como a meta é cobrada.
  const vazio = () => ({
    fluxo: 0, avaliacoes: 0, com_proposta: 0, vendas: 0, perdidos: 0,
    valor_vendido: 0, carros_vendidos: 0, faturado: 0, semanas: [0, 0, 0, 0],
  });
  const porOrigem = {};
  ORIGENS.forEach((o) => { porOrigem[o] = vazio(); });
  const porNegociador = {};
  const total = vazio();

  const fipes = [];
  const vendas = [];

  linhas.forEach((a) => {
    const o = porOrigem[a.origem] || (porOrigem[a.origem] = vazio());
    const v = (a.veiculo || [])[0];
    // Avaliação é ficha aberta com valor FIPE: é o que a planilha
    // chamava de "veículo avaliado", não só o cliente que entrou.
    const avaliou = !!(v && v.fipe_valor);
    const teveProposta = ((a.proposta || []).length > 0);
    const vendeu = a.status === "fechado";

    // A planilha mede por pessoa, e é aí que a conversa de meta
    // acontece. Agrupa pelo nome porque atendimento importado não tem
    // vínculo com login — negociador_id fica nulo.
    const nome = String(a.negociador_nome || "").trim().toUpperCase();
    const n = nome ? (porNegociador[nome] || (porNegociador[nome] = vazio())) : null;

    [o, total].concat(n ? [n] : []).forEach((c) => {
      c.fluxo += 1;
      if (avaliou) c.avaliacoes += 1;
      if (teveProposta) c.com_proposta += 1;
      if (vendeu) c.vendas += 1;
      if (a.status === "perdido") c.perdidos += 1;
    });

    if (v && v.fipe_valor) fipes.push(Number(v.fipe_valor));
  });

  /* ---------- o dinheiro: margem dos carros vendidos ----------
   *
   * Vinha de `atendimento.valor_fechado`, e por dois motivos isso
   * estava errado. O primeiro é que a importação do CRM nunca preenche
   * essa coluna — a planilha não a tem —, então todo mês importado
   * lia R$ 0. O segundo é conceitual: `valor_fechado` é o que a Vaapty
   * PAGA ao cliente, não o que ela ganha; a meta é em margem (R$ 5.000
   * de ticket por carro), e somar o preço de compra daria vinte vezes
   * o alvo.
   *
   * Agora vem de onde o Derek disse: da planilha de rentabilidade —
   * carro com `situacao = vendido` e `vendido_em` no período.
   *
   * **Isso desloca o mês.** O carro é comprado num mês e revendido em
   * outro, então o faturamento aparece no mês da REVENDA, não no do
   * fechamento. As contagens do funil (fluxo, avaliações, vendas)
   * continuam sendo do atendimento — são coisas diferentes e a tela
   * precisa dizer isso.
   */
  let carros = [];
  try {
    // O mesmo `or=` do `vendidosNoMes()` no api/financeiro.js, e não é
    // capricho: a planilha de rentabilidade só sabe a SEMANA da venda,
    // então o carro importado fica com `vendido_em` nulo (decisão 25).
    // Filtrar só por `vendido_em` perdia justamente os carros que vieram
    // da planilha — que são os únicos que existem hoje. Nesse caso cai
    // em `entrou_em`, como o DRE já faz.
    const urlE = `${URL_BASE}/rest/v1/estoque?select=valor_compra,valor_venda,vendido_em,entrou_em,negociador_nome,` +
                 `meio_alcance,atendimento(origem),` +
                 `estoque_custo(tipo,previsto,realizado)&situacao=eq.vendido&limit=${TETO}` +
                 `&or=(and(vendido_em.gte.${de},vendido_em.lte.${ate}),` +
                 `and(vendido_em.is.null,entrou_em.gte.${de},entrou_em.lte.${ate}))`;
    const r = await fetch(urlE, { headers: { apikey: ANON, Authorization: tok } });
    if (r.ok) carros = JSON.parse((await r.text()) || "[]");
  } catch (e) { carros = []; }

  // O que não casou com canal nenhum, por grafia — para a tela dizer o
  // que está amontoado em "outro" em vez de esconder.
  const semCanal = {};
  carros.forEach((e) => {
    const at0 = Array.isArray(e.atendimento) ? e.atendimento[0] : e.atendimento;
    const valor = liquidaDe(e);
    vendas.push(valor);
    const nome = String(e.negociador_nome || "").trim().toUpperCase();
    const n = nome ? (porNegociador[nome] || (porNegociador[nome] = vazio())) : null;
    if (n) { n.valor_vendido += valor; n.carros_vendidos += 1; n.faturado += Number(e.valor_venda) || 0; }
    total.valor_vendido += valor;
    total.carros_vendidos += 1;
    total.faturado += Number(e.valor_venda) || 0;

    /* O DINHEIRO POR CANAL, que até aqui não existia: o funil atribuía
     * margem por negociador e deixava a origem só com contagem. Sem
     * isto não dá para comparar canal nenhum — volume alto com margem
     * baixa parece sucesso. */
    const canal = canalDe(e);
    if (canal) {
      const c = porOrigem[canal] || (porOrigem[canal] = vazio());
      c.valor_vendido += valor;
      c.carros_vendidos += 1;
      c.faturado += Number(e.valor_venda) || 0;
    }
    // Só o que de fato não foi reconhecido é anotado — "outro" vindo de
    // um texto que ninguém sabe ler, e carro sem canal nenhum.
    if (!canal || (canal === "outro" && !(at0 && at0.origem))) {
      const k = String(e.meio_alcance || "").trim().toUpperCase() || "(em branco)";
      semCanal[k] = (semCanal[k] || 0) + 1;
    }

    // Venda sem data não entra em semana nenhuma: somar tudo na semana
    // 1 daria uma meta semanal mentirosa.
    const d = Number(String(e.vendido_em || e.entrou_em || "").slice(8, 10));
    if (d >= 1 && d <= 31) {
      const semana = Math.min(3, Math.floor((d - 1) / 7));
      if (n) n.semanas[semana] += valor;
      total.semanas[semana] += valor;
    }
  });

  const comMovimento = Object.keys(porOrigem)
    // `carros_vendidos` entrou no filtro: um carro de TV revendido
    // neste mês, cujo atendimento foi no mês passado, sumia da tabela
    // — e some justamente o dinheiro, que é o que se quer ver.
    .filter((o) => porOrigem[o].fluxo > 0 || porOrigem[o].carros_vendidos > 0)
    .sort((a, b) => (porOrigem[b].valor_vendido - porOrigem[a].valor_vendido) || (porOrigem[b].fluxo - porOrigem[a].fluxo))
    .map((o) => ({
      origem: o, ...porOrigem[o],
      conversao: pct(porOrigem[o].vendas, porOrigem[o].fluxo),
      // Margem por carro revendido — a mesma régua do cartão do
      // negociador, para os dois números serem comparáveis.
      ticket_medio: porOrigem[o].carros_vendidos
        ? Math.round(porOrigem[o].valor_vendido / porOrigem[o].carros_vendidos) : null,
      // **O número que compara canais**: quanto cada atendimento que
      // entrou por ali acabou valendo. Volume alto com margem baixa
      // deixa de parecer sucesso.
      por_atendimento: porOrigem[o].fluxo
        ? Math.round(porOrigem[o].valor_vendido / porOrigem[o].fluxo) : null,
    }));

  const equipe = Object.keys(porNegociador)
    .sort((a, b) => porNegociador[b].vendas - porNegociador[a].vendas)
    .map((nome) => ({
      nome,
      ...porNegociador[nome],
      conversao: pct(porNegociador[nome].vendas, porNegociador[nome].fluxo),
      // Margem por carro REVENDIDO — que é a base do valor_vendido.
      // Dividir pelos fechamentos do CRM misturaria duas populações.
      ticket_medio: porNegociador[nome].carros_vendidos
        ? Math.round(porNegociador[nome].valor_vendido / porNegociador[nome].carros_vendidos)
        : null,
    }));

  // Quantos atendimentos ficaram sem dono: sem isso, o dashboard soma
  // menos que o total e ninguém entende por quê.
  const semNegociador = linhas.filter((a) => !String(a.negociador_nome || "").trim()).length;

  return res.status(200).json({
    de, ate,
    por_negociador: equipe,
    sem_negociador: semNegociador,
    total: {
      ...total,
      avaliacoes_sobre_fluxo: pct(total.avaliacoes, total.fluxo),
      vendas_sobre_proposta: pct(total.vendas, total.com_proposta),
      conversao: pct(total.vendas, total.fluxo),
    },
    fipe_medio: media(fipes),
    venda_media: media(vendas),
    por_origem: comMovimento,
    // As grafias que caíram em "outro", para a tela mostrar o que está
    // amontoado ali (decisão 13: nada some em silêncio).
    sem_canal: Object.keys(semCanal).filter((k) => semCanal[k] > 0)
      .map((k) => ({ texto: k, carros: semCanal[k] })).sort((a, b) => b.carros - a.carros),
    // Se bater no teto, o número está incompleto e a tela precisa dizer.
    truncado: linhas.length >= TETO,
  });
};
