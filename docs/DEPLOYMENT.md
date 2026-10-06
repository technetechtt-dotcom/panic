# Deployment

Production-shaped containers live in `services/api/Dockerfile`, `apps/monitoring-web/Dockerfile`, and `infrastructure/docker/docker-compose.prod.yml`. From the repository root, scale the API with `docker compose -f infrastructure/docker/docker-compose.prod.yml up --build --scale api=2`. Both processes share Postgres and Redis. WebSocket fan-out uses the Redis adapter when `REDIS_URL` is set. Set `EVIDENCE_VAULT_KEY`, Twilio, FCM, and S3 variables only when those providers are real. A missing provider records that the message or object was not sent.

A database backup is `node --env-file=.env services/api/scripts/backup-restore.mjs`. Restore with `psql` against the dump file. This is a single-database procedure, not a multi-region disaster-recovery exercise.

Local development can still run the API with `npm run dev:api` and Postgres in Docker. The Dockerfiles above are the container path. They have not been load-tested as a multi-region deployment.

## Local

1. Copy `.env.example` to `.env`.
2. Set `POSTGRES_PASSWORD` and put the same password in `DATABASE_URL`.
3. Set `JWT_ACCESS_SECRET` to at least 32 characters.
4. Set `MONITOR_OPERATOR_EMAIL` and `MONITOR_OPERATOR_PASSWORD` (12 or more characters) before seeding.
5. Start data stores:

```powershell
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d
```

6. Apply the migration and seed the operator:

```powershell
npm run prisma:migrate -w @guardian/api
npm run seed:operator -w @guardian/api
```

`prisma:migrate` runs `prisma migrate deploy` against `services/api/prisma/migrations`.

7. Start the API and the dashboard:

```powershell
npm run dev:api
npm run dev:web
```

Health: `GET http://localhost:3000/api/v1/health`.

The dashboard dev server proxies `/api` and `/socket.io` to port 3000. Set `VITE_API_BASE_URL` only when the browser must call a different origin. That origin must be listed in `CORS_ORIGIN`.

## Map tiles

`VITE_MAP_TILE_URL` defaults to the public OpenStreetMap tile server. That is acceptable for a local demo. Production needs a tile host you are allowed to use, and the privacy review has to cover the area the browser requests. See [PRIVACY.md](PRIVACY.md).

## Production notes that are not done

- Terminate TLS in front of the API. Set `NODE_ENV=production` so the refresh cookie is `Secure`.
- Set `TRUST_PROXY` only when a reverse proxy you control sets the client IP. The rate limiter uses `request.ip`.
- Run one API process until rate limits move to Redis. Several processes each keep their own window.
- Do not commit `.env`.
- The Android release build still needs a real API base URL over HTTPS. The debug cleartext host is emulator-only.

## Backup

The Postgres volume is `guardian_postgres`. There is no backup schedule in this repository.
