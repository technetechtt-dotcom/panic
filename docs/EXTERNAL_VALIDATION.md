# External Production Validation Gate

Repository code can provide harnesses and fail-closed configuration, but the following items require real devices, provider accounts, deployed infrastructure or independent reviewers. They must not be marked complete until evidence is attached to a release.

## Android device matrix

Test at minimum: Samsung, Pixel, Xiaomi/Redmi, Oppo, Honor, Motorola and supported Huawei devices.

For each device record:
- Android/OEM version and Guardian build.
- manual and volume SOS while screen on/off;
- Doze/background restrictions;
- app killed and reboot recovery;
- low battery and battery saver;
- location/notification/microphone permission revocation;
- weak/intermittent network and complete offline store-and-forward;
- Guardian FCM receipt;
- journey tracking and responder location tracking;
- evidence photo/video capture and queued upload.

Pass criterion: explicit SOS is stored locally and eventually reaches the monitoring centre when connectivity returns.

## Provider validation

Run only in isolated test accounts:
- Twilio SMS send and signed callback through production reverse proxy.
- FCM foreground/background delivery and incident deep-link action.
- APNs when iOS is launch scope.
- SMTP verification/reset/invitation mail.
- provider failure, retry and dead-letter recovery.

Store screenshots/log IDs; do not commit credentials.

## Security validation

Commission an independent penetration test covering:
- registration/login/refresh/MFA/recovery;
- device-bound emergency credential replay/cross-device abuse;
- RBAC/IDOR across incidents, Guardian deliveries and evidence;
- Guardian Room token entropy, expiry and revocation;
- WebSocket authentication/revocation;
- upload parsing, content types, malformed chunks and resource exhaustion;
- rate limits, reverse-proxy IP handling and session invalidation.

Critical/high findings must be closed before a broad launch.

## Performance / failover

Run deployed tests for:
- 100 simultaneous SOS creates;
- 500 active incidents;
- 1,000 monitoring WebSocket clients;
- location/heartbeat bursts;
- concurrent evidence uploads;
- kill one API replica during incidents;
- Redis interruption;
- provider outage;
- object-storage outage;
- database latency/degraded mode.

Capture p50/p95/p99 latency, error rates, queue age and recovery time.

## Backup / disaster recovery

- scheduled encrypted off-site backup;
- checksum verification;
- restore into isolated database;
- record RPO and RTO;
- evidence-store restore/versioning test.

## Legal / privacy / operations

Obtain appropriate South African legal/privacy review for POPIA, retention, evidence disclosure, processor/vendor contracts, breach response and cross-border transfers where applicable.

## Release evidence

A production/pilot release should have:
- Git SHA and signed version;
- CI run URL;
- APK/AAB checksum;
- device matrix report;
- provider E2E report;
- penetration-test summary;
- load/failover report;
- backup restore report;
- legal/privacy sign-off status.
