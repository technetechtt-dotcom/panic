package za.co.guardian.core

enum class VolumeKey { UP, DOWN }

class VolumeChordDetector(
    private val requiredPresses: Int = 3,
    private val windowMs: Long = 1_500,
    private val direction: VolumeKey = VolumeKey.DOWN,
) {
    private val presses = ArrayDeque<Long>()

    fun onPress(key: VolumeKey, atMs: Long): Boolean {
        if (key != direction) {
            presses.clear()
            return false
        }
        presses.addLast(atMs)
        while (presses.isNotEmpty() && atMs - presses.first() > windowMs) presses.removeFirst()
        if (presses.size >= requiredPresses) {
            presses.clear()
            return true
        }
        return false
    }
}

fun normalisePhrase(value: String): String {
    return value.lowercase().replace(Regex("[^a-z0-9 ]"), " ").trim().replace(Regex(" +"), " ")
}

fun safeWordMatches(transcript: String, phrase: String): Boolean {
    val wanted = normalisePhrase(phrase)
    if (wanted.length < 4) return false
    val heard = normalisePhrase(transcript)
    if (heard.isEmpty()) return false
    return heard == wanted || heard.startsWith("$wanted ") || heard.endsWith(" $wanted") || heard.contains(" $wanted ")
}

data class TestSession(val expiresAtEpochMs: Long) {
    fun active(nowEpochMs: Long): Boolean = nowEpochMs < expiresAtEpochMs
    fun remainingMs(nowEpochMs: Long): Long = (expiresAtEpochMs - nowEpochMs).coerceAtLeast(0)
}

fun startTestSession(nowEpochMs: Long, durationMs: Long = 10 * 60 * 1000): TestSession {
    require(durationMs in 60_000..30 * 60 * 1000) { "A test session must last between 1 and 30 minutes." }
    return TestSession(nowEpochMs + durationMs)
}

data class StoredBreadcrumb(
    val clientPointId: String,
    val localTriggerId: String,
    var incidentServerId: String?,
    var uploaded: Boolean,
)

class LocationBreadcrumbLog {
    private val rows = mutableListOf<StoredBreadcrumb>()

    fun record(localTriggerId: String?, clientPointId: String): Boolean {
        if (localTriggerId.isNullOrBlank()) return false
        rows += StoredBreadcrumb(clientPointId, localTriggerId, null, false)
        return true
    }

    fun bind(localTriggerId: String, incidentServerId: String) {
        rows.filter { it.localTriggerId == localTriggerId && it.incidentServerId == null }.forEach {
            it.incidentServerId = incidentServerId
        }
    }

    fun readyToUpload(): List<StoredBreadcrumb> = rows.filter { it.incidentServerId != null && !it.uploaded }
}

fun shouldCaptureLocation(locationGranted: Boolean): Boolean = locationGranted

fun heartbeatCoordinates(
    locationGranted: Boolean,
    latitude: Double?,
    longitude: Double?,
): Pair<Double?, Double?> {
    if (!locationGranted) return null to null
    return latitude to longitude
}

fun deviceProofMessage(triggerId: String, devicePublicId: String, signedAt: String): String {
    return "$triggerId|$devicePublicId|$signedAt"
}

data class LocalEscalation(
    val triggerId: String,
    val incidentTriggerId: String,
    val triggerType: String,
    val createdAtEpochMs: Long,
    val sent: Boolean,
)

interface EscalationLocalStore {
    suspend fun add(item: LocalEscalation)
    suspend fun pending(): List<LocalEscalation>
    suspend fun markSent(triggerId: String)
}

class MemoryEscalationStore : EscalationLocalStore {
    private val rows = linkedMapOf<String, LocalEscalation>()
    override suspend fun add(item: LocalEscalation) {
        rows.putIfAbsent(item.triggerId, item)
    }
    override suspend fun pending(): List<LocalEscalation> = rows.values.filter { !it.sent }
    override suspend fun markSent(triggerId: String) {
        val row = rows[triggerId] ?: return
        rows[triggerId] = row.copy(sent = true)
    }
}
