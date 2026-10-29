/* AS MENSAGENS AO LOJISTA (0092, 28/10/2026).
 *
 * Um lugar só para o texto, porque duas pontas mandam: o clique de quem
 * confirma a venda (boas-vindas e CRLV, em api/checklist.js) e o cron dos
 * lembretes de prazo (ia/lojistas.js). Duas cópias do mesmo recado
 * divergiriam no primeiro ajuste de redação.
 *
 * O prazo é de 3 meses a partir da venda (o Derek). Datas são escritas
 * como Joinville lê, dd/mm/aaaa, a partir de "aaaa-mm-dd" sem converter
 * fuso — a mesma régua da hora de parede (decisão 51).
 */
const dataBR = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
function prazoDe(vendidoEm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(vendidoEm || ""));
  if (!m) return "";
  // Como o `+ interval '3 months'` do Postgres: dia que não existe no
  // mês de chegada vira o último dia dele (30/11 → 28/02), e não
  // transborda para o mês seguinte, como faria o Date.
  const ano = Number(m[1]), mes = Number(m[2]) - 1 + 3, dia = Number(m[3]);
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes, Math.min(dia, ultimo))).toISOString().slice(0, 10);
}
const primeiroNome = (n) => {
  const s = String(n || "").trim();
  return s ? s : "";
};
const FALTA = { d2m: "Faltam 2 meses", d1m: "Falta 1 mês", d2s: "Faltam 2 semanas", d1s: "Falta 1 semana" };

function textoLojista(tipo, x, site) {
  const ola = primeiroNome(x.nome) ? `Olá, ${primeiroNome(x.nome)}!` : "Olá!";
  const carro = [String(x.carro || "").trim(), x.placa ? `placa ${x.placa}` : ""].filter(Boolean).join(", ");
  const prazo = dataBR(x.prazo || prazoDe(x.vendido_em));
  const venda = dataBR(x.vendido_em);
  const link = site ? `${site}/dut.html` : "";
  if (tipo === "boas_vindas") {
    return [
      `${ola} Aqui é o administrativo da Vaapty. Obrigado pela compra${carro ? ` do ${carro}` : ""}.`,
      "Por este número você fala direto com o administrativo: DUT, documentos e qualquer dúvida.",
      link ? `Quando quiser pedir o preenchimento do DUT, é por aqui: ${link}` : "",
      prazo ? `O prazo para a transferência é de 3 meses, até ${prazo}.` : "O prazo para a transferência é de 3 meses.",
    ].filter(Boolean).join("\n\n");
  }
  if (tipo === "crlv") return `CRLV${carro ? ` do ${carro}` : ""}.`;
  if (tipo === "venceu") {
    return [
      `${ola} O prazo de 3 meses para a transferência${carro ? ` do ${carro}` : ""}${venda ? `, comprado em ${venda},` : ""} venceu${prazo ? ` em ${prazo}` : ""}.`,
      "Precisamos que a transferência seja feita o quanto antes. Se já transferiu, me manda o comprovante por aqui que eu atualizo.",
      link ? `Se precisar do DUT, é por aqui: ${link}` : "",
    ].filter(Boolean).join("\n\n");
  }
  if (FALTA[tipo]) {
    return [
      `${ola} Passando para lembrar da transferência${carro ? ` do ${carro}` : ""}${venda ? `, comprado em ${venda}` : ""}.`,
      `${FALTA[tipo]} para o prazo${prazo ? `, que vence em ${prazo}` : ""}.`,
      link ? `Se precisar do DUT preenchido ou de qualquer documento, é por aqui: ${link}` : "",
      "Se já transferiu, me manda o comprovante que eu atualizo.",
    ].filter(Boolean).join("\n\n");
  }
  return "";
}

module.exports = { textoLojista, prazoDe, dataBR };
