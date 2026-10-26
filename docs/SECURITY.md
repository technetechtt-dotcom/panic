# Security

Milestone 1 treats the SOS path as the asset that must stay available and the account system as the asset that must stay closed. It is a first implementation, not a completed security review.

## In place

- TLS is required in production. The debug Android manifest allows cleartext only so an emulator can call `10.0.2.2`. Release builds do not.
- Passwords use scrypt (`N=32768`, `r=8`, `p=1`, 32-byte key) and are stored as `scrypt$N$r$p$salt$hash`. Verification uses a timing-safe compare.
- Access tokens are HS256 JWTs from `jose`, default lifetime 15 minutes. The signing secret must be at least 32 characters and comes from `JWT_ACCESS_SECRET`.
- Refresh tokens are opaque random values. The database stores SHA-256 only. Refresh rotates the token. Presenting a replaced token revokes the family.
- Authorisation reads the role from the database on each HTTP request. A demotion applies on the next request even if the JWT still names the old role.
- Public registration cannot choose a role.
- `GUARDIAN` cannot open the monitoring list. `RESPONDER` can read and update only assigned incidents.
- Monitoring operators can enroll a TOTP authenticator. Sign-in asks for the code only after enrollment. The secret is stored for that operator account.
- Users can create and read only their own incidents and can update only their own active incidents.
- Helmet, CORS with an explicit origin list, and a request id are enabled.
- Logs redact fields named password, token, authorization, pin, and secret.
- Android tokens use EncryptedSharedPreferences with a Keystore-backed master key (`security-crypto` 1.0.0 `MasterKeys` API).
- `android:allowBackup` is false.
- Location tracking runs in a foreground service with a visible notification, and only while an incident is active.
- The partial wake lock is tagged `guardian:emergency` and is held for at most four hours.
- Rate limits cover login, registration, refresh, SOS creation, location, and heartbeats. Production requires Redis. Sign-in limits fail closed if Redis is down. SOS limits stay available on that replica if Redis throws, so an emergency is not blocked by a cache outage.
- Verification and password-reset links are emailed when `SMTP_URL` is set. Production refuses to boot without it, and those API responses do not include the token.
- Production readiness requires Postgres and Redis. Evidence uploads accept bodies up to 4 MB. Operator sockets are checked again and dropped after a role demotion.
- Guardian notifications enqueue through a durable Postgres outbox with retries and a dead-letter table. Two API replicas use Redis or Postgres `SchedulerLock` so sweeps are not double-run.
- See [SECURITY_REVIEW.md](SECURITY_REVIEW.md) for the pre-launch defensive checklist. That file is not an external review certificate.

## Not in place

- No key rotation job. Rotating `JWT_ACCESS_SECRET` invalidates outstanding access tokens. Refresh tokens keep working until they expire or are revoked.
- No organisation-wide secret manager wiring. `.env.example` lists names only.
- Duress PIN exists. The phone always shows the same cancelled result. The server keeps the incident open and emits `duress.detected`. Do not treat a quiet phone as proof the emergency ended.
- A device emergency credential can send SOS, location, heartbeat, and evidence after the login refresh token is gone. It cannot change the account, guardians, or operator data.
- Release minify is off.
- `npm audit` reported vulnerabilities in the dependency tree. They have not been triaged.
- No external penetration test or external privacy legal opinion has been commissioned. This repository does not contain exploit procedures. Defensive tests cover emergency-credential allowlists on SOS, escalation, location, heartbeat, and evidence, refresh-token reuse, and production fail-closed configuration.
- Terminate TLS in front of the nginx listener on port 80. This repository does not ship certificates.
- Physical OEM field tests and Safe Word accuracy campaigns are checklists/harnesses until results are recorded from real devices and fixtures.

## Operator seed

`scripts/seed-operator.ts` refuses an empty or short password. It refuses to change the role of an existing non-operator email. It does not reset an existing operator password.

## Logging

Do not log PINs, access tokens, refresh tokens, password hashes, or microphone audio. Incident logs may include the incident id, correlation id, and request id.
