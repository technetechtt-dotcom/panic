# POPIA operational readiness

> Engineering/operations checklist only. It is not legal advice or a finding of POPIA compliance. Obtain appropriate South African legal/privacy review before launch.

## Data inventory

Guardian processes potentially sensitive emergency data including:
- account/contact details;
- trusted-contact relationships;
- device identifiers;
- location/trajectory;
- emergency profile data;
- incident/evidence records;
- operator/responder actions;
- authentication/security logs.

Maintain a current processing inventory that identifies purpose, lawful basis/justification, access roles, storage location, processor/vendor, retention and deletion path.

## Purpose limitation and minimisation

- collect emergency data only for documented safety/operations purposes;
- keep explicit SOS independent from optional behavioural profiling;
- do not enable future personal-behaviour intelligence without separate explicit consent and review;
- avoid copying emergency evidence into tickets, chat or ordinary email;
- expose the minimum incident data necessary for each role.

## Access governance

- USER: own account/protection data.
- GUARDIAN: only incidents explicitly shared through their TrustedContact relationship.
- RESPONDER: only assigned incident operational data.
- MONITOR_OPERATOR: active incident operations.
- SUPERVISOR/ADMIN: authorised operational/security administration.

Review audit records and privileged accounts regularly.

## Retention and legal hold

Evidence supports:
- `retentionUntil`;
- `retentionPolicy`;
- `legalHold`;
- audited governance changes;
- retention deletion;
- chain-of-custody export.

The organisation must define actual retention periods with legal/business justification. Legal hold should be used only under an authorised procedure.

## Data-subject requests

Document an identity-verification procedure before:
- providing account exports;
- correcting data;
- erasing profile data;
- responding to requests involving retained incident/evidence records.

Do not delete an active emergency merely because an account-erasure request is received.

## Incident/breach response

Create an internal procedure with:
1. detection and containment;
2. preservation of security/audit evidence;
3. scope assessment;
4. responsible-party escalation;
5. affected-system credentials/key rotation where required;
6. legal determination of notification duties/timing;
7. communication records;
8. remediation and post-incident review.

The software audit log is not a substitute for required organisational/regulatory notifications.

## Vendors/processors

Before launch, record agreements and security/privacy review for:
- hosting;
- Postgres/Redis providers;
- object storage;
- SMS/push/email providers;
- maps/geocoding;
- monitoring/security partners;
- analytics/APM tools.

Review cross-border processing and transfers where applicable.

## Security controls to evidence

Maintain release evidence for:
- independent penetration test;
- dependency/security scans;
- TLS;
- secret management;
- access reviews;
- MFA;
- backup encryption/restore tests;
- provider webhook verification;
- incident/evidence audit access;
- log retention and monitoring alerts.

## Pilot consent

Pilot participants should receive understandable information about:
- what Guardian does and does not do;
- when location/audio/photo/video may be processed;
- who can see incident data;
- Safe Word limitations;
- monitoring/responder model;
- retention;
- test-mode drills;
- how to raise privacy/support requests.

Keep evidence of the consent/version used for the pilot.
