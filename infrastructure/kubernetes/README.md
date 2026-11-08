# Multi-host deployment candidate

Compose remains a single-host pilot. This candidate requires three hosts in three zones and schedules API/web replicas separately across hosts and zones. It contains no local database or Redis. This has not been deployed or server-validated in this session.

Provision managed multi-zone Postgres, HA Redis, off-host evidence/backup object storage, a three-zone cluster and a TLS ingress/load balancer. Build and scan both images; replace placeholders with immutable digests. Use a secret manager to create `guardian-runtime` with the API's required environment variables, external DATABASE_URL/REDIS_URL and shared independent signing/MFA/evidence keys. Apply appropriate cluster network policy and collector access restrictions.

Run Prisma migrations once as a release Job before rolling out replicas. Do not run a migration per pod: the deployment intentionally starts `node dist/main.js`. The API image working directory is `/app/services/api`. The web upstream `api:3000` resolves to the Service declared here. Ingress must preserve same-origin API/WebSocket proxying and support socket timeouts and the configured CORS/PUBLIC_WEB_URL origins. Serve production App Links on the manifest hostname separately if needed.

Before cutover, validate against the real cluster (`kubectl apply --dry-run=server`), then measure 100+ SOS, 1,000 WebSocket, upload, Redis/provider loss, host/zone failure and managed-database failover behavior. Attach measured recovery evidence and backup RPO/RTO. Source manifests alone do not close backlog item 49.
