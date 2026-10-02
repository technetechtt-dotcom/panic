# Roadmap

Status words mean what is in the repository and what tests have run. A designed interface with no caller is not complete.

## Milestone 1 — in the repository

Completed for the manual SOS path:

- Android registration, login, device registration, home protection screen, manual, volume, and safe-word SOS, `EmergencyTriggerEngine`, location breadcrumbs, a 10 minute test session, local incident history, distress capsule, heartbeat, guardians, journey watch, evidence chunks, duress PIN, and an offline queue.
- API authentication, users, devices, incidents, locations, heartbeats, audit log, WebSocket events, PostgreSQL schema and migration, Redis health, Docker Compose for Postgres and Redis.
- Monitoring login, active list, incident detail, map of the last confirmed location, heartbeat, timeline, acknowledge, and resolve.

Still thin inside milestone 1:

- The API is not containerised.
- HTTP tests do not use a real database. The migration exists and must be applied before a deployment.
- Dashboard navigation does not include guardians, evidence, responders, reports, or audit browsing. Audit is an API route for supervisors only.
- Onboarding is welcome, register, and login, then the home checklist. It is not the ten-screen flow.

## Milestone 2 — partial

Implemented: configurable volume-button patterns, an on-device safe-word sample matcher, a guardian name record, and journey watch that raises concern on a missed check-in. Not implemented: push invitations, SMS delivery, and guardian acknowledgement. `EmergencySmsProvider` is a simulator and is not called.

## Milestone 3 — partial

Implemented: audio chunks encrypted on the phone before upload, a persistent evidence queue, duress PIN handling that keeps the incident open, and a phone screen that says the emergency is cancelled either way. Not implemented: photo capture, video segments, and object storage. Evidence still lands in PostgreSQL, not an encrypted object vault.

## Milestone 4 — library only

`SafetyFusionEngine` scores explainable rules and is unit tested. It is not wired to incident creation. Battery mode is calculated and sent on the heartbeat. The phone does not yet drop work by battery level, because the only uploads are the capsule, location, and heartbeat. Wearable separation is a fusion input name, not a device integration.

## Milestone 5 — not implemented

No `AIIncidentAssistant` type is callable. No model can cancel an SOS, mark someone safe, accuse a person, or dispatch a responder. No search corridor is calculated. The map says last confirmed location.

## Product rules that stay in force

A deliberate trigger sends immediately. Fusion and any future model stay off that path. Contact loss is an incident signal. Test incidents stay out of summary metrics. Permissions and system indicators are not bypassed.
