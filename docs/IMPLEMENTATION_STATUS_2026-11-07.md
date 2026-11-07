# Guardian implementation status — 7 November 2026

This status file maps the large production/competition backlog to the current repository state.

## Implemented in source

- Role-aware Android USER / GUARDIAN / RESPONDER surfaces.
- Guardian invitation deep-link continuity through authentication.
- Guardian Home / active alert inbox.
- Responder Home / assignment workflow.
- Continuous Journey Protection location sharing with retry queue.
- Continuous responder location sharing, live distance/ETA and stop conditions.
- Actionable Guardian push notifications with incident/room metadata and foreground handling.
- TrustedContact-scoped acknowledgement authorization and delivery attribution using stable IDs.
- Onboarding permission/result validation and explicit PROTECTED / LIMITED PROTECTION readiness.
- Full-size visible photo capture, visible video capture, encrypted chunked evidence queue and resumable upload.
- Durable notification/AI outbox, retry/dead-letter recovery and scheduler locks.
- Competition Demo Mode with deterministic TEST-only scenario and reset/advance controls.
- Live monitoring map, Archive, Reports, Communications, Emergency Profile, Integrations, Shift, People/User Detail, Audit and AI Operations.
- Operator readiness/handover controls.
- Responder availability, profile/capability/vehicle data and workload-aware dispatch context.
- Guardian notification methods, priority/escalation metadata and relationship-scoped delivery.
- MFA secret encryption, one-time recovery codes, admin reset, account suspension, session/device controls.
- Audit filtering/pagination and accessible monitoring navigation/alerts.
- Evidence retention/legal hold, access logging and chain-of-custody metadata/export support.
- Production evidence/object-storage gates, encrypted backup/restore verification and observability configuration.
- Explainable Guardian Safety Intelligence with production/shadow assessments, human review, search predictions and event-driven reassessment.
- Safe Word validation harness and competition/pilot KPI tooling.
- Android verified App Link intent configuration; production hosting still requires the real signing fingerprint in the hosted assetlinks.json.

## Repository validation

The current CI workflow validates backend/dashboard/security builds and Android unit/lint/debug builds. Production release signing is supported only when the owner supplies the real Firebase/API/signing secrets.

## External validation still required

The following cannot truthfully be completed from repository source code alone:

1. Create/test a real signed production APK/AAB with the owner's upload keystore and Firebase configuration.
2. Physical Android OEM/device matrix: Samsung, Pixel, Xiaomi/Redmi, Oppo, Honor, supported Huawei and Motorola.
3. Screen-off, Doze, low battery, app-killed, reboot, permission-revocation, weak-network and full offline recovery tests on real devices.
4. Real Twilio SMS/callback, FCM and APNs provider tests using production/staging credentials.
5. Independent penetration test and closure of any critical/high findings.
6. Deployed load/failover/chaos exercises and measured p50/p95/p99, recovery time and queue age.
7. Managed/replicated production Postgres/Redis/object-storage deployment across failure domains.
8. Scheduled backup restore drill with measured RPO/RTO.
9. Safe Word field accuracy campaign across target South African languages, accents, noise and devices.
10. Real accessibility testing with TalkBack, browser screen readers, keyboard-only operation and large-text settings.
11. POPIA/legal/privacy review and processor/vendor agreements.
12. Monitoring/responder/security partner operating agreements.
13. Real pilot users, measured KPIs, LOIs and competition traction evidence.
14. Hosted Android assetlinks.json using the real production signing certificate SHA-256 fingerprint.
15. GitHub administrator branch-protection/review policy and signed release provenance where account/repository administration is required.

## Release rule

Guardian should be called production-ready only when the relevant external evidence above is attached to the release. Until then the repository should be described as production-shaped / controlled-pilot ready rather than broadly production-proven.
