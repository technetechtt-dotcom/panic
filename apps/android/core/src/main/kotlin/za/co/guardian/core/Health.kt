package za.co.guardian.core

enum class IncidentState {
    PROTECTED,
    CONCERN,
    HIGH_RISK,
    SOS,
    ACKNOWLEDGED,
    RESPONDING,
    USER_LOCATED,
    RESOLVED,
    ARCHIVED,
}

private val transitions: Map<IncidentState, Set<IncidentState>> = mapOf(
    IncidentState.PROTECTED to emptySet(),
    IncidentState.CONCERN to setOf(IncidentState.HIGH_RISK, IncidentState.SOS),
    IncidentState.HIGH_RISK to setOf(IncidentState.SOS, IncidentState.RESOLVED),
    IncidentState.SOS to setOf(IncidentState.ACKNOWLEDGED, IncidentState.RESOLVED),
    IncidentState.ACKNOWLEDGED to setOf(IncidentState.RESPONDING, IncidentState.USER_LOCATED, IncidentState.RESOLVED),
    IncidentState.RESPONDING to setOf(IncidentState.USER_LOCATED, IncidentState.RESOLVED),
    IncidentState.USER_LOCATED to setOf(IncidentState.RESOLVED),
    IncidentState.RESOLVED to setOf(IncidentState.ARCHIVED),
    IncidentState.ARCHIVED to emptySet(),
)

class IncidentStateMachine {
    fun canTransition(from: IncidentState, to: IncidentState): Boolean = transitions.getValue(from).contains(to)

    fun transition(from: IncidentState, to: IncidentState): IncidentState {
        require(canTransition(from, to)) { "Cannot move an incident from $from to $to." }
        return to
    }
}

enum class ProtectionLevel { PROTECTED, LIMITED_PROTECTION, PROTECTION_OFF }

enum class CheckStatus { PASS, FAIL, UNAVAILABLE }

data class HealthCheck(
    val id: String,
    val label: String,
    val status: CheckStatus,
    val detail: String,
)

data class ProtectionHealth(
    val level: ProtectionLevel,
    val checks: List<HealthCheck>,
)

class ProtectionHealthEvaluator {
    fun evaluate(signedIn: Boolean, checks: List<HealthCheck>): ProtectionHealth {
        if (!signedIn) return ProtectionHealth(ProtectionLevel.PROTECTION_OFF, checks)
        val ready = checks.all { it.status == CheckStatus.PASS }
        val level = if (ready) ProtectionLevel.PROTECTED else ProtectionLevel.LIMITED_PROTECTION
        return ProtectionHealth(level, checks)
    }
}

enum class RiskLevel { NORMAL, CONCERN, HIGH_RISK }

data class FusionResult(
    val score: Int,
    val level: RiskLevel,
    val reasons: List<String>,
)

/**
 * Explainable rules only. This engine is not called by the SOS path.
 * A deliberate trigger must never wait for this result.
 */
class SafetyFusionEngine(
    private val points: Map<String, Int> = DEFAULT_POINTS,
    private val concernAt: Int = 10,
    private val highRiskAt: Int = 40,
) {
    fun evaluate(signals: List<String>): FusionResult {
        val reasons = signals.mapNotNull { signal ->
            points[signal]?.let { signal to it }
        }
        val score = reasons.sumOf { it.second }
        val level = when {
            score >= highRiskAt -> RiskLevel.HIGH_RISK
            score >= concernAt -> RiskLevel.CONCERN
            else -> RiskLevel.NORMAL
        }
        return FusionResult(score, level, reasons.map { it.first })
    }

    companion object {
        val DEFAULT_POINTS = mapOf(
            "ROUTE_DEVIATION" to 10,
            "MISSED_CHECK_IN" to 20,
            "WEARABLE_SEPARATION" to 15,
            "VEHICLE_SPEED_MOVEMENT" to 10,
            "NO_RESPONSE" to 30,
        )
    }
}
