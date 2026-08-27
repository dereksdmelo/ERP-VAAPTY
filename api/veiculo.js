/**
 * /api/veiculo
 *
 * POST — grava a ficha na tabela veiculo. Se já existe linha com a
 *        mesma placa e status em_avaliacao, atualiza aquela linha em
 *        vez de criar outra.
 * GET  — as 20 fichas mais recentes, só os campos de lista.
 *
 * SUPABASE_URL e SUPABASE_SERVICE_KEY vivem no ambiente. A chave de
 * serviço passa por cima do RLS: ela não pode sair daqui — nem em
 * resposta, nem em log. Todo texto que volta ao cliente passa por
 * limpar().
 *
 * Sem biblioteca: só a API REST do Supabase (PostgREST) via fetch.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const CHAVE = process.env.SUPABASE_SERVICE_KEY || "";

const REST = () => `${URL_BASE}/rest/v1/veiculo`;
const ANON = process.env.SUPABASE_ANON_KEY || "";

/**
 * O token do usuário logado, repassado como veio. Quem valida é o
 * PostgREST: token inválido volta 401 e a gente devolve isso ao
 * cliente. Verificar assinatura aqui seria refazer, sem biblioteca, o
 * que o banco já faz.
 *
 * O token NÃO pode virar variável de módulo: duas requisições
 * simultâneas na mesma instância trocariam de usuário.
 */
const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};

const SEM_LOGIN = { erro: "Sessão expirada. Entre de novo." };

const cabecalhos = (tok, extra) => ({
  apikey: ANON,
  Authorization: tok,
  "Content-Type": "application/json",
  ...extra,
});

// Rede de segurança: se a chave aparecer em qualquer texto, some.
const limpar = (s) => {
  const t = String(s == null ? "" : s);
  return CHAVE ? t.split(CHAVE).join("[oculto]") : t;
};

/* ------------------ conversões tela → coluna ------------------ */

// A tela guarda "Novo"/"Bom"/"Médio"/"Fraco"; a coluna é o enum estado_pneu.
const PNEU = { novo: "novo", bom: "bom", "médio": "medio", medio: "medio", fraco: "fraco" };
const pneu = (v) => PNEU[String(v || "").trim().toLowerCase()] || null;

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};
const inteiro = (v) => {
  const s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  const n = Number(s.replace(/[^\d-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
// Aceita o que o negociador digita: 51371, 51.371 e 51.371,50.
const decimal = (v) => {
  let s = String(v == null ? "" : v).trim();
  if (s === "") return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
// Aceita array pronto ou o texto de várias linhas dos campos de observação.
const arranjo = (v) => {
  const a = Array.isArray(v) ? v : String(v == null ? "" : v).split("\n");
  return a.map((x) => String(x).trim()).filter(Boolean);
};

const normalizarPlaca = (v) => String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/**
 * A tela tem um campo só, "2019/2020"; o banco tem ano_fabricacao e
 * ano_modelo. Um valor sozinho vale para os dois.
 */
function anos(ano) {
  const p = String(ano || "").split("/").map((x) => inteiro(x));
  if (p.length < 2) return { ano_fabricacao: p[0] || null, ano_modelo: p[0] || null };
  return { ano_fabricacao: p[0] || null, ano_modelo: p[1] || p[0] || null };
}

// De qual campo da tela veio cada coluna. Serve para não apagar no
// update o que a tela nem mandou — renavam, por exemplo, tem coluna
// mas ainda não tem campo.
const FONTE = {
  placa: "placa", chassi: "chassi", renavam: "renavam", marca_modelo: "modelo",
  ano_fabricacao: "ano", ano_modelo: "ano", cor: "cor", combustivel: "combustivel",
  cambio: "cambio", km_atual: "km", km_entrada: "kmEntrada",
  fipe_codigo: "fipeCodigo", fipe_valor: "fipe",
  pneu_de: "pneus", pneu_dd: "pneus", pneu_te: "pneus", pneu_td: "pneus",
  leilao_sinistro: "leilao", gnv: "gnv", opcionais: "opcionais",
  detalhes_lataria: "lataria", detalhes_mecanica: "mecanica",
  pontos_positivos: "positivos", ressalvas_lojista: "ressalvas",
  observacoes_internas: "internas",
  gastos_descricao: "gastos", valor_por: "por",
};
const somenteEnviadas = (linha, f) => {
  const r = {};
  Object.keys(linha).forEach((coluna) => {
    if (f[FONTE[coluna]] !== undefined) r[coluna] = linha[coluna];
  });
  return r;
};

function paraColunas(f) {
  const pneus = Array.isArray(f.pneus) ? f.pneus : [];
  return {
    placa: normalizarPlaca(f.placa),
    chassi: texto(f.chassi),
    renavam: texto(f.renavam),
    marca_modelo: texto(f.modelo),
    ...anos(f.ano),
    cor: texto(f.cor),
    combustivel: texto(f.combustivel),
    cambio: texto(f.cambio),
    km_atual: inteiro(f.km),
    km_entrada: inteiro(f.kmEntrada),

    fipe_codigo: texto(f.fipeCodigo),
    fipe_valor: decimal(f.fipe),

    pneu_de: pneu(pneus[0]),
    pneu_dd: pneu(pneus[1]),
    pneu_te: pneu(pneus[2]),
    pneu_td: pneu(pneus[3]),
    leilao_sinistro: !!f.leilao,
    gnv: !!f.gnv,
    opcionais: arranjo(f.opcionais),

    detalhes_lataria: texto(f.lataria),
    detalhes_mecanica: texto(f.mecanica),

    // as três camadas de observação, cada uma no seu destino
    pontos_positivos: arranjo(f.positivos),
    ressalvas_lojista: arranjo(f.ressalvas),
    observacoes_internas: texto(f.internas),

    gastos_descricao: texto(f.gastos),
    valor_por: decimal(f.por),
  };
}

/* ------------------ conversa com o Supabase ------------------ */

async function supa(url, opcoes) {
  let r;
  try {
    r = await fetch(url, opcoes);
  } catch (e) {
    const erro = new Error("Não consegui falar com o banco.");
    erro.status = 502;
    throw erro;
  }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a gravação.";
    const erro = new Error(limpar(msg));
    erro.status = r.status === 401 || r.status === 403 ? 500 : 502;
    throw erro;
  }
  return dado;
}

/* ------------------ handler ------------------ */

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json(SEM_LOGIN);

  try {
    if (req.method === "GET") {
      const campos = "placa,marca_modelo,valor_por,status,criado_em";
      const lista = await supa(
        `${REST()}?select=${campos}&order=criado_em.desc&limit=20`,
        { headers: cabecalhos(tok) }
      );
      return res.status(200).json({ fichas: lista || [] });
    }

    if (req.method === "POST") {
      let ficha = req.body;
      if (ficha && typeof Buffer !== "undefined" && Buffer.isBuffer(ficha)) ficha = ficha.toString("utf8");
      if (typeof ficha === "string") { try { ficha = JSON.parse(ficha); } catch (e) { ficha = null; } }
      if (!ficha || typeof ficha !== "object") {
        return res.status(400).json({ erro: "Corpo vazio ou fora do formato JSON." });
      }

      const linha = somenteEnviadas(paraColunas(ficha), ficha);
      if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(linha.placa)) {
        return res.status(400).json({ erro: "Placa fora do formato ABC1234 ou ABC1D23." });
      }

      // Uma ficha por placa enquanto o carro está em avaliação.
      const abertas = await supa(
        `${REST()}?select=id&placa=eq.${encodeURIComponent(linha.placa)}&status=eq.em_avaliacao&limit=1`,
        { headers: cabecalhos(tok) }
      );
      const existente = Array.isArray(abertas) && abertas[0] ? abertas[0].id : null;

      let salvo;
      if (existente) {
        // status e fipe_consultada_em ficam como estão: quem atualiza a
        // ficha não reconsultou a FIPE nem mudou o carro de etapa.
        const r = await supa(`${REST()}?id=eq.${encodeURIComponent(existente)}`, {
          method: "PATCH",
          headers: cabecalhos(tok, { Prefer: "return=representation" }),
          body: JSON.stringify(linha),
        });
        salvo = Array.isArray(r) ? r[0] : r;
      } else {
        const r = await supa(REST(), {
          method: "POST",
          headers: cabecalhos(tok, { Prefer: "return=representation" }),
          body: JSON.stringify({
            ...linha,
            // A consulta de placa acontece no mesmo atendimento.
            fipe_consultada_em: linha.fipe_valor == null ? null : new Date().toISOString(),
          }),
        });
        salvo = Array.isArray(r) ? r[0] : r;
      }

      return res.status(existente ? 200 : 201).json({
        ok: true,
        criado: !existente,
        id: salvo ? salvo.id : null,
        placa: linha.placa,
        status: salvo ? salvo.status : null,
        salvo_em: (salvo && (salvo.atualizado_em || salvo.criado_em)) || new Date().toISOString(),
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ erro: "Use GET ou POST." });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: limpar(e.message) || "Falha ao gravar." });
  }
};
