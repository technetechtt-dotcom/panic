# syntax=docker/dockerfile:1
FROM node:22-alpine
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export SSL_CERT_FILE=/run/secrets/proxy_ca; fi; \
    apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/api ./services/api
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --workspace @guardian/api --include-workspace-root && \
    npx prisma generate --schema services/api/prisma/schema.prisma && \
    npm run build -w @guardian/shared-types && npm run build -w @guardian/shared-validation && npm run build -w @guardian/api && \
    npm prune --omit=dev --workspace @guardian/api --include-workspace-root && npm cache clean --force && \
    mkdir -p /app/data/evidence-vault && chown -R node:node /app/data &&     rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn* /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app/services/api
ENV NODE_ENV=production
ENV EVIDENCE_VAULT_DIR=/app/data/evidence-vault
USER node
EXPOSE 3000
CMD ["sh", "./docker-entrypoint.sh"]
