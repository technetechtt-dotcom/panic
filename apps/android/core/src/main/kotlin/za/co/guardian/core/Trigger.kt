package za.co.guardian.core

import kotlinx.serialization.Serializable

enum class TriggerType {
    VOLUME_BUTTON,
    VOICE_SAFE_WORD,
    MANUAL_SOS,
    JOURNEY_TIMEOUT,
    WEARABLE,
    FALL_OR_IMPACT,
    SAFETY_CHECK_FAILURE,
    DURESS,
    SYSTEM_RISK_ESCALATION,
}

val DELIBERATE_TRIGGERS = setOf(
    TriggerType.VOLUME_BUTTON,
    TriggerType.VOICE_SAFE_WORD,
    TriggerType.MANUAL_SOS,
    TriggerType.DURESS,
)

enum class TriggerDisposition {
    IMMEDIATE_INCIDENT,
    HOLD_FOR_FUSION,
}

@Serializable
data class DeviceState(
    val batteryLevel: Int?,
    val charging: Boolean,
    val networkType: String,
    val batteryMode: String,
)

data class TriggerEvent(
    val triggerId: String,
    val userId: String,
    val deviceId: String,
    val triggerType: TriggerType,
    val timestampEpochMs: Long,
    val confidence: Double?,
    val protectionSessionId: String?,
    val metadata: Map<String, String>,
    val deviceState: DeviceState,
)

data class TriggerDecision(
    val disposition: TriggerDisposition,
    val event: TriggerEvent,
)

/**
 * Deliberate triggers become incidents immediately.
 * Confidence is recorded and is never allowed to block a deliberate trigger.
 */
class EmergencyTriggerEngine {
    fun receive(event: TriggerEvent): TriggerDecision {
        val disposition = if (event.triggerType in DELIBERATE_TRIGGERS) {
            TriggerDisposition.IMMEDIATE_INCIDENT
        } else {
            TriggerDisposition.HOLD_FOR_FUSION
        }
        return TriggerDecision(disposition, event)
    }
}
