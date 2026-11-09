#!/bin/bash
# Instala o certificado A1 (.pfx) da unidade para a NFS-e nacional (0138).
#
#   bash worker/instalar-certificado-nfse.sh /caminho/do/certificado.pfx
#
# A senha do certificado é pedida AQUI, no terminal — não vai para chat, banco nem navegador.
# O script:
#   1. tira do .pfx a chave privada (PKCS#8) e só o certificado da empresa (sem a cadeia);
#   2. sobe o par para a Cloudflare como certificado mTLS (é ele que abre a conexão com a Receita);
#   3. grava a chave e o certificado como segredos do Worker (NFSE_KEY_PEM, NFSE_CERT_PEM), para assinar a nota;
#   4. apaga os arquivos temporários.
# No fim ele mostra o ID do certificado mTLS: é esse número que entra no wrangler.jsonc (binding NFSE_MTLS).
set -euo pipefail

PFX="${1:-}"
[ -f "$PFX" ] || { echo "Uso: bash worker/instalar-certificado-nfse.sh /caminho/do/certificado.pfx"; exit 1; }
cd "$(dirname "$0")"

TMP="$(mktemp -d)"; trap 'rm -P "$TMP"/*.pem 2>/dev/null; rm -rf "$TMP"' EXIT
read -r -s -p "Senha do certificado: " SENHA; echo

OSSL="$(command -v /opt/homebrew/bin/openssl || command -v openssl)"   # o do Homebrew abre .pfx antigos com -legacy
extrair() { "$OSSL" pkcs12 "$@" -in "$PFX" -passin env:SENHA_PFX 2>/dev/null; }
export SENHA_PFX="$SENHA"
LEG=""
extrair -nokeys -clcerts >/dev/null || LEG="-legacy"        # .pfx antigo (RC2/3DES) pede -legacy no OpenSSL 3
extrair $LEG -nocerts -nodes | "$OSSL" pkcs8 -topk8 -nocrypt -out "$TMP/key.pem"
extrair $LEG -nokeys -clcerts | "$OSSL" x509 -out "$TMP/cert.pem"
[ -s "$TMP/key.pem" ] && [ -s "$TMP/cert.pem" ] || { echo "Não consegui abrir o certificado: senha errada?"; exit 1; }
unset SENHA SENHA_PFX

echo "Certificado:"; "$OSSL" x509 -in "$TMP/cert.pem" -noout -subject -enddate

# O wrangler da ponte, que já está instalado e logado (o do npx desta máquina quebra no workerd).
# Sem ele, um instalado limpo numa pasta própria — de nome sem ponto: o npm recusa ".vaapty-wrangler".
WR="$(pwd)/../workers/ponte-whatsapp/node_modules/.bin/wrangler"
if [ ! -x "$WR" ]; then
  W="$HOME/vaapty-wrangler"
  [ -x "$W/node_modules/.bin/wrangler" ] || { mkdir -p "$W"; (cd "$W" && npm init -y >/dev/null && npm i wrangler@4.143.1 >/dev/null 2>&1); }
  WR="$W/node_modules/.bin/wrangler"
fi

echo "Subindo o certificado mTLS…"
SAIDA="$("$WR" mtls-certificate upload --cert "$TMP/cert.pem" --key "$TMP/key.pem" --name "vaapty-nfse-$(date +%Y%m%d)" 2>&1)"
echo "$SAIDA" | tail -5
echo "Gravando os segredos do Worker…"
"$WR" secret put NFSE_KEY_PEM < "$TMP/key.pem"
"$WR" secret put NFSE_CERT_PEM < "$TMP/cert.pem"

ID="$(echo "$SAIDA" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)"
echo
echo "Pronto. ID do certificado mTLS: ${ID:-'(veja acima)'}"
echo "Mande esse ID no chat (ele não é segredo) para ligar a conexão no wrangler.jsonc."
