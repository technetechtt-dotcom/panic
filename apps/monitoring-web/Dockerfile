FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/monitoring-web ./apps/monitoring-web
ARG VITE_MAP_TILE_URL
ARG VITE_MAP_TILE_ATTRIBUTION
ENV VITE_MAP_TILE_URL=${VITE_MAP_TILE_URL}
ENV VITE_MAP_TILE_ATTRIBUTION=${VITE_MAP_TILE_ATTRIBUTION}
RUN npm ci --workspace @guardian/monitoring-web --include-workspace-root
RUN test -n "$VITE_MAP_TILE_URL" || (echo "VITE_MAP_TILE_URL is required for production monitoring builds" >&2; exit 1)
RUN npm run build -w @guardian/monitoring-web

FROM nginx:1.27-alpine
COPY apps/monitoring-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/monitoring-web/dist /usr/share/nginx/html
EXPOSE 80
