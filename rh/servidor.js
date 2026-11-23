/**
 * O RH (0174, decisão 80): vagas, candidatos, DISC e retenção.
 *
 * **Mora fora de `api/`** porque lá dentro seria a 13ª função — e o teto é 12 (CLAUDE.md). É chamado pelo
 * `api/perfil.js` (`?recurso=rh` e `?recurso=rh-publico`), o arquivo das pessoas da casa. O arquivo do currículo
 * (que precisa da chave de serviço no Storage) fica no `api/foto.js`, como todo arquivo (decisão 9).
 *
 * Duas portas:
 *  - `rhPublico` — a página "Trabalhe conosco" (trabalhe.html), sem login. Só chama as funções estreitas da 0174
 *    pela chave anônima; nada aqui lê uma tabela do RH direto.
 *  - `rh` — a tela do ERP, com o token de quem está logado. Quem decide o que a pessoa lê é a RLS (`e_rh()`).
 */
const crypto = require("crypto");
const DISC = require("../regras/disc.js");

const base = () => (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const anon = () => process.env.SUPABASE_ANON_KEY || "";
const REST = (t) => `${base()}/rest/v1/${t}`;
const RX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hashDe = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const texto = (v, n) => { const t = String(v == null ? "" : v).trim(); return t ? t.slice(0, n || 500) : null; };
const franquiaDoLink = (v) => { const s = String(v || "").trim().toLowerCase(); return /^[a-z0-9-]{2,60}$/.test(s) ? s : null; };

function erro(status, msg) { const e = new Error(msg); e.status = status; return e; }

async function corpo(req) {
  let c = req.body;
  if (c && typeof Buffer !== "undefined" && Buffer.isBuffer(c)) c = c.toString("utf8");
  if (typeof c === "string") { try { c = JSON.parse(c); } catch (e) { c = null; } }
  return c && typeof c === "object" ? c : {};
}

async function rpcAnon(nome, args) {
  const r = await fetch(`${base()}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: anon(), Authorization: `Bearer ${anon()}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) {
    // A mensagem do banco ("informe o nome") é a que a pessoa precisa ler; o resto não sai.
    let m = ""; try { m = JSON.parse(t).message || ""; } catch (e) {}
    throw erro(r.status === 400 ? 400 : 502, /^[\p{L} ,.'-]{3,80}$/u.test(m) ? m[0].toUpperCase() + m.slice(1) + "." : "Não consegui registrar agora.");
  }
  try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
}

// Ida ao banco com o token de quem está logado.
async function banco(tok, url, op) {
  const o = op || {};
  const r = await fetch(url, {
    ...o,
    headers: { apikey: anon(), Authorization: tok, ...(o.body ? { "Content-Type": "application/json" } : {}), ...(o.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw erro(r.status === 401 ? 401 : r.status === 403 ? 403 : 502, r.status === 401 ? "Sessão expirada. Entre de novo." : "O banco recusou a operação.");
  try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
}

function idDoToken(tok) {
  try {
    const meio = String(tok).replace(/^Bearer\s+/, "").split(".")[1];
    return JSON.parse(Buffer.from(meio.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")).sub || null;
  } catch (e) { return null; }
}

async function quemSou(tok) {
  const id = idDoToken(tok);
  if (!id || !RX_UUID.test(id)) return { id: null, nome: null };
  const r = await banco(tok, `${REST("perfil")}?select=id,nome&id=eq.${id}&limit=1`).catch(() => null);
  return { id, nome: (Array.isArray(r) && r[0] && r[0].nome) || null };
}

/* ============================== a página pública ============================== */

async function rhPublico(req, res) {
  const acao = String(req.query.acao || "");

  if (req.method === "GET" && acao === "vagas") {
    const v = await rpcAnon("rh_vagas_publicas", { p_franquia: franquiaDoLink(req.query.f) });
    return res.status(200).json({ vagas: Array.isArray(v) ? v : [] });
  }
  if (req.method === "GET" && acao === "disc") {
    return res.status(200).json({ perguntas: DISC.perguntas() });
  }
  if (req.method === "GET" && acao === "token") {
    const t = String(req.query.t || "");
    if (t.length < 20) return res.status(400).json({ erro: "Link inválido." });
    const r = await rpcAnon("rh_token", { p_token_hash: hashDe(t) });
    const l = Array.isArray(r) ? r[0] : r;
    if (!l) return res.status(404).json({ erro: "Este link venceu. Peça um novo à Vaapty." });
    return res.status(200).json({ primeiro_nome: l.primeiro_nome, disc_feito: !!l.disc_feito });
  }

  if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); return res.status(405).json({ erro: "método" }); }
  const c = await corpo(req);

  if (acao === "candidatar") {
    const d = c.dados && typeof c.dados === "object" ? c.dados : {};
    if (!texto(d.nome)) return res.status(400).json({ erro: "Informe o seu nome." });
    if (!texto(d.telefone) && !texto(d.email)) return res.status(400).json({ erro: "Informe o WhatsApp ou o e-mail." });
    if (!c.consentimento) return res.status(400).json({ erro: "Marque que autoriza a Vaapty a guardar os seus dados." });
    const token = crypto.randomBytes(32).toString("base64url");
    const id = await rpcAnon("rh_candidatar", { p_token_hash: hashDe(token), p_franquia: franquiaDoLink(c.franquia), p_dados: d });
    if (!id) return res.status(502).json({ erro: "Não consegui registrar agora." });
    // As respostas do formulário (0175): a pergunta como a pessoa leu e o que respondeu, textos curtos.
    const resp = (Array.isArray(d.respostas) ? d.respostas : []).slice(0, 80)
      .map((x) => ({ p: texto(x && x.p, 300), r: texto(x && x.r, 2000) })).filter((x) => x.p && x.r);
    if (resp.length) await rpcAnon("rh_candidatar_respostas", { p_token_hash: hashDe(token), p_respostas: resp }).catch(() => {});
    // O token volta UMA vez, para o currículo e o DISC subirem em seguida. O banco guarda só o hash.
    return res.status(200).json({ ok: true, token });
  }

  if (acao === "disc") {
    const token = String(c.token || "");
    const r = DISC.calcular(c.respostas);
    if (!r) return res.status(400).json({ erro: "Marque uma palavra em MAIS e outra em MENOS em todas as linhas." });
    const ok = await rpcAnon("rh_disc_gravar", {
      p_token_hash: hashDe(token), p_d: r.D, p_i: r.I, p_s: r.S, p_c: r.C, p_perfil: r.perfil, p_respostas: c.respostas,
    });
    if (ok !== true) return res.status(403).json({ erro: "Este link venceu. Peça um novo à Vaapty." });
    const p = r.perfil.split("");
    return res.status(200).json({
      ok: true, D: r.D, I: r.I, S: r.S, C: r.C, perfil: r.perfil,
      fatores: p.map((f) => ({ f, ...DISC.FATORES[f] })),
    });
  }

  return res.status(400).json({ erro: "ação desconhecida" });
}

/* ================================ a tela do ERP ================================ */

const CAMPOS_VAGA = ["titulo", "setor", "descricao", "requisitos", "oferecemos", "modalidade", "perfil_disc", "aberta", "publica", "perguntas"];
const SETORES = ["negociacao", "prevendas", "administrativo", "gestao", "outro"];
const CAMPOS_CAND = ["vaga_id", "nome", "telefone", "email", "cidade", "bairro", "nascimento", "linkedin", "experiencia",
  "formacao", "pretensao", "disponibilidade", "origem", "indicado_por", "etapa", "motivo", "nota", "tags",
  "responsavel_id", "proximo_contato", "entrevista_em", "mensagem"];
const ETAPAS = ["novo", "triagem", "entrevista", "teste", "proposta", "contratado", "banco", "reprovado", "desistiu"];
const ORIGENS = ["site", "indicacao", "instagram", "facebook", "linkedin", "indeed", "whatsapp", "busca_ativa", "colaborador", "outro"];
const ROT_ETAPA = { novo: "Novo", triagem: "Triagem", entrevista: "Entrevista", teste: "Teste prático", proposta: "Proposta",
  contratado: "Contratado", banco: "Banco de talentos", reprovado: "Não seguiu", desistiu: "Desistiu" };
const LISTA_CAND = "id,vaga_id,nome,telefone,email,cidade,bairro,nascimento,origem,indicado_por,etapa,motivo,nota,tags," +
  "responsavel_id,proximo_contato,entrevista_em,disc_d,disc_i,disc_s,disc_c,disc_perfil,disc_em,colaborador_id," +
  "pretensao,disponibilidade,criado_em,atualizado_em";

function limparVaga(c) {
  const m = {};
  CAMPOS_VAGA.forEach((k) => { if (c[k] !== undefined) m[k] = c[k]; });
  if (m.titulo !== undefined) { m.titulo = texto(m.titulo, 120); if (!m.titulo) throw erro(400, "A vaga precisa de um título."); }
  if (m.setor !== undefined && SETORES.indexOf(m.setor) < 0) m.setor = "outro";
  ["descricao", "requisitos", "oferecemos"].forEach((k) => { if (m[k] !== undefined) m[k] = texto(m[k], 4000); });
  if (m.modalidade !== undefined) m.modalidade = texto(m.modalidade, 120);
  if (m.perfil_disc !== undefined) m.perfil_disc = String(m.perfil_disc || "").toUpperCase().replace(/[^DISC]/g, "").slice(0, 2) || null;
  if (m.aberta !== undefined) m.aberta = !!m.aberta;
  if (m.publica !== undefined) m.publica = !!m.publica;
  // As perguntas próprias da vaga (0175): texto, tipo (texto | sim_nao) e se é obrigatória.
  if (m.perguntas !== undefined) {
    m.perguntas = (Array.isArray(m.perguntas) ? m.perguntas : []).slice(0, 15)
      .map((q) => ({ texto: texto(q && q.texto, 300), tipo: q && q.tipo === "sim_nao" ? "sim_nao" : "texto", obrigatoria: !!(q && q.obrigatoria) }))
      .filter((q) => q.texto);
  }
  return m;
}

function limparCand(c) {
  const m = {};
  CAMPOS_CAND.forEach((k) => { if (c[k] !== undefined) m[k] = c[k]; });
  ["nome", "telefone", "email", "cidade", "bairro", "linkedin", "formacao", "pretensao", "disponibilidade", "indicado_por", "motivo"]
    .forEach((k) => { if (m[k] !== undefined) m[k] = texto(m[k], k === "linkedin" ? 200 : 160); });
  ["experiencia", "mensagem"].forEach((k) => { if (m[k] !== undefined) m[k] = texto(m[k], 4000); });
  if (m.nome === null) throw erro(400, "O candidato precisa de um nome.");
  if (m.email) m.email = m.email.toLowerCase();
  if (m.etapa !== undefined && ETAPAS.indexOf(m.etapa) < 0) throw erro(400, "Etapa desconhecida.");
  if (m.origem !== undefined && ORIGENS.indexOf(m.origem) < 0) m.origem = "outro";
  if (m.nota !== undefined) m.nota = m.nota ? Math.max(1, Math.min(5, Math.round(Number(m.nota)) || 1)) : null;
  if (m.tags !== undefined) m.tags = (Array.isArray(m.tags) ? m.tags : String(m.tags || "").split(","))
    .map((t) => String(t).trim().toLowerCase()).filter(Boolean).slice(0, 12);
  ["vaga_id", "responsavel_id"].forEach((k) => { if (m[k] !== undefined && !RX_UUID.test(String(m[k] || ""))) m[k] = null; });
  ["nascimento", "proximo_contato"].forEach((k) => { if (m[k] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(m[k] || ""))) m[k] = null; });
  if (m.entrevista_em !== undefined && !m.entrevista_em) m.entrevista_em = null;
  return m;
}

async function evento(tok, eu, candidato_id, tipo, txt) {
  await banco(tok, REST("rh_evento"), {
    method: "POST", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ candidato_id, tipo, texto: txt, por: eu.id, por_nome: eu.nome }),
  }).catch(() => {});
}

async function linkDisc(tok, id) {
  const token = crypto.randomBytes(32).toString("base64url");
  // Sete dias: o link do DISC vai pelo WhatsApp e a pessoa responde quando puder.
  const ate = new Date(Date.now() + 7 * 86400000).toISOString();
  const r = await banco(tok, `${REST("rh_candidato")}?id=eq.${id}`, {
    method: "PATCH", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ token_hash: hashDe(token), token_ate: ate }),
  });
  if (!Array.isArray(r) || !r.length) throw erro(404, "Candidato não encontrado.");
  return { token, ate };
}

async function rh(req, res, tok) {
  const acao = String(req.query.acao || "");
  const id = String(req.query.id || "");

  // Quem não é do RH não vê nada pela RLS; dizer isso é melhor que uma tela vazia.
  const pode = await banco(tok, `${base()}/rest/v1/rpc/e_rh`, { method: "POST", body: "{}" }).catch(() => false);
  if (pode !== true) return res.status(403).json({ erro: "O RH é do gerente e de quem tem a marca RH em Equipe." });

  if (req.method === "GET" && acao === "painel") {
    const [vagas, cands, anexos] = await Promise.all([
      banco(tok, `${REST("rh_vaga")}?select=*&order=aberta.desc,criado_em.desc`),
      banco(tok, `${REST("rh_candidato")}?select=${LISTA_CAND}&order=criado_em.desc&limit=2000`),
      banco(tok, `${REST("rh_anexo")}?select=candidato_id&limit=10000`),
    ]);
    const nAnexos = {};
    (anexos || []).forEach((a) => { nAnexos[a.candidato_id] = (nAnexos[a.candidato_id] || 0) + 1; });
    return res.status(200).json({
      vagas: vagas || [],
      candidatos: (cands || []).map((c) => ({ ...c, anexos: nAnexos[c.id] || 0 })),
    });
  }

  if (req.method === "GET" && acao === "candidato") {
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido" });
    const [c, ev] = await Promise.all([
      banco(tok, `${REST("rh_candidato")}?select=*&id=eq.${id}&limit=1`),
      banco(tok, `${REST("rh_evento")}?select=*&candidato_id=eq.${id}&order=em.desc&limit=200`),
    ]);
    const linha = Array.isArray(c) && c[0];
    if (!linha) return res.status(404).json({ erro: "Candidato não encontrado." });
    delete linha.token_hash;
    const notas = linha.disc_em ? { D: linha.disc_d, I: linha.disc_i, S: linha.disc_s, C: linha.disc_c } : null;
    const fatores = linha.disc_perfil ? linha.disc_perfil.split("").map((f) => ({ f, ...DISC.FATORES[f], na_vaapty: DISC.NA_VAAPTY[f] })) : [];
    return res.status(200).json({ candidato: linha, eventos: ev || [], disc: notas ? { notas, fatores } : null });
  }

  const eu = await quemSou(tok);

  if (acao === "vaga") {
    if (req.method === "POST") {
      const m = limparVaga(await corpo(req));
      if (!m.titulo) return res.status(400).json({ erro: "A vaga precisa de um título." });
      const r = await banco(tok, REST("rh_vaga"), { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...m, criado_por: eu.id }) });
      return res.status(200).json({ vaga: Array.isArray(r) ? r[0] : r });
    }
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido" });
    if (req.method === "PATCH") {
      const m = limparVaga(await corpo(req));
      m.atualizado_em = new Date().toISOString();
      const r = await banco(tok, `${REST("rh_vaga")}?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(m) });
      return res.status(200).json({ vaga: Array.isArray(r) ? r[0] : r });
    }
    if (req.method === "DELETE") {
      // Apagar a vaga não apaga ninguém: quem se candidatou fica no banco de talentos, sem vaga.
      await banco(tok, `${REST("rh_vaga")}?id=eq.${id}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }
  }

  if (acao === "candidato") {
    if (req.method === "POST") {
      const c = await corpo(req);
      const m = limparCand(c);
      if (!m.nome) return res.status(400).json({ erro: "O candidato precisa de um nome." });
      if (!m.origem) m.origem = "busca_ativa";
      // A mesma pessoa não entra duas vezes: o telefone (DDD + oito últimos) ou o e-mail acham quem já está.
      const dig = String(m.telefone || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
      if (dig.length >= 10 || m.email) {
        const todos = await banco(tok, `${REST("rh_candidato")}?select=id,nome,telefone,email,etapa&limit=5000`) || [];
        const chave = (t) => { const d = String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, ""); return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : null; };
        const k = dig.length >= 10 ? dig.slice(0, 2) + dig.slice(-8) : null;
        const ja = todos.find((x) => (k && chave(x.telefone) === k) || (m.email && String(x.email || "").toLowerCase() === m.email));
        if (ja) return res.status(409).json({ erro: `${ja.nome} já está no RH (${ROT_ETAPA[ja.etapa] || ja.etapa}).`, id: ja.id });
      }
      const r = await banco(tok, REST("rh_candidato"), { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(m) });
      const linha = Array.isArray(r) ? r[0] : r;
      const como = { indicacao: `Indicado por ${m.indicado_por || "alguém da equipe"}`, busca_ativa: "Encontrado na busca ativa" }[m.origem] || "Cadastrado à mão";
      await evento(tok, eu, linha.id, "candidatura", `${como}${eu.nome ? ` — registrado por ${eu.nome}` : ""}`);
      return res.status(200).json({ candidato: linha });
    }
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido" });
    if (req.method === "PATCH") {
      const c = await corpo(req);
      const m = limparCand(c);
      if (!Object.keys(m).length) return res.status(400).json({ erro: "Nada para gravar." });
      let antes = null;
      if (m.etapa) {
        const a = await banco(tok, `${REST("rh_candidato")}?select=etapa&id=eq.${id}&limit=1`);
        antes = Array.isArray(a) && a[0] ? a[0].etapa : null;
        // "Não seguiu" e "desistiu" pedem o porquê: sem ele, a etapa vira a lixeira e ninguém aprende nada (decisão 27).
        if ((m.etapa === "reprovado" || m.etapa === "desistiu") && antes !== m.etapa && !m.motivo) {
          return res.status(400).json({ erro: "Diga o motivo." });
        }
      }
      m.atualizado_em = new Date().toISOString();
      const r = await banco(tok, `${REST("rh_candidato")}?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(m) });
      const linha = Array.isArray(r) ? r[0] : r;
      if (!linha) return res.status(404).json({ erro: "Candidato não encontrado." });
      delete linha.token_hash; delete linha.disc_respostas;
      if (m.etapa && antes !== m.etapa) {
        await evento(tok, eu, id, "etapa", `${ROT_ETAPA[antes] || antes || "—"} → ${ROT_ETAPA[m.etapa]}${m.motivo ? ` · ${m.motivo}` : ""}`);
      }
      if (m.entrevista_em) await evento(tok, eu, id, "entrevista", `Entrevista marcada para ${new Date(m.entrevista_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`);
      return res.status(200).json({ candidato: linha });
    }
  }

  if (acao === "evento" && req.method === "POST") {
    const c = await corpo(req);
    if (!RX_UUID.test(String(c.candidato_id || ""))) return res.status(400).json({ erro: "candidato inválido" });
    const tipo = ["nota", "ligacao", "whatsapp", "entrevista"].indexOf(c.tipo) >= 0 ? c.tipo : "nota";
    const txt = texto(c.texto, 4000);
    if (!txt) return res.status(400).json({ erro: "Escreva alguma coisa." });
    const r = await banco(tok, REST("rh_evento"), {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ candidato_id: c.candidato_id, tipo, texto: txt, por: eu.id, por_nome: eu.nome }),
    });
    return res.status(200).json({ evento: Array.isArray(r) ? r[0] : r });
  }

  if (acao === "link-disc" && req.method === "POST") {
    if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido" });
    const l = await linkDisc(tok, id);
    await evento(tok, eu, id, "disc", "Link do teste DISC gerado (vale 7 dias)");
    return res.status(200).json(l);
  }

  /* ------------------------------ retenção ------------------------------ */
  if (req.method === "GET" && acao === "equipe") {
    const [pessoas, acomp, cands] = await Promise.all([
      banco(tok, `${base()}/rest/v1/rpc/rh_equipe`, { method: "POST", body: "{}" }),
      banco(tok, `${REST("rh_acompanhamento")}?select=*&order=em.desc&limit=3000`),
      banco(tok, `${REST("rh_candidato")}?select=id,colaborador_id,disc_d,disc_i,disc_s,disc_c,disc_perfil,disc_em,token_ate&colaborador_id=not.is.null`),
    ]);
    return res.status(200).json({ pessoas: pessoas || [], acompanhamentos: acomp || [], discs: cands || [] });
  }

  if (acao === "acompanhamento") {
    if (req.method === "POST") {
      const c = await corpo(req);
      if (!RX_UUID.test(String(c.colaborador_id || ""))) return res.status(400).json({ erro: "colaborador inválido" });
      const tipo = ["conversa", "feedback", "pulso", "elogio", "alerta", "desligamento"].indexOf(c.tipo) >= 0 ? c.tipo : "conversa";
      const n = (v, a, b) => (v === "" || v == null ? null : Math.max(a, Math.min(b, Math.round(Number(v)) || a)));
      const m = {
        colaborador_id: c.colaborador_id, tipo, texto: texto(c.texto, 4000),
        humor: n(c.humor, 1, 5), enps: n(c.enps, 0, 10),
        risco: ["baixo", "medio", "alto"].indexOf(c.risco) >= 0 ? c.risco : null,
        proximo_em: /^\d{4}-\d{2}-\d{2}$/.test(String(c.proximo_em || "")) ? c.proximo_em : null,
        por: eu.id, por_nome: eu.nome,
      };
      if (!m.texto && m.humor == null && m.enps == null && !m.risco) return res.status(400).json({ erro: "Escreva o que foi conversado ou marque o pulso." });
      const r = await banco(tok, REST("rh_acompanhamento"), { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(m) });
      return res.status(200).json({ acompanhamento: Array.isArray(r) ? r[0] : r });
    }
    if (req.method === "DELETE") {
      if (!RX_UUID.test(id)) return res.status(400).json({ erro: "id inválido" });
      await banco(tok, `${REST("rh_acompanhamento")}?id=eq.${id}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }
  }

  /* O DISC DE QUEM JÁ ESTÁ NA CASA. A pessoa vira uma linha do RH ligada à ficha (etapa "contratado", origem
   * "colaborador") — a mesma régua e a mesma tela do candidato, e o resultado aparece na retenção. */
  if (acao === "disc-colaborador" && req.method === "POST") {
    const c = await corpo(req);
    const cid = String(c.colaborador_id || "");
    if (!RX_UUID.test(cid)) return res.status(400).json({ erro: "colaborador inválido" });
    let linha = (await banco(tok, `${REST("rh_candidato")}?select=id&colaborador_id=eq.${cid}&limit=1`) || [])[0];
    if (!linha) {
      const p = ((await banco(tok, `${base()}/rest/v1/rpc/rh_equipe`, { method: "POST", body: "{}" })) || []).find((x) => x.id === cid);
      if (!p) return res.status(404).json({ erro: "Colaborador não encontrado." });
      const r = await banco(tok, REST("rh_candidato"), {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ nome: p.nome || "Colaborador", telefone: p.telefone || null, etapa: "contratado", origem: "colaborador", colaborador_id: cid }),
      });
      linha = Array.isArray(r) ? r[0] : r;
    }
    const l = await linkDisc(tok, linha.id);
    return res.status(200).json({ ...l, candidato_id: linha.id });
  }

  return res.status(400).json({ erro: "ação desconhecida" });
}

module.exports = { rh, rhPublico, ROT_ETAPA };
