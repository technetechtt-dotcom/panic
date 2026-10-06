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

Implemented: configurable volume patterns, an on-device safe-word sample matcher, guardian records with an optional phone number, and journey, ride, drive, meeting, and high-risk watches. A live SOS creates a private room link and attempts SMS and FCM. SMS is sent only when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` are set. Push is sent only when `FCM_SERVER_KEY` and a device `fcmToken` are set. Otherwise the delivery row says the message was not transmitted.

## Milestone 3 — partial

Implemented: encrypted audio, a photo taken in the camera UI, and a short video the person starts. Chunks are encrypted on the API host. A copy is sent to S3 only when `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` are set. The monitoring hub lists evidence. It does not play a video timeline.

## Milestone 4 — partial

Fusion scores the same explainable rules as the phone. A missed check-in or a high score can open a concern or high-risk incident from the server. A deliberate SOS still does not wait for that score. Battery survival slows location updates and blocks photo and video before audio. Impact detection is an opt-in foreground notification with a 20 second cancel. A same-signed companion can send `za.co.guardian.action.WEARABLE_SOS`. There is no watch app binary in this repository.

## Milestone 5 — partial

The hub shows a rules brief and a search corridor around the last confirmed point. The brief cannot cancel an incident, accuse a person, or dispatch by itself. An operator can assign a responder account. The responder uses the same hub and only sees assigned incidents. There is no separate responder store binary.

## Still not a production claim

iOS source in `apps/ios` has not been compiled. Operator MFA is enforced only after that operator enrolls. Redis rate limits are used when Redis is up, and the process falls back to memory when it is not. PostgreSQL integration coverage runs when `GUARDIAN_PG_TEST=1`. The production compose file can run two API processes behind one database and Redis; that is not a tested multi-region deployment. Backup is `pg_dump` via `services/api/scripts/backup-restore.mjs`. Observability is a request counter at `/api/v1/health/metrics`. Account export and erasure remove profile and guardian contact data and keep incident rows. No penetration test engagement has been run. No model is connected.

## Product rules that stay in force

A deliberate trigger sends immediately. Fusion and any future model stay off that path. Contact loss is an incident signal. Test incidents stay out of summary metrics. Permissions and system indicators are not bypassed.
