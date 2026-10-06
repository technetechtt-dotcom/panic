# Wear OS and Apple Watch

The phone already accepts a same-signature broadcast, `za.co.guardian.action.WEARABLE_SOS`, from a companion installed with the same signing key. That broadcast does not cross from a watch to the phone by itself.

A Wear OS app that can wake the phone needs the Wearable message client and a Play services dependency. That module is not in the Android Gradle build, so this workspace does not produce a watch APK.

There is no Apple Watch binary. An Apple Watch app needs Xcode, a signing team, and WatchConnectivity. The iOS folder is a Swift SOS client only, and it has not been compiled here.
