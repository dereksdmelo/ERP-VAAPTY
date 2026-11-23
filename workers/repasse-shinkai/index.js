/* Repasse de erp.shinkai.com.br para o ERP (23/11/2026).
 *
 * Roda NA CONTA DO SHINKAI (onde está a zona shinkai.com.br), numa rota `erp.shinkai.com.br/*`.
 * O ERP continua no Worker `vaapty-erp` da conta do Derek; este só repassa a requisição inteira.
 *
 * O IP e o local de quem acessa vão em `x-erp-ip` / `x-erp-geo`, porque no repasse o ERP veria o IP
 * deste Worker — e o IP é evidência da assinatura eletrônica. O ERP só acredita neles com o segredo
 * `ERP_SEGREDO`, que precisa ser o MESMO valor do `ERP_PROXY_SEGREDO` do lado do ERP.
 *
 * Publicar: Workers → Create → colar este arquivo; Settings → Variables → Secret `ERP_SEGREDO`;
 * Settings → Domains & Routes → Custom domain `erp.shinkai.com.br`.
 */
const ERP = "https://vaapty-erp.dereksdmelo.workers.dev";

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    const alvo = new URL(u.pathname + u.search, ERP);
    const h = new Headers(request.headers);
    const c = request.cf || {};
    h.set("x-erp-proxy", env.ERP_SEGREDO || "");
    h.set("x-erp-ip", request.headers.get("cf-connecting-ip") || "");
    h.set("x-erp-geo", encodeURIComponent(JSON.stringify({ city: c.city, regionCode: c.regionCode, country: c.country })));
    h.delete("host");
    const temCorpo = !["GET", "HEAD"].includes(request.method);
    return fetch(alvo, { method: request.method, headers: h, body: temCorpo ? request.body : null, redirect: "manual" });
  },
};
