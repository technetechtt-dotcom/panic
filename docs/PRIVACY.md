# Privacy

Guardian stores location, device state, account data, and incident history. That is enough to reconstruct a person's movements during an emergency. This document lists design choices and items that need a lawyer. It is not a claim that the product complies with POPIA or any other law.

## What this version collects

- Email, display name, and a password hash.
- A consent row when the person turns on the registration consent switch: purpose `SAFETY_LOCATION_AND_INCIDENT`, version `2026-10-01`.
- Device manufacturer, model, OS version, and app version.
- During an incident: distress capsule, location points, speed, heading, battery, charging state, network type, and heartbeats.
- Operator notes attached to acknowledge and resolve.
- Audit rows for incident creation, location append, contact loss and restore, acknowledge, and resolve.

The Android app requests the microphone only for safe-word samples, safe-word listening, or audio the person chooses to share during SOS. It requests the camera only when the person takes a photo or starts a short video. It does not request `ACCESS_BACKGROUND_LOCATION`. Impact detection runs only after the person turns it on, and it shows a notification.

Location updates start after a foreground SOS and stop when the incident is resolved or archived, or when the service is stopped. The app does not track while the person is idle.

## Account export and erasure

`GET /api/v1/users/me/export` returns the profile, guardian names, device labels, and incident ids. It does not return passwords, PINs, or evidence bytes. `POST /api/v1/users/me/erase` requires the password, removes guardian contacts and the emergency profile, revokes refresh tokens, and replaces the account name. Incident rows are kept so an open emergency is not deleted by the erase call. This is an in-product process, not a completed POPIA filing.

## Disclosures in the app

Registration explains that the account is used for emergency incidents. The welcome text says the app is not a replacement for official emergency services. Location and notification permissions are requested from the protection checklist after the row explains the failure, not in a single batch at first launch. Volume, safe-word, and guardian rows are marked unavailable.

## Retention and deletion

There is no separate retention schedule. Incident and location rows are kept. `POST /api/v1/users/me/erase` anonymizes the account and does not cascade-delete incidents (`ON DELETE RESTRICT` on the incident user and device foreign keys), so an open emergency is not removed by that call. A lawyer still has to set how long incident rows are kept.

Consent records are append-only in intent. This version only inserts the registration consent. It does not record a later withdrawal.

## Access

Operators with `incident:read:active` can read active incidents, including test incidents, and the distress capsule stored on them. Supervisors can read the audit log. Guardians have no access. Evidence chunks are stored in PostgreSQL for the incident owner and operators who can read the incident. There are no public incident URLs and no signed media URLs.

## Items for professional legal review

These are open questions, not completed controls:

- Whether a monitoring operator processing another person's live location in South Africa needs an operator agreement, a responsible-party determination, and a POPIA section 18 notice beyond the in-app sentences.
- Lawful basis and purpose limitation for location, battery, and network data, including how long each field may be kept.
- Cross-border hosting if PostgreSQL or the map tile server is outside South Africa. The default map tiles are the public OpenStreetMap tile service, which receives tile requests that include the viewed area. Production should use a tile host chosen for that processing.
- Whether practice-mode incidents are personal information and how they must be separated from operational metrics. The summary query excludes them. The incident list still shows them to operators.
- Data-subject rights: access, correction, and deletion, including what must remain in an audit log.
- Breach notification duties if a distress capsule or location trail is exposed.
- Special rules if the product is later used for children. This version has no age gate.
- Any later microphone, camera, AccessibilityService, or continuous-listening feature. Those need a fresh privacy review before they are built. See [ANDROID_LIMITATIONS.md](ANDROID_LIMITATIONS.md).

Do not describe hash chaining, once evidence exists, as legal admissibility. Integrity support is not a legal conclusion.
