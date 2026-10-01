package za.co.guardian.core

enum class UploadPriority { CRITICAL, HIGH, NORMAL, BULK }

enum class NetworkClass { WIFI, CELLULAR, NO_INTERNET, POOR_NETWORK, UNKNOWN }

data class OutboxItem(
    val id: String,
    val priority: UploadPriority,
    val type: String,
    val payloadJson: String,
    val idempotencyKey: String,
    val attempts: Int,
    val nextAttemptAtEpochMs: Long,
    val createdAtEpochMs: Long,
)

fun retryDelayMs(attempt: Int, priority: UploadPriority): Long {
    val shift = (attempt - 1).coerceIn(0, 8)
    val delay = 1_000L shl shift
    val cap = if (priority == UploadPriority.CRITICAL) 30_000L else 300_000L
    return delay.coerceAtMost(cap)
}

class UploadQueue {
    private val items = linkedMapOf<String, OutboxItem>()

    fun enqueue(item: OutboxItem): Boolean {
        if (items.values.any { it.idempotencyKey == item.idempotencyKey }) return false
        items[item.id] = item
        return true
    }

    fun nextReady(nowEpochMs: Long): OutboxItem? {
        return items.values
            .filter { it.nextAttemptAtEpochMs <= nowEpochMs }
            .sortedWith(compareBy<OutboxItem> { it.priority.ordinal }.thenBy { it.createdAtEpochMs })
            .firstOrNull()
    }

    fun markSent(id: String) {
        items.remove(id)
    }

    fun markFailed(id: String, nowEpochMs: Long) {
        val current = items[id] ?: return
        val attempts = current.attempts + 1
        items[id] = current.copy(
            attempts = attempts,
            nextAttemptAtEpochMs = nowEpochMs + retryDelayMs(attempts, current.priority),
        )
    }
}

fun classifyNetwork(connected: Boolean, validated: Boolean, wifi: Boolean, cellular: Boolean): NetworkClass {
    if (!connected) return NetworkClass.NO_INTERNET
    if (!validated) return NetworkClass.POOR_NETWORK
    if (wifi) return NetworkClass.WIFI
    if (cellular) return NetworkClass.CELLULAR
    return NetworkClass.UNKNOWN
}

enum class BatteryMode { NORMAL, REDUCED, SURVIVAL, CRITICAL_ONLY }

data class BatteryThresholds(
    val reducedBelow: Int = 30,
    val survivalBelow: Int = 15,
    val criticalBelow: Int = 5,
)

fun batteryMode(levelPercent: Int, thresholds: BatteryThresholds = BatteryThresholds()): BatteryMode {
    val level = levelPercent.coerceIn(0, 100)
    return when {
        level < thresholds.criticalBelow -> BatteryMode.CRITICAL_ONLY
        level < thresholds.survivalBelow -> BatteryMode.SURVIVAL
        level < thresholds.reducedBelow -> BatteryMode.REDUCED
        else -> BatteryMode.NORMAL
    }
}
