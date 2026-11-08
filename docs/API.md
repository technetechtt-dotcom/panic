# API

Base path: `/api/v1`.

Successful bodies use `{ "data": ... }`. Errors use `{ "code", "message", "requestId" }` and do not include stack traces. Zod failures return `400`. Unknown extra JSON fields are rejected.

Timestamps are ISO-8601 with an offset.

## Authentication

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Requires `acceptedSafetyConsent: true` and a password of at least 12 characters. Role is always `USER`. |
| POST | `/auth/login` | Public | Unknown email and wrong password share one message. |
| POST | `/auth/refresh` | Public | Body `refreshToken` or cookie `guardian_refresh`. Rotates the token. Reuse revokes the family. |
| POST | `/auth/logout` | Public | Revokes the presented refresh token and clears the cookie. |

The cookie is httpOnly, `SameSite=Strict`, path `/api/v1/auth`, and `Secure` in production. The access token is returned in JSON. It expires in 15 minutes by default. Mobile clients send `Authorization: Bearer`. The web app keeps the access token in memory and sends the cookie on refresh.

Rate limits, per IP, in memory on each API process: register and login 10 per 15 minutes, refresh 30 per 15 minutes.

## Session and devices

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/users/me` | `user:read:self` |
| POST | `/devices` | `device:register:own` |
| GET | `/devices` | `device:register:own` |

Device registration is idempotent for the same user and `devicePublicId`. `platform` must be `ANDROID`.

## Incidents

| Method | Path | Who | Result |
| --- | --- | --- | --- |
| POST | `/incidents` | User | `201` created, or `200` with `Idempotent-Replayed: true` |
| GET | `/incidents` | User sees own. Operator sees active. | |
| GET | `/incidents/summary` | Operator | Counts exclude `isTest`. `highRiskAlerts` and `respondersActive` are null. |
| GET | `/incidents/:id` | Owner or operator | |
| POST | `/incidents/:id/locations` | Owner | Append points, max 20. Duplicates are counted, not overwritten. |
| POST | `/incidents/:id/heartbeats` | Owner | Duplicate `clientHeartbeatId` is a replay. |
| GET | `/incidents/:id/timeline` | Owner or operator | |
| GET | `/incidents/:id/locations` | Owner or operator | Ordered by `recordedAt`. |
| GET | `/incidents/:id/heartbeats` | Owner or operator | |
| POST | `/incidents/:id/acknowledge` | Operator | `SOS` to `ACKNOWLEDGED`. Optional note, max 500 characters. |
| POST | `/incidents/:id/resolve` | Operator | `SOS` or `ACKNOWLEDGED` to `RESOLVED`. |

Create body fields: `triggerId`, `triggerType`, `correlationId`, `deviceId` (the server device id), `isTest`, optional `confidence`, optional `protectionSessionId`, optional small `metadata`, and `distressCapsule`.

Deliberate trigger types are `VOLUME_BUTTON`, `VOICE_SAFE_WORD`, `MANUAL_SOS`, and `DURESS`. Anything else returns `422` code `FUSION_NOT_ENABLED`.

The capsule must be at most 2048 bytes. Latitude and longitude are both present or both null. `deviceId` must belong to the caller.

SOS create is limited to 30 per hour per user. Location and heartbeat posts are limited to 600 per hour per user. The phone keeps retrying after `429`.

## Audit and health

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/audit` | `audit:read`. Supervisor and admin. Operators cannot read it. |
| GET | `/health` | Public. `503` when PostgreSQL is down. Redis down is `degraded`, not `503`. |

## WebSocket

Namespace `/monitoring`. Client sends event `auth` with `{ "token" }`. Success is `auth.ok`. Failure disconnects with `auth.error`.

Emitted to room `monitors`: `incident.created`, `incident.acknowledged`, `incident.resolved`, `location.updated`, `heartbeat.updated`, `device.offline`.

## Not implemented

There are no routes for guardians, evidence upload, notifications, responders, risk scores, safe words, journeys, or AI summaries.

## Capture, acknowledgement and communications updates

- `POST /incidents/:id/evidence` accepts optional `capture` metadata: `captureId`, zero-based `chunkIndex`, `chunkCount`, `originalSize`, `originalSha256`, `capturedAt`. All chunks of a capture must agree. Completion verifies chunk and reconstructed original hashes. New Android audio uses `audio/wav`; legacy `audio/pcm` remains accepted for old queues.
- `GET /incidents/:id/artifacts` lists capture metadata and completion state for authorised monitoring users. `GET /incidents/:id/artifacts/:artifactId/stream` requires Bearer monitoring permissions, returns binary media, supports a single `Range: bytes=...` with 206/416, audits access, and does not expose incomplete captures. No bearer token is embedded in a media URL. The client fetches with an Authorization header.
- `POST /incidents/:id/communications` requires incident-acknowledgement permission. Body: `channel` (PHONE/SMS/EMAIL/RADIO/IN_PERSON/EMERGENCY_SERVICES/OTHER), `type` (ATTEMPT/CONNECTED/MESSAGE/HANDOFF/NOTE), `note` (1–2000 characters), optional ISO `occurredAt` and `externalReference` (up to 200). The write is audited.
- `GET /guardian/incidents/:id/access` requires an accepted active Guardian relationship and returns a private room URL. Guardian inbox coordinates obey the relationship's location permission. Room acknowledgements create an incident/contact acknowledgement independent of delivery status.
- `POST /auth/mfa/setup` requires `password` and, for an enabled authenticator, `currentCode` (current TOTP or one-time recovery code). It prepares a pending secret without disabling the current one. `/auth/mfa/confirm` verifies the replacement within 15 minutes and atomically switches secrets/recovery codes.
- Journey/responder location bodies accept `sampleId`, ISO `recordedAt`, `accuracy`, `speedMps`, `bearing`, `source`. Samples persist independently from the latest responder position; older replayed positions cannot move the latest marker backwards. Completed targets return a terminal 409.

API responses use `Cache-Control: no-store, private`. Production room links use explicit `PUBLIC_WEB_URL`, not the CORS origin list.
