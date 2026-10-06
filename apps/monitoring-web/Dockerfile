FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/monitoring-web ./apps/monitoring-web
RUN npm ci --workspace @guardian/monitoring-web --include-workspace-root
RUN npm run build -w @guardian/monitoring-web

FROM nginx:1.27-alpine
COPY apps/monitoring-web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/monitoring-web/dist /usr/share/nginx/html
EXPOSE 80
