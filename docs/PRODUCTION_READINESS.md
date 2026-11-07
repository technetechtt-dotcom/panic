# Production readiness status

This document is the repository-level release gate. It deliberately distinguishes implemented controls from validation that must happen on real infrastructure/devices.

## Implemented in the repository

### Emergency path
- explicit manual/volume/Safe Word/duress workflows;
- local-first SOS persistence and retry;
- device-bound emergency credentials;
- breadcrumbs, heartbeat/contact-loss handling;
- TEST incidents separated from live metrics.

### Mobile product
- USER, GUARDIAN and RESPONDER role-specific surfaces;
- Journey Protection tracking and offline retry;
- responder assignment/location lifecycle;
- Guardian actionable incident notifications;
- Protection Readiness;
- encrypted/chunked evidence capture queue.

### Monitoring and operations
- Incident Command;
- live operations map;
- Archive and Reports;
- communications and emergency profile;
- Integrations and Platform health;
- shifts/readiness/handover;
- People/User Detail, Audit and account-security administration;
- Competition Demo Mode;
- dead-letter recovery.

### Security / evidence
- RBAC;
- exact TrustedContact acknowledgement relationships;
- MFA secret encryption and recovery codes;
- session/device revocation and account suspension;
- evidence access audit;
- retention/legal hold;
- chain-of-custody manifest;
- authoritative remote evidence gate for production;
- encrypted production backups and restore verification.

### Intelligence
- explainable rules-first threat assessment;
- shadow assessment;
- recommendations and human review;
- search predictions separated from confirmed location;
- event-driven reassessment;
- AI Operations dashboard;
- grounded factual query sources;
- post-incident factual intelligence report.

### Deployment gates
Production Compose requires:
- NODE_ENV=production;
- TLS material;
- Postgres/Redis;
- SMTP;
- approved geocoder;
- approved map tiles;
- authoritative HTTPS object storage;
- at least one emergency delivery provider;
- Android App Links certificate fingerprint;
- encrypted backup key.

CI validates app tests/builds plus production Compose, shell and operational-script syntax.

## External validation required before broad launch

The following cannot be made true by source code:
- signed release using the owner's real Android/Firebase secrets;
- OEM/device field matrix;
- real Twilio/FCM/APNs delivery tests;
- independent penetration test;
- deployed load/failover/chaos exercises;
- managed infrastructure HA;
- backup recovery drill and measured RPO/RTO;
- Safe Word field accuracy campaign;
- accessibility testing with real assistive technologies/users;
- POPIA/legal/privacy review;
- partner/responder operating agreements;
- real pilot results.

See `EXTERNAL_VALIDATION.md`.

## Future/R&D — not a production claim

- neural Safe Word KWS after validation;
- speech transcription/OCR/vehicle/plate/video intelligence;
- LLM Incident Copilot;
- road-network probabilistic search;
- personalised behaviour models;
- iOS production parity;
- wearable/hardware ecosystem;
- multi-tenant enterprise architecture;
- billing/subscriptions;
- emergency-service integrations requiring agreements.

## Release rule

A feature should be called **production-ready** only when:
1. its code path exists;
2. automated tests/build pass;
3. required configuration fails closed;
4. relevant real-device/provider/security validation is complete;
5. operations/support owners know how to monitor and recover it.
