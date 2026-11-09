/* ===================== NFS-e NACIONAL (0138) =====================
 *
 * A nota fiscal de serviço direto na API nacional (Sefin Nacional), sem intermediária. O Derek, em
 * 09/11/2026: "não dá pra criar a nossa própria PlugNotas?" — Joinville emite só pelo Emissor Nacional
 * desde 20/07/2026, e o padrão nacional vale para todo município.
 *
 * Três passos, e só o terceiro sai do servidor:
 *   1. montarDps(): a declaração (DPS) no leiaute nacional, sem espaço nem quebra entre as tags —
 *      assim o texto já é a forma canônica, e a assinatura não depende de biblioteca de C14N;
 *   2. assinar(): XMLDSig envelopado sobre o infDPS, RSA-SHA256, pelo WebCrypto do próprio Worker;
 *   3. enviar(): o XML assinado, em GZip e Base64, por POST JSON, pela conexão mTLS com o A1.
 *
 * O certificado nunca passa pelo banco nem pelo navegador: a chave e o certificado em PEM são segredos
 * do Worker (NFSE_KEY_PEM, NFSE_CERT_PEM) e o mTLS é o binding NFSE_MTLS.
 */

const NS = "http://www.sped.fazenda.gov.br/nfse";
const BASE = {
  // A listagem oficial usa /API/SefinNacional na produção restrita (o /SefinNacional também responde).
  restrita: "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional",
  producao: "https://sefin.nfse.gov.br/SefinNacional",
};

const so = (v) => String(v == null ? "" : v).replace(/\D/g, "");
// Escapa como a C14N escreve: &, < e > no texto; aspas também nos atributos.
/* SÓ LATIN-1 (09/11/2026): o TSString do XSD aceita do "!" ao "ÿ"; travessão, aspas curvas e emoji
 * derrubavam a nota inteira (E1235). Vira o equivalente simples; o resto fora da faixa sai.
 * E as aspas NÃO se escapam no texto: o texto já é a forma canônica (exc-C14N só escapa & < > e \r),
 * e um &quot; aqui mudaria o digest da assinatura. */
const latin1 = (t) => t.replace(/[\u2012-\u2015\u2212]/g, "-").replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
  .replace(/\u2026/g, "...").replace(/[\u2022\u25CF]/g, "-").replace(/\u00A0/g, " ").replace(/[^\u0000-\u00FF]/g, "");
const esc = (v) => latin1(String(v == null ? "" : v)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/\r/g, "&#xD;").replace(/[ \t]{2,}/g, " ").trim();
const tag = (nome, valor) => (valor == null || valor === "" ? "" : `<${nome}>${esc(valor)}</${nome}>`);
const dinheiro = (v) => (Math.round(Number(v) * 100) / 100).toFixed(2);

/* O que o cadastro da empresa precisa ter para a declaração sair. */
function faltaNaEmpresa(e) {
  if (!e) return ["o cadastro inteiro"];
  const f = [];
  if (so(e.cnpj).length !== 14) f.push("CNPJ");
  if (so(e.ibge_municipio).length !== 7) f.push("município (código IBGE)");
  if (!e.opcao_simples) f.push("opção pelo Simples Nacional");
  if (!so(e.servico_ctribnac)) f.push("código do serviço");
  if (e.opcao_simples === "3" && !e.perc_tot_trib_sn) f.push("percentual de tributos do Simples (para a nota)");
  // O XSD aceita de 0 a 99,99 (pTotTribSN). 100,00 foi o primeiro teste (09/11/2026): E1235, a nota inteira recusada.
  if (e.opcao_simples === "3" && e.perc_tot_trib_sn && !(Number(e.perc_tot_trib_sn) >= 0 && Number(e.perc_tot_trib_sn) < 100))
    f.push(`percentual de tributos do Simples válido (está ${String(e.perc_tot_trib_sn).replace(".", ",")}%; a Receita aceita de 0 a 99,99 — confira com o contador)`);
  return f;
}

/* ---------------- a declaração (DPS, leiaute 1.01) ----------------
 * As regras são as do Anexo I e do XSD 1.01 (09/11/2026): ordem fixa dos elementos (E1235), sem
 * prefixo de namespace (E1228), tpEmit 1, nDPS sem zero à esquerda, série 1–49999 em software próprio,
 * dhEmi no fuso de hora cheia e nunca no futuro (E0008), e o totTrib que o regime manda. */
const pad = (v, n) => String(v).padStart(n, "0");
function dhAgora(d) {
  // Hora de Joinville (UTC−3, sem horário de verão desde 2019), um minuto antes para absorver relógio.
  const t = new Date(d.getTime() - 60000 - 3 * 3600000);
  return `${t.toISOString().slice(0, 19)}-03:00`;
}
function idDps(cLocEmi, cnpj, serie, numero) {
  return `DPS${pad(so(cLocEmi), 7)}2${pad(so(cnpj), 14)}${pad(so(serie), 5)}${pad(String(numero), 15)}`;
}
function montarDps(e, n, serie, numero, agora) {
  const cLoc = so(e.ibge_municipio);
  const id = idDps(cLoc, e.cnpj, serie, numero);
  const dh = dhAgora(agora || new Date());
  const amb = n.ambiente === "producao" ? "1" : "2";
  const op = String(e.opcao_simples || "1");
  const regTrib = `<regTrib><opSimpNac>${op}</opSimpNac>${op === "3" ? `<regApTribSN>${esc(e.regime_apuracao_sn || "1")}</regApTribSN>` : ""}` +
    `<regEspTrib>${esc(op === "2" ? "0" : (e.regime_especial || "0"))}</regEspTrib></regTrib>`;
  const docT = so(n.tomador_doc);
  const endT = n.tomador_tipo === "cnpj" || so(n.tomador_cep)
    ? `<end><endNac><cMun>${esc(so(n.tomador_cmun) || cLoc)}</cMun><CEP>${esc(so(n.tomador_cep))}</CEP></endNac>` +
      `${tag("xLgr", n.tomador_logradouro)}${tag("nro", n.tomador_numero || "S/N")}${tag("xBairro", n.tomador_bairro)}</end>`
    : "";
  const toma = `<toma>${n.tomador_tipo === "cnpj" ? tag("CNPJ", docT) : tag("CPF", docT)}${tag("xNome", n.tomador_nome)}${endT}${tag("email", n.tomador_email)}</toma>`;
  // totTrib: não optante → valores; ME/EPP → percentual do Simples; MEI → indicador 0 (E0710–E0713).
  const totTrib = op === "3" ? `<totTrib><pTotTribSN>${Number(String(e.perc_tot_trib_sn).replace(",", ".")).toFixed(2)}</pTotTribSN></totTrib>`
    : op === "2" ? "<totTrib><indTotTrib>0</indTotTrib></totTrib>"
    : "<totTrib><vTotTrib><vTotTribFed>0.00</vTotTribFed><vTotTribEst>0.00</vTotTribEst><vTotTribMun>0.00</vTotTribMun></vTotTrib></totTrib>";
  // Sem pAliq: com o convênio do município ativo (Joinville, desde 20/07/2026) ele é proibido sem
  // retenção (E0617, E0625, E0635). Retenção pelo tomador não é emitida por aqui ainda.
  const xml = `<DPS xmlns="${NS}" versao="1.01"><infDPS Id="${id}">` +
    `<tpAmb>${amb}</tpAmb><dhEmi>${dh}</dhEmi><verAplic>VAAPTY-ERP-1.0</verAplic>` +
    `<serie>${esc(String(Number(so(serie))))}</serie><nDPS>${esc(String(numero))}</nDPS><dCompet>${dh.slice(0, 10)}</dCompet>` +
    `<tpEmit>1</tpEmit>` +
    // finNFSe (09/11/2026): o servidor (SefinNacional 1.6) já usa o leiaute da reforma tributária e exige a
    // finalidade logo depois do tpEmit — 0 é a NFS-e regular. O XSD 1.01 que serviu de base ainda não o tinha.
    `<finNFSe>0</finNFSe><cLocEmi>${cLoc}</cLocEmi>` +
    `<prest><CNPJ>${so(e.cnpj)}</CNPJ>${tag("IM", e.inscricao_municipal)}${regTrib}</prest>` +
    toma +
    `<serv><locPrest><cLocPrestacao>${cLoc}</cLocPrestacao></locPrest><cServ><cTribNac>${pad(so(e.servico_ctribnac), 6)}</cTribNac>` +
    `${tag("xDescServ", n.descricao)}</cServ></serv>` +
    `<valores><vServPrest><vServ>${dinheiro(n.valor)}</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun>${totTrib}</trib></valores>` +
    `</infDPS></DPS>`;
  return { xml, id };
}

/* ---------------- assinatura ---------------- */

const pemCorpo = (pem, rotulo) => {
  const m = new RegExp(`-----BEGIN ${rotulo}-----([\\s\\S]*?)-----END ${rotulo}-----`).exec(String(pem || ""));
  if (!m) throw new Error(`Segredo do certificado fora do formato (${rotulo} em PEM).`);
  return m[1].replace(/\s+/g, "");
};
const b64ParaBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesParaB64 = (buf) => { const u = new Uint8Array(buf); let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const sha256B64 = async (texto) => bytesParaB64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto)));

async function chavePrivada(keyPem) {
  // PKCS#8 ("PRIVATE KEY"). A chave em PKCS#1 ("RSA PRIVATE KEY") se converte uma vez, na instalação.
  const der = b64ParaBytes(pemCorpo(keyPem, "PRIVATE KEY"));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/* XMLDSig envelopado: Reference ao Id do infDPS, transforms enveloped + C14N, RSA-SHA256 e SHA-256.
 * Como o XML é gerado sem espaços e sem prefixos, o infDPS canônico é o próprio texto com o namespace
 * do DPS trazido para ele (a C14N copia o xmlns em uso do ancestral). */
async function assinar(xml, id, keyPem, certPem, alg) {
  const A = alg || {};
  // C14N EXCLUSIVA: a inclusiva (do manual de 2022) é recusada hoje com E0714. Como o infDPS usa o
  // namespace padrão do DPS, a forma exclusiva o declara no próprio infDPS — é o que a linha abaixo faz.
  const C14N = A.c14n || "http://www.w3.org/2001/10/xml-exc-c14n#";
  const ini = xml.indexOf("<infDPS"), fim = xml.indexOf("</infDPS>") + "</infDPS>".length;
  if (ini < 0 || fim < ini) throw new Error("DPS sem infDPS.");
  const inf = xml.slice(ini, fim).replace(/^<infDPS /, `<infDPS xmlns="${NS}" `);
  const digest = await sha256B64(inf);
  const signedInfo = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform></Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`;
  const chave = await chavePrivada(keyPem);
  const assinatura = bytesParaB64(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, new TextEncoder().encode(signedInfo)));
  const cert = pemCorpo(certPem, "CERTIFICATE");
  const sig = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfo.replace(' xmlns="http://www.w3.org/2000/09/xmldsig#"', "")}` +
    `<SignatureValue>${assinatura}</SignatureValue><KeyInfo><X509Data><X509Certificate>${cert}</X509Certificate></X509Data></KeyInfo></Signature>`;
  return xml.replace("</infDPS>", "</infDPS>" + sig);
}

/* ---------------- envio ---------------- */

async function gzipB64(texto) {
  const fluxo = new Blob([new TextEncoder().encode(texto)]).stream().pipeThrough(new CompressionStream("gzip"));
  return bytesParaB64(await new Response(fluxo).arrayBuffer());
}
async function gunzipTexto(b64) {
  const fluxo = new Blob([b64ParaBytes(b64)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(fluxo).text();
}

async function enviar(xmlAssinado, ambiente, mtls) {
  if (!mtls || typeof mtls.fetch !== "function") throw new Error("A conexão com o certificado (mTLS) não está configurada no servidor.");
  const corpo = JSON.stringify({ dpsXmlGZipB64: await gzipB64(`<?xml version="1.0" encoding="UTF-8"?>${xmlAssinado}`) });
  const r = await mtls.fetch(`${BASE[ambiente] || BASE.restrita}/nfse`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: corpo,
    signal: AbortSignal.timeout(30000),
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) { j = null; }
  if (r.ok && j && j.chaveAcesso) {
    const nfseXml = j.nfseXmlGZipB64 ? await gunzipTexto(j.nfseXmlGZipB64).catch(() => null) : null;
    const numero = nfseXml ? ((/<nNFSe>(\d+)<\/nNFSe>/.exec(nfseXml) || [])[1] || null) : null;
    return { ok: true, status: r.status, chave: j.chaveAcesso, numero, nfseXml, resposta: j };
  }
  // As chaves vêm com maiúscula na rejeição (Codigo/Descricao), apesar do Swagger dizer o contrário.
  const erros = (j && (j.erros || j.Erros || j.erro)) || [{ descricao: (txt || "").slice(0, 400) || `HTTP ${r.status}` }];
  return { ok: false, status: r.status, erros: (Array.isArray(erros) ? erros : [erros]).map((x) => ({
    codigo: x.Codigo || x.codigo || null,
    // O "Complemento" é o que diz QUAL elemento falhou (E1235 sozinho é só "falha no esquema").
    descricao: [x.Descricao || x.descricao || x.mensagem || "", x.Complemento || x.complemento || ""].filter(Boolean).join(" — ") || JSON.stringify(x) })),
    bruto: (txt || "").slice(0, 2000) };
}

module.exports = { NS, BASE, faltaNaEmpresa, montarDps, idDps, dhAgora, assinar, enviar, gzipB64, gunzipTexto, esc, tag, dinheiro, so };
