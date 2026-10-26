#!/bin/sh
set -eu
cert=/etc/nginx/certs/fullchain.pem
key=/etc/nginx/certs/privkey.pem
mkdir -p /etc/nginx/certs
if [ ! -f "$cert" ] || [ ! -f "$key" ]; then
  if [ "${GUARDIAN_TLS_SELF_SIGNED:-}" = "1" ]; then
    echo "Generating a 30-day self-signed certificate for ${GUARDIAN_TLS_CN:-localhost}. This is not a public certificate. Replace both files before real users rely on Guardian."
    openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
      -keyout "$key" -out "$cert" \
      -subj "/CN=${GUARDIAN_TLS_CN:-localhost}"
  else
    echo "TLS certificate missing. Mount fullchain.pem and privkey.pem at /etc/nginx/certs, or set GUARDIAN_TLS_SELF_SIGNED=1 only for a private lab."
    exit 1
  fi
fi
exec nginx -g "daemon off;"
