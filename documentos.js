/* =====================================================================
 * CÓPIA MORTA — NÃO É ESTE ARQUIVO QUE RODA.
 *
 * O conteúdo daqui foi colado dentro do index.html, no bloco
 * "===== documentos =====", e é lá que a aplicação lê. Ninguém carrega
 * este arquivo: não há <script src> apontando para ele.
 *
 * Editar aqui não muda nada na tela. Para trocar o texto dos
 * documentos, mexa no index.html.
 *
 * Ele fica no repositório por decisão do Derek (26/08/2026), como
 * referência do original.
 * ===================================================================== */

/**
 * Geração de documentos do atendimento.
 *
 * ATENÇÃO — o texto jurídico aqui é RASCUNHO, escrito só para o
 * mecanismo funcionar. Todo documento sai com uma tarja de rascunho
 * bem visível e não deve ser levado para a mesa de um cliente.
 *
 * Quando os modelos reais da Vaapty chegarem, troca-se o conteúdo das
 * funções corpo*(). O encanamento — dados da ficha, formatação,
 * impressão, registro — permanece igual.
 *
 * Cada documento é montado como HTML e aberto numa janela de impressão.
 * Sem biblioteca, sem servidor: o navegador já sabe virar PDF.
 */

/* ---------------- utilitários ---------------- */

const brl = (n) =>
  n == null || n === "" || isNaN(n)
    ? "____________"
    : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dataExtenso = (d = new Date()) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

const hora = (d = new Date()) =>
  d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Campo que o modelo real vai preencher e que hoje não existe na ficha. */
const vazio = (rotulo) =>
  `<span class="falta" title="${rotulo}">________________</span>`;

const ou = (valor, rotulo) => (valor ? String(valor) : vazio(rotulo));

/* ---------------- moldura ---------------- */

function moldura({ titulo, corpo, protocolo }) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt;
         line-height: 1.55; color: #15121a; }
  .tarja { background: #EA5423; color: #fff; padding: 6px 12px;
           font-family: system-ui, sans-serif; font-size: 9pt;
           letter-spacing: .12em; text-transform: uppercase;
           font-weight: 700; margin-bottom: 18px; }
  .marca { font-family: system-ui, sans-serif; font-weight: 800;
           font-size: 15pt; letter-spacing: .04em; color: #6D1B9E; }
  .sub { font-family: system-ui, sans-serif; font-size: 8.5pt;
         letter-spacing: .18em; text-transform: uppercase; color: #6B6478; }
  h1 { font-size: 13pt; text-align: center; text-transform: uppercase;
       letter-spacing: .06em; margin: 26px 0 20px; }
  table.dados { width: 100%; border-collapse: collapse; margin: 14px 0 20px; }
  table.dados td { border: 1px solid #CBD0CA; padding: 6px 9px; font-size: 10pt; }
  table.dados td.r { background: #F6F4F8; width: 32%;
                     font-family: system-ui, sans-serif; font-size: 8.5pt;
                     letter-spacing: .08em; text-transform: uppercase;
                     color: #6B6478; }
  .falta { color: #EA5423; letter-spacing: .06em; }
  .assinatura { margin-top: 46px; }
  .linha { border-top: 1px solid #15121a; width: 62%; margin-top: 42px;
           padding-top: 5px; font-size: 9.5pt; }
  .rodape { margin-top: 28px; border-top: 1px solid #CBD0CA; padding-top: 8px;
            font-family: system-ui, sans-serif; font-size: 8pt; color: #6B6478;
            display: flex; justify-content: space-between; }
  @media print { .tarja { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="tarja">Rascunho — modelo provisório, não utilizar com cliente</div>
<div class="marca">VAAPTY</div>
<div class="sub">Joinville · Santa Catarina</div>
${corpo}
<div class="rodape"><span>Protocolo ${protocolo}</span><span>Gerado em ${dataExtenso()} às ${hora()}</span></div>
</body></html>`;
}

const protocolo = (f, sufixo) =>
  `${(f.placa || "SEMPLACA").replace(/[^A-Z0-9]/gi, "")}-${sufixo}-${Date.now().toString(36).toUpperCase()}`;

/* ---------------- blocos reaproveitados ---------------- */

function blocoVeiculo(f) {
  return `<table class="dados">
  <tr><td class="r">Veículo</td><td>${ou(f.modelo, "modelo")}</td></tr>
  <tr><td class="r">Ano / modelo</td><td>${ou(f.ano, "ano")}</td></tr>
  <tr><td class="r">Placa</td><td>${ou(f.placa, "placa")}</td></tr>
  <tr><td class="r">Chassi</td><td>${ou(f.chassi, "chassi — do CRLV")}</td></tr>
  <tr><td class="r">Renavam</td><td>${vazio("renavam — do CRLV")}</td></tr>
  <tr><td class="r">Cor</td><td>${ou(f.cor, "cor")}</td></tr>
  <tr><td class="r">Quilometragem</td><td>${f.km ? Number(f.km).toLocaleString("pt-BR") + " km" : vazio("km")}</td></tr>
</table>`;
}

function blocoCliente(f) {
  return `<table class="dados">
  <tr><td class="r">Nome</td><td>${vazio("nome do cliente")}</td></tr>
  <tr><td class="r">CPF</td><td>${vazio("CPF")}</td></tr>
  <tr><td class="r">RG</td><td>${vazio("RG")}</td></tr>
  <tr><td class="r">Endereço</td><td>${vazio("endereço completo")}</td></tr>
  <tr><td class="r">Telefone</td><td>${vazio("telefone")}</td></tr>
</table>`;
}

const assinaturas = (a, b) => `<div class="assinatura">
  <div class="linha">${a}</div>
  <div class="linha">${b}</div>
</div>`;

/* ---------------- 1. termo de aceite de proposta ---------------- */

export function termoAceite(f, rodada, indice) {
  const corpo = `<h1>Termo de aceite de proposta</h1>
<p>Pelo presente instrumento, o proprietário abaixo identificado declara ter
recebido da <strong>Vaapty Joinville</strong> a ${indice}ª proposta de compra
referente ao veículo descrito, e manifesta sua decisão quanto a ela.</p>

${blocoVeiculo(f)}
${blocoCliente(f)}

<table class="dados">
  <tr><td class="r">Proposta apresentada</td><td><strong>${brl(rodada.impresso)}</strong></td></tr>
  <tr><td class="r">Contraproposta do cliente</td><td>${rodada.contra ? brl(rodada.contra) : "—"}</td></tr>
  <tr><td class="r">Validade da proposta</td><td>${vazio("prazo de validade")}</td></tr>
</table>

<p>O proprietário declara que a proposta foi apresentada de forma clara, que
teve oportunidade de esclarecer dúvidas, e que não há obrigatoriedade de
aceitação.</p>

<p style="margin-top:18px">
  ( &nbsp; ) Aceito a proposta apresentada.<br>
  ( &nbsp; ) Não aceito e apresento contraproposta.<br>
  ( &nbsp; ) Não aceito e encerro a negociação.
</p>

${assinaturas("Proprietário do veículo", `Negociador — ${ou(f.negociador, "negociador")}`)}`;

  return moldura({ titulo: `Termo de aceite ${indice}`, corpo, protocolo: protocolo(f, `ACE${indice}`) });
}

/* ---------------- 2. autorização de cautelar ---------------- */

export function autorizacaoCautelar(f) {
  const corpo = `<h1>Autorização para vistoria cautelar</h1>
<p>O proprietário identificado abaixo autoriza a <strong>Vaapty Joinville</strong>
a conduzir o veículo descrito até empresa credenciada para realização de
<strong>vistoria cautelar</strong>, incluindo o deslocamento necessário e os
procedimentos técnicos de inspeção.</p>

${blocoVeiculo(f)}
${blocoCliente(f)}

<table class="dados">
  <tr><td class="r">Empresa credenciada</td><td>${vazio("empresa de vistoria")}</td></tr>
  <tr><td class="r">Data prevista</td><td>${dataExtenso()}</td></tr>
  <tr><td class="r">Responsável pela condução</td><td>${ou(f.negociador, "negociador")}</td></tr>
</table>

<p>O proprietário declara estar ciente de que o resultado da vistoria pode
alterar as condições da negociação, e que o laudo será disponibilizado a ambas
as partes.</p>

${assinaturas("Proprietário do veículo", "Vaapty Joinville")}`;

  return moldura({ titulo: "Autorização de vistoria cautelar", corpo, protocolo: protocolo(f, "CAU") });
}

/* ---------------- 3. pré-contrato ---------------- */

export function preContrato(f) {
  const corpo = `<h1>Pré-contrato de compra e venda de veículo</h1>
<p>As partes abaixo qualificadas ajustam a compra e venda do veículo descrito,
nas condições que seguem, ficando a formalização definitiva condicionada ao
resultado da vistoria cautelar e à verificação da documentação.</p>

<p><strong>Vendedor</strong></p>
${blocoCliente(f)}

<p><strong>Compradora</strong> — Vaapty Joinville, ${vazio("razão social e CNPJ")}.</p>

<p><strong>Objeto</strong></p>
${blocoVeiculo(f)}

<p><strong>Condições</strong></p>
<table class="dados">
  <tr><td class="r">Valor ajustado</td><td><strong>${brl(f.valorFechado)}</strong></td></tr>
  <tr><td class="r">Forma de pagamento</td><td>${ou(f.formaFechamento, "forma de pagamento")}</td></tr>
  <tr><td class="r">Quitação de financiamento</td><td>${f.quitacao ? brl(f.quitacao) : "não há"}</td></tr>
  <tr><td class="r">Débitos pendentes</td><td>${f.debitos ? brl(f.debitos) : vazio("débitos apurados")}</td></tr>
  <tr><td class="r">Prazo para formalização</td><td>${vazio("prazo")}</td></tr>
</table>

<p>O vendedor declara que o veículo se encontra livre de ônus não informados,
que as informações prestadas sobre o estado do bem são verdadeiras, e que
tomou conhecimento das condições acima antes de assinar.</p>

<p>Condições suspensivas: aprovação na vistoria cautelar e conferência da
documentação. Não atendidas, este pré-contrato perde efeito, sem ônus para
qualquer das partes.</p>

${assinaturas("Vendedor", "Vaapty Joinville")}

<p style="margin-top:24px;font-size:9.5pt">Testemunhas:</p>
${assinaturas("Nome e CPF", "Nome e CPF")}`;

  return moldura({ titulo: "Pré-contrato", corpo, protocolo: protocolo(f, "PRE") });
}

/* ---------------- abertura ---------------- */

/**
 * Abre o documento numa janela nova, pronto para imprimir ou salvar em PDF.
 * Devolve o protocolo, para registro de que foi gerado.
 */
export function abrirDocumento(html) {
  const j = window.open("", "_blank");
  if (!j) return { ok: false, erro: "O navegador bloqueou a janela. Libere pop-ups para este site." };
  j.document.write(html);
  j.document.close();
  setTimeout(() => j.print(), 400);
  return { ok: true };
}
