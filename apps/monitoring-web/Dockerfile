# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/monitoring-web ./apps/monitoring-web
ARG VITE_MAP_TILE_URL
ARG VITE_MAP_TILE_ATTRIBUTION
ENV VITE_MAP_TILE_URL=${VITE_MAP_TILE_URL}
ENV VITE_MAP_TILE_ATTRIBUTION=${VITE_MAP_TILE_ATTRIBUTION}
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    test -n "$VITE_MAP_TILE_URL" && \
    case "$VITE_MAP_TILE_URL" in *tile.openstreetmap.org*) echo "A production-approved tile provider is required." >&2; exit 1 ;; *) true ;; esac && \
    npm ci --workspace @guardian/monitoring-web --include-workspace-root && npm run build -w @guardian/monitoring-web
FROM nginx:stable-alpine
COPY apps/monitoring-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/monitoring-web/dist /usr/share/nginx/html
EXPOSE 80
