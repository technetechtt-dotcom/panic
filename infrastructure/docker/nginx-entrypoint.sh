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
if [ -n "${GUARDIAN_ANDROID_CERT_SHA256:-}" ]; then
  mkdir -p /usr/share/nginx/html/.well-known
  package="${GUARDIAN_ANDROID_PACKAGE:-za.co.guardian.app}"
  fingerprint=$(printf "%s" "$GUARDIAN_ANDROID_CERT_SHA256" | tr "[:lower:]" "[:upper:]")
  cat > /usr/share/nginx/html/.well-known/assetlinks.json <<EOF
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "$package",
      "sha256_cert_fingerprints": ["$fingerprint"]
    }
  }
]
EOF
else
  echo "GUARDIAN_ANDROID_CERT_SHA256 is not set; verified Android App Links cannot be established." >&2
fi
exec nginx -g "daemon off;"
