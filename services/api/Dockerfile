FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/api ./services/api
RUN npm ci --workspace @guardian/api --include-workspace-root
RUN npm run build -w @guardian/shared-types && npm run build -w @guardian/shared-validation && npm run build -w @guardian/api
WORKDIR /app/services/api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
