# Relatório: páginas públicas (agente, 08/11/2026)

## ALTO
A1. Documentos impressos/assinados montam HTML com dado do cliente SEM escape. `ou()` index.html:2990 usado em ~70 interpolações (cliente_nome/cpf/endereco 4422-4424, blocoVeiculo, blocoCliente, contratoLojista L.nome/L.rep_nome, checkList 3504 observacoes, recibo 3270/3278-3286 pagador.nome). Não existe escHtml no index.html (o único `esc` é de CSV, 18957). Destinos: abrirDocumento → window.open("", "_blank") + document.write (4579-4583) — about:blank herda a ORIGEM do ERP e tem window.opener → lê localStorage['vp:vaapty:sessao'] (213); gravado cru em documento.conteudo (api/documento.js:719, só texto() e teto 200 KB) → assinar.html:165 `${d.conteudo}`; ?recurso=assinado devolve doc+bloco (documento.js:561,605) → document.write (23634). Nome pode vir de FORA sem login: pushName do WhatsApp → lead.nome → "Chegou" → cliente_nome → pré-contrato e página de assinatura. Conserto: escHtml() em ou()/vazio()/brlDoc()/toda interpolação; sanitizar conteudo no servidor (ou gravar só dados e remontar); imprimir via iframe sandbox srcdoc ou Blob URL (origem opaca), cortar opener.
A2. Hash/aceite/evidências da assinatura calculados no navegador e aceitos sem conferir: assinar.html:291-298 → documento.js:449-467 → 0048:326 (só regex hex) e 354-358 grava como veio. Servidor deve recalcular sha256(documento.conteudo), montar o documento_assinado, fixar ACEITE no servidor, rejeitar divergência.
A3. RPCs security definer abertas a anon SEM segredo: wa_receber (0055:18-60), wa_numero (0056:36-47), wa_lead_avanca (0059/0098), wa_estado, wa_receber_grupo, wa_canais_para_acordar (lista slugs). Contraste: ia_* e lojista_aviso_* exigem ia_chave_ok(p_segredo). Com a anon key (pública: api/perfil.js:888-891, usada direto por tv.html) cria-se conversa "do cliente", lead, agendamento falso (vai à agenda e à TV), troca telefone de canal. Conserto: p_segredo conferido por ia_chave_ok() nas cinco; revogar anon de wa_canais_para_acordar.

## MÉDIO
M1. dut.html:364-372 injeta pendencia/rastreio/e.message sem escape (digitados pelo adm, index.html:25097) → XSS armazenado na página pública do lojista. Copiar esc() de assinar.html.
M2. Enumeração do DUT: protocolo sequencial DUT-ano-0001 (0057:154), dut_estado devolve placa, situação, "falta…" (texto livre, cita nome/CPF na prática) e código de rastreio dos Correios; GET público sem limite (checklist.js:663-669). Pedir 2º dado (placa/4 últimos do WhatsApp), mostrar só 4 últimos do rastreio, rate limit Cloudflare.
M3. Nenhum cabeçalho de segurança (CSP, X-Frame-Options, Referrer-Policy, nosniff) — worker/index.js:96-103 só mexe em Cache-Control. assinar.html emoldurável (clickjacking). Adicionar no Worker para text/html: frame-ancestors 'none', Referrer-Policy no-referrer, nosniff; Permissions-Policy nas públicas.
M4. CDNs sem versão fixa e sem integrity: index.html:10-13 cdn.tailwindcss.com (sem versão), react@18/react-dom@18 (flutuante), @babel/standalone SEM versão (latest); pdfmake 0.2.10, html-to-pdfmake 2.5.13, qrcodejs 1.0.0 sem integrity. Supply chain + ~2,9 MB de Babel + 1,77 MB de HTML transpilados a cada abertura (no-store). Pinar + integrity; pré-transpilar com esbuild.
M5. DUT público: criação sem rate limit/CAPTCHA (checklist.js:671-704); anexos sem limite de QUANTIDADE por pedido (foto.js:1082-1140, dut_anexar 0057:189-208) → encher bucket; "falta algo" manda WhatsApp pelo número do adm para o lojista_whats digitado pelo solicitante (vetor de banimento). Teto de anexos, Turnstile, validar WhatsApp.
M6. tv_painel expõe meta/feito/carros/conversão por negociador a quem tiver o link; chave 32 bytes hex em claro (0121:25), sem log/limite de tentativa. tv_agenda sem nome/telefone de cliente (confirmado). TV passa tudo por esc()/textContent — sem XSS.

## BAIXO
B1. assinatura_evento só grava 'assinou' (0048:361); link_aberto/token_invalido/verificacao nunca.
B2. verificar_assinatura devolve dispositivo (90 chars UA) e local além do que a tela mostra; código VPT- gerado com random() (não cripto).
B3. CPF do signatário só validado no navegador.
B4. evidencias (PNG+cópia) sem teto de tamanho.
B5. Link de assinatura 7 dias (até 60), uso único OK; link usado mostra nome_esperado + código.
B6. dut-publico: qualquer erro responde "Não consegui registrar o pedido" mesmo no GET.
B7. window.open(SHINKAI_PAINEL,"_blank","noopener") em 18843 (único); abrirDocumento/recibo/assinado (4580, 19894, 23628) abrem about:blank sem cortar opener; abrirAnexoDut corta — correto. target=_blank 31x todos com rel — OK. zap() codifica — OK.
B8. Sem <noscript>; tv.html sem lang; Worker põe no-store em TODO text/html (bom).
B9. .assetsignore ok; testemunhais.json 749 itens com nome do avaliador do Google (sem telefone/CPF) — republicação de nomes, citar na política de privacidade.
B10. Inventário anon: abrir_link_assinatura, gravar_assinatura, verificar_assinatura, dut_*, tv_*, marcar_contrato_assinado(token), wa_canais_para_acordar, wa_estado; com segredo ia_*/lojista_aviso_*.

## Sem achado
index.html sem dangerouslySetInnerHTML; innerHTML só em PDF/QR sem dado cru; CartaoDut via JSX; dut.html ?placa filtrada, ?veiculo em .value; IP da assinatura vem de cf-connecting-ip/req.cf; verificar.html escapa e mostra o mínimo.
