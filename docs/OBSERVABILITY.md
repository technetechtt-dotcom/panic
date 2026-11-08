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

## Distributed tracing

Set `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) to the private OTLP HTTP collector. The API initializes OpenTelemetry before Nest imports, accepts/propagates W3C trace context for HTTP, and exports HTTP/Nest spans. Responses include `x-trace-id` when a span is active; request IDs are attached to spans. No collector means tracing stays off. Capability-room requests and outgoing routing/geocoding URLs are excluded to avoid recording bearer room tokens or exact coordinates. Keep the collector private and apply access/retention controls. This does not by itself prove deployed trace collection or add Android tracing.
