# Safe Word accuracy campaign

The current on-device matcher is MFCC + DTW in `apps/android/core`. A compact neural KWS model is **not** enabled. Replace it only after this campaign passes the gate below with recorded fixtures.

## Gate (must pass before replacing MFCC)

| Metric | Threshold |
| --- | --- |
| True accept on enrolled phrase (quiet room) | ≥ 95% |
| True accept with mild noise | ≥ 85% |
| False accept on non-phrase speech | ≤ 2% |
| False accept on silence / TV / traffic | ≤ 0.5% |
| Enrollment rejection of mismatched samples | 100% of deliberately bad enrollments |

## Campaign procedure

1. Enroll three samples of the same phrase on each handset in the OEM matrix.
2. Record 50 positive and 50 negative clips per OEM family into `apps/android/core/src/test/resources/safeword-campaign/` (PCM 16 kHz mono).
3. Run `./gradlew :core:test --tests za.co.guardian.core.SafeWordCampaignTest`.
4. Fill `docs/SAFEWORD_RESULTS.md` with pass/fail. Do not invent scores.
5. Keep MFCC if any gate row fails. Only then evaluate a neural KWS.

## Status

This workspace has the harness and gate. It does **not** claim a completed field campaign or a neural replacement decision. The matcher remains MFCC + DTW until measured results say otherwise.
