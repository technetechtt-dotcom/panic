FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/api ./services/api
RUN npm ci --workspace @guardian/api --include-workspace-root
RUN npm run build -w @guardian/shared-types && npm run build -w @guardian/shared-validation && npm run build -w @guardian/api
WORKDIR /app/services/api
ENV NODE_ENV=production
ENV EVIDENCE_VAULT_DIR=/app/data/evidence-vault
EXPOSE 3000
CMD ["sh", "./docker-entrypoint.sh"]
