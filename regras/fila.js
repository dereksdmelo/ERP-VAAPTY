/**
 * A RODA DA FILA DA VEZ (0106) — quem pega o próximo cliente.
 *
 * As regras são do Derek, em 03/11/2026, e cada uma tem o seu lugar
 * aqui:
 *
 *  - A ordem é feita no começo do dia pelo ÍNDICE AT e não muda mais;
 *    quem chega depois do primeiro cliente entra no FIM (`circulo`).
 *  - A vez anda em roda: um cliente para cada um, na ordem (`ponteiro`).
 *  - Quem está ATENDENDO na hora da vez dele é pulado — se tiver alguém
 *    livre — e fica DEVENDO a vez (`creditos`). Dez minutos depois de
 *    encerrar o atendimento, ele é o próximo; e depois recebe de novo a
 *    vez normal, quando a roda chegar nele.
 *  - Quem NÃO ESTÁ NA FILA na vez dele (almoço, assunto pessoal, sem
 *    responder o lembrete) perde aquela volta. Não ganha crédito.
 *  - Estando TODOS atendendo, a roda segue igual: o da vez pega o
 *    segundo cliente, o próximo também, até alguém liberar.
 *  - Fora do horário da loja (depois das 18h) a roda só olha quem está
 *    lá, e ninguém "perde" a vez.
 *  - TRANSBORDO (0144): quem está nele só entra na roda quando todos os
 *    outros que estão na fila estão atendendo. Enquanto houver alguém
 *    livre fora do transbordo, ele é passado sem perder a vez e sem
 *    ficar devendo — não é falta dele, é a regra da época.
 *
 * O estado não é gravado: é a soma dos eventos do dia (`fila_evento`),
 * montada por `estadoDosEventos`. Quem lê isto: `api/atendimento.js`
 * (a fila, o "Chegou" e a chamada). `ferramentas-fila.js` guarda os
 * casos.
 */

// Depois de encerrar um atendimento, quanto tempo até a vez devida
// voltar — o Derek: "depois de 10 minutos que ela saiu do atendimento".
const ESPERA_CREDITO_MS = 10 * 60000;
// A chamada ("Vou atender / Passar") vence em três minutos.
const PRAZO_CHAMADA_MS = 3 * 60000;

/**
 * O estado da roda a partir dos eventos do dia, em ordem.
 *   ponteiro: de quem é a vez pela roda (o `prox` do último evento que
 *             mexeu nela);
 *   creditos: { perfil_id: [instante em que ficou devendo, …] }.
 */
function estadoDosEventos(eventos) {
  let ponteiro = null;
  // A vez posta pelo gerente ("pôr a vez aqui") vale ANTES da vez devida:
  // é a correção dele, e só termina quando essa pessoa recebe um cliente
  // (10/11/2026: o Dimas devia uma vez e passava na frente do André
  // Ricardo mesmo depois da correção).
  let forcado = null;
  const creditos = {};
  const dar = (id, t) => { (creditos[id] = creditos[id] || []).push(t); };
  const tirar = (id) => { if (creditos[id] && creditos[id].length) creditos[id].shift(); };
  // O gerente tira uma vez devolvida por engano: sai a mais recente.
  const desfazer = (id) => { if (creditos[id] && creditos[id].length) creditos[id].pop(); };
  (eventos || []).slice().sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em))).forEach((e) => {
    const t = Date.parse(e.criado_em) || 0;
    if (e.tipo === "credito" && e.via === "tirar") desfazer(e.perfil_id);
    else if (e.tipo === "pulou" || e.tipo === "credito") dar(e.perfil_id, t);
    if (e.tipo === "vez" && e.via === "credito") tirar(e.perfil_id);
    if (e.tipo === "correcao") forcado = e.perfil_id;
    if (e.tipo === "vez") forcado = null;
    if (e.prox) ponteiro = e.prox;
  });
  return { ponteiro, creditos, forcado };
}

/**
 * A ORDEM DO DIA. `congelada` é a lista gravada no primeiro cliente
 * (fila_dia); antes disso não há lista, e a ordem é a do índice de
 * agora. Quem não está na lista congelada entra no fim, pela hora em
 * que chegou.
 *   pessoas: [{ perfil_id, indice_at, indice_anterior, chegou_em }]
 */
function circuloDoDia(pessoas, congelada) {
  const porIndice = (a, b) => (b.indice_at - a.indice_at) || (b.indice_anterior - a.indice_anterior) ||
    (Date.parse(a.chegou_em) - Date.parse(b.chegou_em));
  if (!congelada || !congelada.length) return pessoas.slice().sort(porIndice).map((p) => p.perfil_id);
  const base = congelada.map((x) => x.perfil_id).filter((id) => pessoas.some((p) => p.perfil_id === id));
  const novos = pessoas.filter((p) => base.indexOf(p.perfil_id) < 0)
    .sort((a, b) => Date.parse(a.chegou_em) - Date.parse(b.chegou_em)).map((p) => p.perfil_id);
  return base.concat(novos);
}

/**
 * QUEM PEGA O PRÓXIMO CLIENTE.
 *   est: { circulo, pessoas: { id: { presente, atendendo, fim_ultimo } },
 *          ponteiro, creditos, aberto, agora }
 *   excluir: quem já passou este cliente.
 * Devolve { quem, via, pulos: [{ perfil_id, motivo }], prox } ou null.
 */
function escolher(est, excluir) {
  const fora = excluir || [];
  const C = (est.circulo || []).filter((id) => est.pessoas[id]);
  if (!C.length) return null;
  const P = (id) => est.pessoas[id];
  const tb = est.transbordo || [];
  // Alguém fora do transbordo está livre? Então o transbordo espera.
  const livreNormal = C.some((id) => fora.indexOf(id) < 0 && tb.indexOf(id) < 0 && P(id).presente && !P(id).atendendo);
  const segura = livreNormal ? tb : [];
  const pode = (id) => fora.indexOf(id) < 0 && segura.indexOf(id) < 0;
  const presentes = C.filter((id) => pode(id) && P(id).presente);
  if (!presentes.length) return null;
  const livres = presentes.filter((id) => !P(id).atendendo);
  const ponteiro = C.indexOf(est.ponteiro) >= 0 ? est.ponteiro : C[0];

  // 0. A vez que o gerente pôs: é dela, enquanto ela estiver na fila.
  if (est.forcado && C.indexOf(est.forcado) >= 0 && fora.indexOf(est.forcado) < 0 && P(est.forcado).presente) {
    const j = C.indexOf(est.forcado);
    return { quem: est.forcado, via: "correcao", pulos: [], prox: C[(j + 1) % C.length] };
  }

  // 1. A vez devida: livre há pelo menos dez minutos, quem ficou devendo
  // primeiro. Não mexe na roda — a vez normal dele continua lá.
  const devidos = livres.filter((id) => (est.creditos[id] || []).length &&
    est.agora - (P(id).fim_ultimo || 0) >= ESPERA_CREDITO_MS)
    .sort((a, b) => est.creditos[a][0] - est.creditos[b][0]);
  if (devidos.length) return { quem: devidos[0], via: "credito", pulos: [], prox: ponteiro };

  // 2. A roda.
  const i = C.indexOf(ponteiro);
  const pulos = [];
  for (let k = 0; k < C.length; k++) {
    const id = C[(i + k) % C.length];
    if (!pode(id)) continue;
    const p = P(id);
    if (!p.presente) { pulos.push({ perfil_id: id, motivo: est.aberto ? "ausente" : "fora_do_horario" }); continue; }
    if (p.atendendo && livres.length) { pulos.push({ perfil_id: id, motivo: "ocupado" }); continue; }
    return { quem: id, via: livres.length ? "roda" : "todos_ocupados", pulos, prox: C[(i + k + 1) % C.length] };
  }
  return null;
}

/** O estado depois de dar o cliente a quem `escolher` apontou. */
function aplicar(est, e) {
  if (!e) return est;
  const pessoas = { ...est.pessoas };
  pessoas[e.quem] = { ...pessoas[e.quem], atendendo: (pessoas[e.quem].atendendo || 0) + 1 };
  const creditos = {};
  Object.keys(est.creditos || {}).forEach((k) => { creditos[k] = est.creditos[k].slice(); });
  if (e.via === "credito") (creditos[e.quem] || []).shift();
  e.pulos.filter((x) => x.motivo === "ocupado").forEach((x) => { (creditos[x.perfil_id] = creditos[x.perfil_id] || []).push(est.agora); });
  return { ...est, pessoas, creditos, ponteiro: e.prox, forcado: e.via === "correcao" ? null : est.forcado };
}

/** A loja está atendendo agora? `cfg` é a linha da config_loja. */
function horarioAberto(cfg, agoraMs) {
  const d = new Date(agoraMs);
  const parede = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const dow = parede.getDay();
  const g = dow === 0 ? "domingo" : dow === 6 ? "sabado" : "semana";
  const PADRAO = { semana: ["08:30", "18:00"], sabado: ["09:00", "13:00"], domingo: [null, null] };
  const hm = (v) => (v ? String(v).slice(0, 5) : null);
  const abre = cfg ? hm(cfg[`${g}_abre`]) : PADRAO[g][0];
  const fecha = cfg ? hm(cfg[`${g}_ultimo`]) : PADRAO[g][1];
  if (!abre || !fecha) return false;
  const agora = `${String(parede.getHours()).padStart(2, "0")}:${String(parede.getMinutes()).padStart(2, "0")}`;
  return agora >= abre && agora <= fecha;
}

/**
 * QUEM ESTÁ NO TRANSBORDO HOJE. À mão manda ('dentro' / 'fora'); sem
 * marca, o gatilho: ligado, dentro dos dias do mês (se houver), com o
 * mínimo de atendimentos, e a conversão do mês ATÉ ONTEM abaixo do corte
 * — até ontem, para ninguém entrar e sair no meio do dia.
 *   cfg: config_loja; p: { fluxo_ate_ontem, conversao_ate_ontem };
 *   marca: linha de fila_transbordo ou null; dia: 1..31.
 * Devolve { em, como: 'manual' | 'auto' | null }.
 */
function noTransbordo(cfg, p, marca, dia) {
  if (marca && marca.modo === "dentro") return { em: true, como: "manual" };
  if (marca && marca.modo === "fora") return { em: false, como: "manual" };
  if (!cfg || !cfg.transbordo_auto) return { em: false, como: null };
  const de = cfg.transbordo_dia_de, ate = cfg.transbordo_dia_ate;
  if (de && ate) {
    const dentro = de <= ate ? dia >= de && dia <= ate : dia >= de || dia <= ate;
    if (!dentro) return { em: false, como: null };
  } else if (de && dia < de) return { em: false, como: null };
  else if (ate && dia > ate) return { em: false, como: null };
  // "até agora" (0149) conta também o dia de hoje: reage ao carro que fechou
  // hoje, e por isso pode mudar no meio do expediente.
  const agora = cfg.transbordo_base === "agora";
  const fluxo = agora ? p.fluxo_ate_agora : p.fluxo_ate_ontem;
  const conv = agora ? p.conversao_ate_agora : p.conversao_ate_ontem;
  const minimo = Number(cfg.transbordo_minimo) || 0;
  if ((fluxo || 0) < Math.max(1, minimo)) return { em: false, como: null };
  const corte = Number(cfg.transbordo_abaixo);
  if (!(corte > 0)) return { em: false, como: null };
  return (conv || 0) < corte ? { em: true, como: "auto" } : { em: false, como: null };
}

module.exports = { noTransbordo, ESPERA_CREDITO_MS, PRAZO_CHAMADA_MS, estadoDosEventos, circuloDoDia, escolher, aplicar, horarioAberto };
