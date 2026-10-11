# Physical device checks

These checks are not run by CI. Run them on a phone before treating a build as ready. The automated `monitoringStart` tests lock the policy. They do not prove a handset obeyed it.

Record the phone model, Android version, whether the screen was locked, and whether battery optimization was on.

| Check | Expected |
| --- | --- |
| SOS button while the app is open and location is allowed | The SOS is stored, the Guardian notification appears, and location updates continue. |
| SOS button with microphone sharing off | No microphone indicator from Guardian. |
| SOS button with microphone sharing on | The microphone indicator is visible. Audio stops when the incident ends. |
| Volume pattern while the app is in the background | SOS is stored. Location may start. The microphone does not start. |
| Volume pattern after the accessibility service is turned off | No SOS. The checklist says volume protection is off. |
| Watch or other background broadcast | SOS is stored. A notification asks to open Guardian. Location does not start until the app is opened. |
| Reboot during an open incident | A notification asks to open Guardian. No location or microphone service starts from boot. |
| Open Guardian from that notification | Location tracking starts again if permission is still granted. |
| Phone in Doze with no network | The SOS remains on the phone and uploads after the network returns. |
| Decoy PIN and the other volume key | The freeze screen stays up. The secret PIN leaves it. Reboot clears it. |
| Sign out while no emergency is open | Safe-word listening and fall watch stop. Location monitoring stops. |
| Sign out during an open emergency | Emergency monitoring stays up. Safe-word listening stops. |
| FCM with google-services.json present | The device row stores an FCM token after sign-in. |
| FCM without google-services.json | No token is uploaded. The hub reports FCM as not configured or degraded. |

## Closed field-test matrix (not run here)

Record pass/fail on each handset before treating a build as ready. This table is a checklist. It is **not** a claim that the devices were tested in this workspace. Use `scripts/field-test-record.mjs` to append dated rows after a real run.

| OEM | Model | Android | Locked screen SOS | Doze + no network | Low battery | Weak/no network upload | Reboot mid-incident | Permission loss | Volume SOS | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Google Pixel |  |  |  |  |  |  |  |  |  |  |
| Samsung |  |  |  |  |  |  |  |  |  |  |
| Huawei |  |  |  |  |  |  |  |  |  |  |
| Xiaomi |  |  |  |  |  |  |  |  |  |  |
| Oppo |  |  |  |  |  |  |  |  |  |  |
| Honor |  |  |  |  |  |  |  |  |  |  |
| Motorola |  |  |  |  |  |  |  |  |  |  |

Scenario definitions:

- **Locked screen SOS**: deliberate SOS while the lock screen is up; notification + later tracking when unlocked with permission.
- **Doze + no network**: SOS stays local and uploads after connectivity returns; no background mic restart.
- **Low battery**: evidence capture rules still respect battery floor; SOS still queues.
- **Weak/no network**: retries keep idempotency keys; no duplicate open incidents.
- **Reboot mid-incident**: boot notification asks to open Guardian; monitoring does not auto-start mic.
- **Permission loss**: location/mic revoked mid-incident surfaces honestly on Active Incident; no permission bypass.

These checks were not run in this change. A CI debug APK is not a physical-device result. This workspace cannot operate an OEM farm, put a phone into Doze, or reboot a handset.

A failure on a locked screen, Doze, or an OEM battery killer is a product result, not a reason to start the microphone from the background.
