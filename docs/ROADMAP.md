# Guardian roadmap

This file separates what exists in the repository from work that still requires external validation or future R&D.

## COMPLETED / IMPLEMENTED

- Offline-first deliberate SOS and device-bound emergency credentials.
- Manual, volume, Safe Word and duress triggers; explicit SOS does not wait for AI.
- Location, heartbeat, contact-loss, test mode and incident state machine.
- Role-aware Android USER / GUARDIAN / RESPONDER experiences.
- Trusted Circle invitation flow, Guardian notification preferences and escalation priority.
- Continuous protected-journey location upload with retry queue.
- Responder assignment workflow and visible responder location sharing.
- Guardian private-room identity tied to TrustedContact IDs.
- Actionable Guardian push payloads and foreground notification handling.
- Full-size visible photo capture, visible video capture and encrypted chunked local evidence queue.
- Monitoring Incident Command with map, evidence, Guardians, responders, communications, emergency profile, timeline and Intelligence.
- Durable notification/AI outbox, dead letters and scheduler locks.
- Operator shifts/readiness/handover.
- Archive, Reports, Integrations, People/User Detail, Audit and Competition Demo Mode.
- Account suspension, session revocation, MFA reset, encrypted TOTP secret storage and one-time recovery codes.
- Explainable Guardian Safety Intelligence: production/shadow rules, recommendations, reviews, search predictions and audit records.
- TLS/reverse-proxy production shape, Redis-backed rate limiting/realtime fan-out, SMTP production gate and off-host backup support.

## PILOT GATE — MUST BE PROVEN OUTSIDE SOURCE CODE

- Signed pilot APK/AAB installed and upgrade-tested on physical devices.
- Real Firebase/FCM production delivery tests.
- Real Twilio SMS and callback tests through the deployed reverse proxy.
- APNs tests when iOS becomes launch scope.
- OEM matrix: Samsung, Pixel, Xiaomi/Redmi, Oppo, Honor, Motorola and supported Huawei devices.
- Screen-off, Doze, low-battery, reboot, app-killed, permission-revocation, weak-network and fully offline recovery tests.
- Independent penetration test covering auth, device credentials, Guardian Rooms, evidence, WebSockets and uploads.
- Load/failover drills against deployed infrastructure.
- Backup restore drill with measured RPO/RTO.
- POPIA/privacy/legal review and operating procedures.
- Controlled user/responder/monitoring pilot with measured KPIs.

## NEXT PRODUCTION ENGINEERING

- Verified Android App Links using production signing certificate and hosted assetlinks.json.
- Production-approved/self-hosted map tiles and geocoder.
- Authoritative replicated object storage, lifecycle/versioning and managed KMS.
- Managed/replicated PostgreSQL and highly available Redis across failure domains.
- Central logs, dashboards, alerting and distributed tracing.
- Stronger GitHub governance: required PR reviews/CODEOWNERS, admin protection and signed release provenance.
- Formal evidence retention, expiry, legal hold and chain-of-custody export.
- Automated scheduled off-site backup + isolated restore verification.

## AI / INTELLIGENCE R&D

The current production-safe intelligence layer is explainable and rules-first. Future models must run in shadow/pilot before production.

- Safe Word neural keyword spotting after FAR/FRR benchmark validation.
- Speech-to-text and multilingual transcription.
- OCR, road/street-sign extraction and vehicle attributes.
- Licence-plate candidates with confidence and mandatory human verification.
- Video keyframe extraction and semantic evidence search.
- Grounded Incident Copilot with source references.
- Model registry promotion/rollback, evaluation metrics and drift monitoring.
- Road-network-aware search probability zones.
- Smarter responder ranking by ETA, availability, capability, region and workload.
- Optional personalised behaviour intelligence with explicit consent.

## FUTURE PRODUCT EXPANSION

- iOS production client.
- Wearable companion and dedicated hardware.
- Multi-tenant enterprise/security/campus/fleet deployments.
- Tenant RBAC, organisations, regions, policies, SLAs and commercial billing.
- Vehicle/IoT safety integrations.
- Approved emergency-service/security-partner integrations.

## Rules that remain permanent

1. Explicit SOS always wins.
2. AI cannot cancel or suppress an SOS.
3. Predictions are never presented as confirmed facts.
4. TEST incidents stay separate from live metrics.
5. Privacy/system indicators are not bypassed.
