package za.co.guardian.core

import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class GeoPoint(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double?,
    val speed: Double? = null,
    val heading: Double? = null,
    val altitude: Double? = null,
    val recordedAt: String,
    val source: String,
)

@Serializable
data class LastKnownLocation(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double?,
    val recordedAt: String,
)

@Serializable
data class DistressCapsule(
    val timestamp: String,
    val latitude: Double?,
    val longitude: Double?,
    val locationAccuracy: Double?,
    val speed: Double?,
    val heading: Double?,
    val batteryLevel: Int?,
    val chargingStatus: Boolean,
    val networkType: String,
    val protectionMode: String,
    val duress: Boolean,
    val lastKnownLocation: LastKnownLocation?,
    val appProtectionStatus: String,
)

data class CapsuleInput(
    val timestamp: String,
    val freshLocation: GeoPoint?,
    val lastKnownLocation: GeoPoint?,
    val deviceState: DeviceState,
    val protectionStatus: String,
    val isDuress: Boolean,
)

class DistressCapsuleBuilder(
    private val json: Json = Json { encodeDefaults = true },
    private val maxBytes: Int = 2048,
) {
    fun build(input: CapsuleInput): DistressCapsule {
        val fresh = input.freshLocation
        val last = input.lastKnownLocation
        return DistressCapsule(
            timestamp = input.timestamp,
            latitude = fresh?.latitude,
            longitude = fresh?.longitude,
            locationAccuracy = fresh?.accuracy,
            speed = fresh?.speed,
            heading = fresh?.heading,
            batteryLevel = input.deviceState.batteryLevel,
            chargingStatus = input.deviceState.charging,
            networkType = input.deviceState.networkType,
            protectionMode = "NORMAL",
            duress = input.isDuress,
            lastKnownLocation = last?.let {
                LastKnownLocation(it.latitude, it.longitude, it.accuracy, it.recordedAt)
            },
            appProtectionStatus = input.protectionStatus,
        )
    }

    fun encode(capsule: DistressCapsule): String {
        val encoded = json.encodeToString(capsule)
        val size = encoded.toByteArray(Charsets.UTF_8).size
        require(size <= maxBytes) { "Distress capsule is $size bytes and exceeds $maxBytes." }
        return encoded
    }
}
