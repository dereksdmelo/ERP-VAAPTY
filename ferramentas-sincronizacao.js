/**
 * O teste da mescla de três pontas (0050).
 *
 *     node ferramentas-sincronizacao.js
 *
 * As funções são LIDAS do `index.html`, nunca copiadas para cá: cópia
 * de código de teste envelhece calada, e aí o teste passa enquanto a
 * tela erra — que é exatamente a armadilha do `documentos.js`
 * (decisão 7).
 *
 * O que estes casos guardam é a promessa que a sincronização faz ao
 * negociador: **nada que ele acabou de digitar muda sozinho na frente
 * dele**, e **nada que ele digitou no outro aparelho se perde**. As
 * duas coisas ao mesmo tempo é o que a regra da decisão 43, sozinha,
 * não dava.
 */
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const i = html.indexOf("function mesclarFicha(local, doBanco)");
const j = html.indexOf("const fichaParaBanco = (f) => ({");
if (i < 0 || j < 0 || j < i) {
  console.error("Não achei o bloco da mescla no index.html. Se as funções mudaram de lugar, acerte os marcadores aqui.");
  process.exit(2);
}
const mod = { exports: {} };
new Function("module", "exports", html.slice(i, j) +
  "\nmodule.exports={mesclarFicha,mesclarAoVivo,reconciliar,unirRegistros,igualNaFicha,REGISTROS_DA_FICHA};")(mod, mod.exports);
const { reconciliar } = mod.exports;

let falhas = 0;
const eq = (nome, a, b) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { falhas++; console.log("FALHOU " + nome + "\n  deu: " + JSON.stringify(a) + "\n  era: " + JSON.stringify(b)); }
  else console.log("ok   " + nome);
};

const VAZIO = { km: "", chassi: "", cor: "", pneus: ["","","",""], opcionais: [], canaisVistos: [],
  rodadas: [], documentos: [], revisoes: [], decisorPresente: false, tempoCombinado: false,
  notasEspera: "", transcricao: "", valorFechado: "" };

// 1. Primeira abertura num aparelho novo: o servidor traz tudo.
{
  const remoto = { ...VAZIO, km: "98000", chassi: "9BW", decisorPresente: true,
    pneus: ["Novo","Novo","Meia","Meia"], opcionais: ["Ar"], rodadas: [{impresso:30000,contra:35000,em:"T1"}] };
  const r = reconciliar(null, { ...VAZIO }, remoto);
  eq("abre aparelho novo: km", r.km, "98000");
  eq("abre aparelho novo: toggle false vira true", r.decisorPresente, true);
  eq("abre aparelho novo: pneus", r.pneus, ["Novo","Novo","Meia","Meia"]);
  eq("abre aparelho novo: rodadas", r.rodadas.length, 1);
}

// 2. Decisão 43: o que a pessoa acabou de digitar NÃO muda sozinho.
{
  const remoto = { ...VAZIO, km: "98000" };
  const r = reconciliar(null, { ...VAZIO, km: "99500" }, remoto);
  eq("primeira volta nao sobrescreve o que foi digitado", r.km, "99500");
}

// 3. O que a 43 NÃO resolvia: corrigir um campo já preenchido no outro
//    aparelho. Com base, chega.
{
  const base = { ...VAZIO, km: "98000" };
  const remoto = { ...VAZIO, km: "98500" };        // o outro corrigiu
  const r = reconciliar(base, { ...VAZIO, km: "98000" }, remoto);
  eq("correcao do outro aparelho chega", r.km, "98500");
}

// 4. E continua não sobrescrevendo o que ESTE digitou desde a base.
{
  const base = { ...VAZIO, km: "98000" };
  const remoto = { ...VAZIO, km: "98500" };
  const r = reconciliar(base, { ...VAZIO, km: "99999" }, remoto);
  eq("campo tocado aqui ganha da tela", r.km, "99999");
}

// 5. Campos diferentes nos dois aparelhos: nenhum se perde.
{
  const base = { ...VAZIO };
  const remoto = { ...VAZIO, chassi: "9BW123" };    // computador
  const r = reconciliar(base, { ...VAZIO, km: "98000" }, remoto); // celular
  eq("campos diferentes: o meu fica", r.km, "98000");
  eq("campos diferentes: o dele chega", r.chassi, "9BW123");
}

// 6. Rodada impressa em cada aparelho: as duas sobrevivem, em ordem.
{
  const base = { ...VAZIO, rodadas: [] };
  const remoto = { ...VAZIO, rodadas: [{impresso:30000,contra:0,em:"2026-09-15T14:00:00Z"}] };
  const local  = { ...VAZIO, rodadas: [{impresso:31000,contra:0,em:"2026-09-15T14:05:00Z"}] };
  const r = reconciliar(base, local, remoto);
  eq("duas rodadas sobrevivem", r.rodadas.map((x)=>x.impresso), [30000,31000]);
}

// 7. Canais abertos em aparelhos diferentes somam.
{
  const base = { ...VAZIO, canaisVistos: ["olx"] };
  const r = reconciliar(base, { ...VAZIO, canaisVistos: ["olx","kbb"] }, { ...VAZIO, canaisVistos: ["olx","webmotors"] });
  eq("canais unem", r.canaisVistos.sort(), ["kbb","olx","webmotors"]);
}

// 8. Pneu a pneu: classificar dois aqui e dois lá não se atropela.
{
  const base = { ...VAZIO, pneus: ["","","",""] };
  const r = reconciliar(base, { ...VAZIO, pneus: ["Novo","Novo","",""] }, { ...VAZIO, pneus: ["","","Meia","Ruim"] });
  eq("pneus por posicao", r.pneus, ["Novo","Novo","Meia","Ruim"]);
}

// 9. Desmarcar um opcional no outro aparelho chega aqui.
{
  const base = { ...VAZIO, opcionais: ["Ar","Couro"] };
  const r = reconciliar(base, { ...VAZIO, opcionais: ["Ar","Couro"] }, { ...VAZIO, opcionais: ["Ar"] });
  eq("desmarcar opcional propaga", r.opcionais, ["Ar"]);
}

// 10. Apagar um campo no outro aparelho chega (a 43 sozinha nunca faria).
{
  const base = { ...VAZIO, notasEspera: "ligar pro Jair" };
  const r = reconciliar(base, { ...VAZIO, notasEspera: "ligar pro Jair" }, { ...VAZIO, notasEspera: "" });
  eq("apagar propaga", r.notasEspera, "");
}

// 11. Aparelho com versao mais velha: chave que ele nao conhece fica.
{
  const base = { km: "98000" };
  const remoto = { km: "98000" };                     // sem `chassi`
  const r = reconciliar(base, { ...VAZIO, km: "98000", chassi: "9BW" }, remoto);
  eq("chave ausente no remoto nao apaga", r.chassi, "9BW");
}

// 12. Transcricao: quem nao escutou adota a do que escutou.
{
  const base = { ...VAZIO, transcricao: "boa tarde" };
  const r = reconciliar(base, { ...VAZIO, transcricao: "boa tarde" }, { ...VAZIO, transcricao: "boa tarde, meu carro e um 206" });
  eq("transcricao adotada", r.transcricao, "boa tarde, meu carro e um 206");
}

// 13. A mesma rodada vinda dos dois lados nao duplica.
{
  const rod = {impresso:30000,contra:0,em:"2026-09-15T14:00:00Z"};
  const r = reconciliar({ ...VAZIO }, { ...VAZIO, rodadas: [rod] }, { ...VAZIO, rodadas: [rod] });
  eq("rodada repetida nao duplica", r.rodadas.length, 1);
}

// 14. Sem remoto (primeiro atendimento), a tela fica como esta.
{
  const local = { ...VAZIO, km: "98000" };
  eq("sem remoto devolve o local", reconciliar(null, local, null), local);
}

console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
