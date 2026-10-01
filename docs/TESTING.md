# Testing

Automated tests cover the safety rules and the HTTP path with in-memory stores. They do not replace a device test on a phone.

## Commands

From `guardian/`:

```powershell
npm test
npm run build
```

`npm test` runs shared-validation, the API suite, and the monitoring vitest file.

Android, from `apps/android`, with `JAVA_HOME` pointed at Android Studio's JBR (the JDK on PATH may be 8):

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat :core:test :app:testDebugUnitTest :app:assembleDebug
```

Kotlin incremental compilation is off because the project path contains spaces and the Kotlin daemon fails in that layout.

## What is asserted

API domain tests, in memory:

- A manual SOS creates one `SOS` incident immediately.
- `FALL_OR_IMPACT` does not create an incident.
- The same trigger body replays. A different body with the same trigger id conflicts.
- A unique-constraint race returns the original incident.
- A user cannot acknowledge or read another person's incident.
- Location points append. An older point does not replace the newer last-position cache. A duplicate client point id does not overwrite.
- A missed heartbeat sets `DEVICE_CONTACT_LOST` and leaves the incident in `SOS`. A later heartbeat restores `ONLINE`.
- Guardian and responder roles have no incident permissions.
- Refresh-token reuse revokes the family.
- Redaction and the canonical hash are stable.
- The SMS simulator does not deliver.
- Login failure uses one message.

API HTTP test, Nest with in-memory stores:

- Register, short password rejected, current user, device registration.
- Test incident, replay, non-deliberate trigger rejected.
- A user cannot acknowledge.
- After the in-memory role is changed to `MONITOR_OPERATOR`, summary excludes the test incident from the count, acknowledge and resolve succeed, and the timeline contains the acknowledgement.

Validation tests: consent required, short password rejected, extra incident fields rejected, capsule size helper.

Android `:core` tests: deliberate trigger, capsule size, queue retry, network class, battery mode, protection health, fusion scoring with reasons, offline repository flush.

Android `:app` tests: practice SOS stays pending with a clear message, and SOS while signed out does not pretend to send.

Monitoring tests: a short password is not submitted, and a test incident renders `TEST INCIDENT` beside copy that says counts exclude tests.

## Not covered by automation

- A real PostgreSQL migration applied and queried. Apply it with the steps in [DEPLOYMENT.md](DEPLOYMENT.md) before trusting a deployment.
- WebSocket delivery across two processes.
- Process death, Doze, and OEM battery killing on a physical phone.
- GPS unavailable, duplicate evidence, guardian delivery, and safe-word false matches. Evidence, guardians, and safe words are not built, so those simulations are not claimed.
- The monitoring screens against a live API. Use the browser against a seeded operator after `docker compose` is up. Component tests mock `fetch`.
