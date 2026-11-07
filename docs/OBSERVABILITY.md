# Production observability

Guardian exposes Prometheus text at `GET /api/v1/health/metrics`.

The repository includes:
- `infrastructure/monitoring/prometheus.yml`
- `infrastructure/monitoring/guardian-alerts.yml`

These files provide a baseline for a real monitoring stack; they do not claim that a hosted Prometheus/Grafana/Alertmanager service is already running.

## Safety-critical alerts

The default rules cover:
- an unacknowledged live SOS;
- outbox dead letters;
- delayed durable outbox processing;
- Postgres failure/high latency;
- Redis failure;
- expired evidence waiting for retention cleanup;
- elevated API server-error rate.

Route critical alerts to an independently monitored channel appropriate to the deployment. Do not make the same notification provider that is being monitored the only alert path.

## Suggested dashboards

Track:
- active incidents and unacknowledged SOS;
- acknowledgement/dispatch/arrival latency;
- Guardian delivery and acknowledgement;
- responder availability;
- outbox age/dead letters;
- database and Redis health;
- evidence upload/storage/retention;
- API p50/p95/p99 latency from the chosen ingress/APM;
- WebSocket connections and reconnects;
- backup age/restore verification.

## Logs and traces

The API emits structured JSON for important process/sweep errors and includes an `x-request-id` response header. Forward container stdout/stderr to the deployment's central log system. Add a managed OpenTelemetry collector/APM when the hosting target is selected; do not put emergency evidence or Guardian Room tokens into trace attributes.
