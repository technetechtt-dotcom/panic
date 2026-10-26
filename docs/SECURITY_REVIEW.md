# Security and privacy review (defensive)

This is an internal defensive checklist. It is **not** an external penetration test, legal POPIA opinion, or a claim that a third-party review has been completed.

## Before real users

- [ ] External security review commissioned (scope: API auth, emergency token binding, outbox/webhooks, evidence vault, operator MFA, Android permission surfaces).
- [ ] External privacy review commissioned against [PRIVACY.md](PRIVACY.md) and [POPIA.md](POPIA.md) (legal advice is out of this repo).
- [ ] Secrets only in deployment secret stores; no `.env` commits.
- [x] Production fail-closed config: `JWT_ACCESS_SECRET`, `EVIDENCE_VAULT_KEY`, `PUBLIC_API_URL`, CORS, `REDIS_URL`, `TRUST_PROXY`, `SMTP_URL`, and incomplete Twilio/FCM/APNs sets. Missing providers are recorded as not sent.
- [ ] Emergency credential cannot change guardians, account, or operator roles (covered by product tests).
- [ ] Delivery webhooks verify provider signatures before status updates.
- [ ] Outbox dead-letter inspected; no silent forever-retries without operators noticing platform status.
- [ ] Off-host backups + restore verification run on a throwaway database.
- [ ] Android release uses HTTPS API, real `google-services.json`, signed AAB with real versionCode/versionName.

## Explicit non-claims

- No offensive exploit development, PoC payloads, or unauthorized access testing is performed from this repository.
- OEM Doze / locked-screen results are recorded only after physical runs; CI green is not a device result.
- Provider sends are not claimed without injected credentials (`GUARDIAN_PROVIDER_E2E=1`).
