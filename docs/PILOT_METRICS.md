# Pilot and competition metrics

Use measured TEST incidents instead of estimates in competition decks or pilot reports.

After running controlled test scenarios against the target deployment:

```bash
DATABASE_URL=... node services/api/scripts/pilot-kpi-report.mjs --since=2026-11-01T00:00:00Z
```

The report calculates p50/p95/p99 server-side timing for:
- SOS to operator acknowledgement;
- Guardian provider submission;
- Guardian delivery receipt;
- Guardian acknowledgement;
- responder dispatch;
- responder acceptance;
- responder arrival;
- incident resolution.

Only `isTest=true` incidents are included.

## Limits

These values use server-recorded timestamps. They do **not** measure:
- physical button-to-local-storage latency;
- handset sensor detection latency;
- time spent in the Android offline queue before the server first sees the incident;
- mobile network radio conditions.

Measure those separately during the physical-device validation campaign and correlate with the incident correlation ID. Never put an estimated timing into a competition slide as though it were measured.
