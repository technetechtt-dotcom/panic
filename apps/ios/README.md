# Guardian iOS client

This folder is a Swift source client for the same SOS API the Android app uses. It was not compiled, signed, or run on a device. This workspace is Windows, and there is no Xcode project or App Store build here.

A real iPhone app still has to request permissions in the open, keep the microphone and location indicators visible, and follow the same emergency-credential limits as Android. This source does not bypass those rules.

The Android coercion freeze is not in this client. iOS does not let an App Store app pin the whole device. Guided Access is a system setting the person turns on themselves.
