# GUARDIAN

Guardian is an Android-first personal-safety, emergency-intelligence and coordinated-response platform. A deliberate SOS is stored locally first and does not wait for AI, cloud inference or operator approval. The platform combines offline-first emergency continuity, trusted Guardians, journey protection, encrypted evidence, responder coordination and explainable incident intelligence.

> Guardian assists emergency response. It is not a replacement for official emergency services.

See the [85-item remediation status](docs/REMEDIATION_2026-11-08.md) and [rollout requirements](docs/ROLLOUT_SAFETY_FIXES.md) for source fixes, validation evidence and production gates that remain open.

## Current product

### Android
- Registration, login, device registration and role-aware navigation for USER, GUARDIAN and RESPONDER.
- Manual SOS, configurable volume-button SOS, Safe Word, duress PIN, impact/fall watch and test mode.
- Offline-first SOS storage, emergency device credentials, retry/store-and-forward, breadcrumbs and heartbeats.
- Trusted Circle invitations, priority/channel preferences and Guardian alert inbox.
- Journey Protection with destination preview and continuous protected-journey location upload.
- Responder assignments, availability/capability profile and live responder location sharing while assigned.
- Full-size visible photo capture and visible video capture; evidence is encrypted locally and chunked for resumable upload.
- Protection Readiness with explicit PROTECTED / LIMITED PROTECTION state.

### API / safety core
- NestJS, PostgreSQL, Prisma, Redis, JWT access tokens and rotating refresh tokens.
- Device-bound emergency credentials and backend-enforced RBAC.
- Durable Postgres outbox with retries/dead-letter handling and replica-safe scheduler locks.
- Guardian delivery identity through TrustedContact IDs, private incident rooms and delivery receipts.
- Journey, incident, evidence, responder, account-security and audit APIs.
- MFA secret encryption, one-time recovery codes, session revocation, suspension/reactivation and admin security tooling.
- Explainable Guardian Safety Intelligence with production/shadow assessments, recommendations, reviews and search predictions.

### Monitoring centre
- Active incidents, incident command, maps, evidence, Guardian delivery, responder control, timeline, communications, emergency profile and Intelligence.
- Shift readiness/handover.
- Live dashboard map and active incident metrics.
- Archive, Reports, Integrations, Platform health, People/User detail, Audit and Security/MFA.
- Competition Demo Mode with deterministic TEST incidents excluded from live metrics.
- Dead-letter visibility/recovery and integration probes.

## Important safety rules

- Explicit SOS always activates immediately.
- AI cannot cancel, suppress, delay or downgrade an explicit SOS.
- Contact loss is a signal, not proof of kidnapping or harm.
- Predicted/search areas are labelled separately from confirmed locations.
- Camera/microphone use is visible and follows Android permissions/system indicators.
- TEST incidents are excluded from live operational metrics.

## Repository layout

```
apps/android/          Android app and safety services
apps/monitoring-web/   Monitoring centre
services/api/          NestJS API
packages/              Shared types and validation
infrastructure/        Production-shaped Docker/nginx
docs/                  Architecture, security, operations and testing
```

## Local development

Requirements: Node.js 22+, Docker, Java/Android tooling for the app.

```powershell
copy .env.example .env
npm install
docker compose --env-file .env -f infrastructure/docker/docker-compose.yml up -d
npm run prisma:migrate -w @guardian/api
npm run seed:operator -w @guardian/api
npm run dev:api
npm run dev:web
```

## Android

```powershell
cd apps\android
.\gradlew.bat :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

Release builds fail closed unless a real HTTPS API URL and Firebase configuration are provided. A signed AAB additionally requires the upload keystore and version variables documented in the Gradle configuration.

## CI

GitHub Actions runs:
- backend/API/validation/monitoring tests;
- Prisma generation and migrations against PostgreSQL;
- TypeScript production builds;
- production dependency audit;
- Android core/app unit tests, lint and debug APK;
- release configuration checks and signed release build when secrets are supplied.

## Production status

The repository is production-shaped, but broad commercial production still requires external evidence that cannot be created by source code alone: physical-device/OEM testing, real provider tests using production credentials, independent penetration testing, infrastructure failover/load exercises, legal/privacy review and operational pilot validation.

See:
- [Production readiness gate](docs/PRODUCTION_READINESS.md)
- [Roadmap](docs/ROADMAP.md)
- [External validation gate](docs/EXTERNAL_VALIDATION.md)
- [Competition demo runbook](docs/COMPETITION_DEMO.md)
- [Competition architecture](docs/COMPETITION_ARCHITECTURE.md)
- [Competition positioning & pilot strategy](docs/COMPETITION_POSITIONING.md)
- [Pilot KPI measurement](docs/PILOT_METRICS.md)
- [Safe Word validation](docs/SAFE_WORD_VALIDATION.md)
- [Observability](docs/OBSERVABILITY.md)
- [POPIA operations checklist](docs/POPIA_OPERATIONS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Privacy](docs/PRIVACY.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
