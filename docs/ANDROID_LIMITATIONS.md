# Android limitations

These limits come from current Android platform rules and Play policy. This version does not try to work around them.

## Volume-button SOS

Guardian observes volume keys with an `AccessibilityService` and `flagRequestFilterKeyEvents`. Settings shows a disclosure before opening the Android accessibility screen. The service is not marked `isAccessibilityTool`. `onKeyEvent` returns false, so the volume still changes. Three volume-down presses send a deliberate SOS. A 30 second button test records the pattern and does not send. Play may still require an accessibility declaration before publishing the app.

The service cannot be started by Guardian itself. If Android blocks a foreground service started from the accessibility service while the app is in the background, the SOS is stored and tracking waits until the app is opened.

## Microphone and camera

Android 14 and later will not start a microphone or camera foreground service from the background. The system shows the microphone and camera indicators. Those indicators cannot be hidden.

Safe-word listening starts only from a button in the open app. It uses `SpeechRecognizer` with `EXTRA_PREFER_OFFLINE` and compares the transcript on the phone with `safeWordMatches`. Guardian does not upload that audio. If the phone has no speech recognizer, or no offline model, listening stops and the checklist says so. The recognizer is still a system component and may use the network when an offline model is missing.

Optional SOS audio is separate. It records only after the person turns on sharing and presses SOS on screen, for up to 120 one-second chunks, with the microphone indicator visible. There is no camera capture.

## Location

The SOS path uses `LocationManager`, not Play Services, so a missing Google Play build does not block the capsule.

`ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` are requested. `ACCESS_BACKGROUND_LOCATION` is not. After the user presses SOS in the foreground, a location foreground service can keep receiving updates while that process stays alive. The notification stays visible.

If the process is killed or the phone reboots, `ResumeProtectionReceiver` only posts a notification. It does not start the foreground service. Tracking continues when the person opens the app and the activity starts the service again. Some OEM batteries will kill the process sooner than AOSP. Doze can delay the WorkManager flush. The distress capsule is already on disk before those delays.

A last-known fix is treated as current only when it is at most two minutes old. Older fixes are sent as `lastKnownLocation` with current coordinates null. The SOS is still sent.

## Network and battery

No validated network is `NO_INTERNET`. A connected network without `NET_CAPABILITY_VALIDATED` is `POOR_NETWORK`. Otherwise the type is Wi-Fi, cellular, or unknown.

Battery modes are computed for the heartbeat: above 30 percent `NORMAL`, 15 to 30 `REDUCED`, 5 to 15 `SURVIVAL`, below 5 `CRITICAL_ONLY`. This version still sends the capsule, location, and heartbeat at every level, because there is no audio or video work to shed.

## What the debug build allows

Cleartext HTTP is enabled only in the debug manifest, aimed at `http://10.0.2.2:3000/api/v1/` on the emulator. Do not ship that configuration.

Backup is disabled. The token store uses EncryptedSharedPreferences. The master-key helper is the `security-crypto` 1.0.0 `MasterKeys` API. A later move to the newer `MasterKey` API is a library upgrade, not a change in the product rule that tokens stay in Keystore-backed storage.

## Play and privacy

Do not add an accessibility service, a hidden microphone, or a background location permission to make a demo look more complete. Each of those needs its own disclosure, permission flow, and store declaration, and each can be rejected if it is broader than the emergency the person turned on.
