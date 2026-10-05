/* O ADAPTADOR (req, res) -> fetch, 29/09/2026.
 *
 * As 12 funcoes em `api/` foram escritas para a Vercel: recebem
 * `(req, res)` do Node e respondem com `res.status(n).json(o)`. Sao
 * 7.265 linhas e 522 chamadas de `res.status` -- reescrever tudo seria
 * o caminho caro, e cada linha reescrita e uma chance de mudar
 * comportamento sem querer.
 *
 * Entao nao se reescreve nada: este arquivo monta um `req` e um `res`
 * de mentira a partir do `Request` do Worker, chama o handler como
 * ele esta, e devolve a `Response` que o `res` acumulou. **Os handlers
 * continuam rodando na Vercel sem alteracao nenhuma** -- e e isso que
 * permite manter os dois lados no ar durante a travessia.
 *
 * Quem mexer aqui lembra: o contrato a imitar e o da Vercel, nao um
 * contrato novo. Toda diferenca entre este `res` e o de la vira um bug
 * que so aparece numa rota especifica, em producao.
 */
import atendimento from "../api/atendimento.js";
import checklist from "../api/checklist.js";
import documento from "../api/documento.js";
import financeiro from "../api/financeiro.js";
import fipe from "../api/fipe.js";
import foto from "../api/foto.js";
import funil from "../api/funil.js";
import importar from "../api/importar.js";
import perfil from "../api/perfil.js";
import placa from "../api/placa.js";
import proposta from "../api/proposta.js";
import veiculo from "../api/veiculo.js";

const ROTAS = { atendimento, checklist, documento, financeiro, fipe, foto,
                funil, importar, perfil, placa, proposta, veiculo };

/* A Vercel entrega o corpo JA parseado quando o content-type diz JSON,
   e como texto quando nao diz. Os handlers contam com isso: nenhum
   deles chama `await req.json()`. */
async function corpoDe(request) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const tipo = request.headers.get("content-type") || "";
  const cru = await request.text();
  if (!cru) return undefined;
  if (tipo.includes("application/json")) {
    try { return JSON.parse(cru); } catch { return cru; }
  }
  return cru;
}

/* O `res` da Vercel, na parte que estes 12 arquivos usam. Guarda o que
   foi dito e so no fim vira `Response` -- porque `res.status()` e
   encadeavel e pode ser chamado antes de se saber o corpo. */
function resposta() {
  const cab = new Headers();
  let codigo = 200, corpo = null, pronto;
  const espera = new Promise((r) => { pronto = r; });
  const fim = () => pronto(new Response(corpo, { status: codigo, headers: cab }));
  const res = {
    status(n) { codigo = n; return res; },
    setHeader(k, v) { cab.set(k, Array.isArray(v) ? v.join(", ") : String(v)); return res; },
    getHeader(k) { return cab.get(k); },
    json(o) { if (!cab.has("content-type")) cab.set("content-type", "application/json; charset=utf-8"); corpo = JSON.stringify(o); fim(); return res; },
    send(x) {
      if (x != null && typeof x === "object" && !(x instanceof ArrayBuffer) && !ArrayBuffer.isView(x)) return res.json(x);
      corpo = x == null ? null : x; fim(); return res;
    },
    end(x) { if (x != null) corpo = x; fim(); return res; },
    redirect(n, url) { if (typeof n === "string") { url = n; n = 302; } codigo = n; cab.set("location", url); corpo = null; fim(); return res; },
  };
  return { res, espera };
}

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const m = /^\/api\/([a-z]+)\/?$/.exec(u.pathname);
    // O que nao e /api/ e arquivo: index.html, assinar.html, verificar.html.
    /* HTML NUNCA FICA EM CACHE NA BORDA.
     *
     * O Cloudflare estava respondendo `cf-cache-status: HIT` para o
     * `index.html` e servindo a versão ANTERIOR depois de cada
     * publicação — por vezes por muitos minutos. O sintoma é o pior
     * possível: a tela parece quebrada ou a mudança parece não ter
     * sido feita, e quem está olhando conclui que o sistema regrediu.
     * Aconteceu três vezes em 05/10/2026, com o Derek e comigo, e as
     * três me fizeram caçar um bug que não existia.
     *
     * **A aplicação inteira é UM arquivo** (decisão 7): servir o
     * anterior é servir o sistema inteiro anterior. `no-store` custa
     * um download de 300 KB por abertura e vale cada byte.
     *
     * O resto dos arquivos continua cacheável — fonte, PDF e as
     * páginas públicas mudam raramente.
     */
    if (!m) {
      const r = await env.ASSETS.fetch(request);
      const tipo = r.headers.get("content-type") || "";
      if (!tipo.includes("text/html")) return r;
      const h = new Headers(r.headers);
      h.set("Cache-Control", "no-store, must-revalidate");
      return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
    }

    const handler = ROTAS[m[1]];
    if (!handler) return Response.json({ erro: "Rota desconhecida." }, { status: 404 });

    /* Os segredos chegam pelo `env` do Worker; os handlers os leem em
       `process.env`. Sao valores do SERVIDOR, iguais para todo mundo --
       nada aqui e de usuario, entao copiar para o global nao repete o
       vazamento entre requisicoes que a decisao 9 proibe (aquele e
       sobre o TOKEN de quem chama, que continua vindo no cabecalho e
       sendo passado como argumento). */
    if (typeof process !== "undefined" && process.env) {
      for (const k in env) if (typeof env[k] === "string") process.env[k] = env[k];
    }

    const query = {};
    for (const [k, v] of u.searchParams) query[k] = v;
    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;

    const req = {
      method: request.method, url: u.pathname + u.search, query, headers,
      body: await corpoDe(request), cookies: {},
      /* A geolocalização da borda, que no Cloudflare NÃO vem em
         cabeçalho. É evidência da assinatura eletrônica (decisão 42),
         e o `localDe` do api/documento.js a lê daqui. */
      cf: request.cf || null,
      /* A PONTE DO WHATSAPP VIAJA COMO BINDING, NÃO COMO ENDEREÇO.
         Worker chamando outro Worker pelo `*.workers.dev` **não sai da
         borda**: o Cloudflare resolve internamente e devolve 404 sem
         que a outra ponta veja a requisição -- conferido em
         01/10/2026, com o tail do outro lado em silêncio enquanto o
         curl de fora respondia 200. O service binding é o caminho
         oficial, e de quebra não passa pela internet. */
      ponte: env.PONTE || null,
    };

    const { res, espera } = resposta();
    try {
      const r = handler(req, res);
      // Handler que estoura DEPOIS de ja ter respondido nao pode virar
      // 500 por cima de uma resposta boa.
      if (r && typeof r.catch === "function") r.catch((e) => { try { res.status(500).json({ erro: String((e && e.message) || e) }); } catch {} });
    } catch (e) {
      return Response.json({ erro: String((e && e.message) || e) }, { status: 500 });
    }
    return espera;
  },
};
