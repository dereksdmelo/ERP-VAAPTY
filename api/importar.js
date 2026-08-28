/**
 * POST /api/importar   { linhas: [...] }
 *
 * Traz a planilha do CRM para o banco. A tela manda as linhas já
 * separadas em campos; aqui é a gravação em três lotes:
 *
 *   1. atendimento   um por linha
 *   2. veiculo       só nas linhas com placa válida
 *   3. proposta      uma por par valor/lojista que sobreviveu
 *
 * Três lotes e não 3×N requisições: a planilha tem 173 linhas num mês
 * só, e uma chamada por linha levaria minutos.
 *
 * Não é transação. Se o lote 2 falhar, os atendimentos do lote 1 ficam.
 * Aceitável numa importação que se faz uma vez e dá para conferir na
 * lista; se virar rotina, vira função no banco.
 */

const URL_BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const ANON = process.env.SUPABASE_ANON_KEY || "";
const REST = (t) => `${URL_BASE}/rest/v1/${t}`;
const TETO = 500;

const ORIGENS = ["fluxo_loja", "prospeccao", "indicacao", "tv", "google",
                 "facebook", "outdoor", "recuperacao", "faceleads", "outro"];
// Os quinze da 0009 mais os três antigos, que continuam no enum. Sem
// esta lista completa tudo o que não fosse "fechado" virava "aberto" no
// servidor, mesmo com a tela mandando o status certo — foi o que
// apagou o status de 200 linhas na primeira importação.
const STATUS = [
  "fechado", "cliente_na_loja", "aguardando", "baixar_expectativa", "vai_voltar",
  "consignado", "vendeu_fora", "perseguir", "em_negociacao", "nao_avaliou",
  "nao_lancado", "falta_proposta", "quitacao_futura", "rescisao", "restricao",
  "aberto", "aguardando_propostas", "perdido",
];

const tokenDe = (req) => {
  const h = String((req.headers && req.headers.authorization) || "");
  return /^Bearer\s+\S+/.test(h) ? h : null;
};
const cabecalhos = (tok, extra) => ({ apikey: ANON, Authorization: tok, ...extra });
const json = (tok, extra) => cabecalhos(tok, { "Content-Type": "application/json", ...extra });

const texto = (v) => {
  const s = String(v == null ? "" : v).trim();
  return s === "" ? null : s;
};

const decimal = (v) => {
  let s = String(v == null ? "" : v).replace(/R\$|\s/g, "").trim();
  if (!s) return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const inteiro = (v) => {
  const n = decimal(v);
  return n == null ? null : Math.trunc(n);
};

/**
 * A planilha tem data quebrada: "06/052022", "18/05/0202", "13/04/2022".
 * O que não vira data válida entra como nulo — inventar dia é pior que
 * não ter.
 */
function data(v) {
  const s = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (!m) return null;
  let ano = m[3];
  if (ano.length === 2) ano = `20${ano}`;
  if (ano.length !== 4) return null;
  const a = Number(ano), mes = Number(m[2]), d = Number(m[1]);
  if (a < 2000 || a > 2100 || mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  return `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const normalizarPlaca = (v) => String(v || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const placaValida = (p) => /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(p);

const daLista = (v, lista, padrao) => (lista.indexOf(String(v || "")) >= 0 ? String(v) : padrao);

async function banco(url, opcoes) {
  let r;
  try { r = await fetch(url, opcoes); }
  catch (e) { const x = new Error("Não consegui falar com o banco."); x.status = 502; throw x; }
  const corpo = await r.text();
  let dado = null;
  try { dado = corpo ? JSON.parse(corpo) : null; } catch (e) {}
  if (!r.ok) {
    const msg = (dado && (dado.message || dado.hint || dado.details)) || "O banco recusou a gravação.";
    const x = new Error(String(msg));
    x.status = r.status === 401 ? 401 : 502;
    throw x;
  }
  return dado;
}

module.exports = async function handler(req, res) {
  if (!URL_BASE || !ANON) {
    return res.status(500).json({ erro: "SUPABASE_URL ou SUPABASE_ANON_KEY não configurados." });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ erro: "Use POST." });
  }

  const tok = tokenDe(req);
  if (!tok) return res.status(401).json({ erro: "Sessão expirada. Entre de novo." });

  let corpo = req.body;
  if (corpo && typeof Buffer !== "undefined" && Buffer.isBuffer(corpo)) corpo = corpo.toString("utf8");
  if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
  const linhas = corpo && Array.isArray(corpo.linhas) ? corpo.linhas : null;
  if (!linhas || !linhas.length) return res.status(400).json({ erro: "Nenhuma linha para importar." });
  if (linhas.length > TETO) return res.status(413).json({ erro: `Máximo de ${TETO} linhas por vez.` });

  try {
    /* ---- 1. atendimentos ---- */
    const atendimentos = linhas.map((l) => ({
      data: data(l.data),
      negociador_nome: texto(l.negociador_nome),
      prospec: texto(l.prospec),
      cliente_nome: texto(l.cliente_nome),
      cliente_telefone: texto(l.cliente_telefone),
      origem: daLista(l.origem, ORIGENS, "outro"),
      status: daLista(l.status, STATUS, "aberto"),
      carro_descricao: texto(l.carro_descricao),
      pretensao: decimal(l.pretensao),
      observacoes: texto(l.observacoes),
    }));

    const criados = await banco(REST("atendimento"), {
      method: "POST",
      headers: json(tok, { Prefer: "return=representation" }),
      body: JSON.stringify(atendimentos),
    });
    if (!Array.isArray(criados) || criados.length !== linhas.length) {
      return res.status(502).json({ erro: "O banco devolveu quantidade diferente do que foi enviado. Nada mais foi gravado." });
    }

    /* ---- 2. veículos, só onde a placa é válida ---- */
    const veiculos = [];
    linhas.forEach((l, i) => {
      const placa = normalizarPlaca(l.placa);
      if (!placaValida(placa)) return;
      const anos = String(l.ano || "").split("/").map((x) => inteiro(x));
      veiculos.push({
        atendimento_id: criados[i].id,
        placa,
        marca_modelo: texto(l.carro_descricao),
        ano_fabricacao: anos[0] || null,
        ano_modelo: anos[1] || anos[0] || null,
        km_atual: inteiro(l.km),
        fipe_valor: decimal(l.fipe),
      });
    });
    if (veiculos.length) {
      await banco(REST("veiculo"), { method: "POST", headers: json(tok), body: JSON.stringify(veiculos) });
    }

    /* ---- 3. propostas ---- */
    const propostas = [];
    linhas.forEach((l, i) => {
      (l.propostas || []).forEach((p) => {
        const valor = decimal(p.valor);
        if (valor == null) return;
        propostas.push({
          atendimento_id: criados[i].id,
          lojista: texto(p.lojista) || "não informado",
          valor,
        });
      });
    });
    if (propostas.length) {
      await banco(REST("proposta"), { method: "POST", headers: json(tok), body: JSON.stringify(propostas) });
    }

    return res.status(201).json({
      ok: true,
      atendimentos: criados.length,
      veiculos: veiculos.length,
      propostas: propostas.length,
      sem_data: atendimentos.filter((a) => !a.data).length,
      sem_placa: linhas.length - veiculos.length,
    });
  } catch (e) {
    return res.status(e.status || 500).json({ erro: String(e.message) || "Falha na importação." });
  }
};
