package za.co.guardian.core

enum class VolumeKey { UP, DOWN }

enum class VolumePattern(val key: VolumeKey, val presses: Int) {
    DOWN_2(VolumeKey.DOWN, 2),
    DOWN_3(VolumeKey.DOWN, 3),
    UP_2(VolumeKey.UP, 2),
    UP_3(VolumeKey.UP, 3),
    ;

    companion object {
        fun fromStored(value: String?): VolumePattern = entries.firstOrNull { it.name == value } ?: DOWN_3
    }
}

class VolumeChordDetector(
    var requiredPresses: Int = 3,
    var windowMs: Long = 1_500,
    var direction: VolumeKey = VolumeKey.DOWN,
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

fun triggerStage(triggerCount: Int): String = when {
    triggerCount <= 1 -> "SOS"
    triggerCount == 2 -> "EVIDENCE"
    else -> "PRIORITY"
}

fun phraseQualityWarning(phrase: String): String {
    val words = normalisePhrase(phrase).split(" ").filter { it.isNotBlank() }
    if (words.isEmpty()) return "Choose a phrase before turning listening on."
    if (words.size == 1 && words[0].length < 6) {
        return "\"${words[0]}\" — high false-trigger risk. A phrase such as \"red dog\" is better, and a sentence is stronger."
    }
    if (words.size == 1) return "A single word is easier to say by accident. Two or more words are safer."
    if (words.size >= 4) return "This is a strong phrase."
    return "This phrase is better than a single short word."
}

const val KEYWORD_FRAMES = 16
const val MFCC_COUNT = 13
const val FEATURES_PER_FRAME = MFCC_COUNT + 2
const val KEYWORD_FEATURE_SIZE = KEYWORD_FRAMES * FEATURES_PER_FRAME
private const val MEL_FILTERS = 26

private fun hzToMel(hz: Double): Double = 2595.0 * kotlin.math.ln(1.0 + hz / 700.0)
private fun melToHz(mel: Double): Double = 700.0 * (kotlin.math.exp(mel / 2595.0) - 1.0)

private fun frameMfcc(samples: ShortArray, start: Int, end: Int, sampleRate: Int): FloatArray {
    val count = (end - start).coerceAtLeast(1)
    val windowed = DoubleArray(count) { index ->
        val sample = samples[start + index] / 32768.0
        val ham = 0.54 - 0.46 * kotlin.math.cos(2.0 * Math.PI * index / (count - 1).coerceAtLeast(1))
        sample * ham
    }
    var energy = 0.0
    var crossings = 0
    for (index in windowed.indices) {
        energy += windowed[index] * windowed[index]
        if (index > 0 && (windowed[index - 1] >= 0.0) != (windowed[index] >= 0.0)) crossings += 1
    }
    val nfft = Integer.highestOneBit(count * 2 - 1).coerceAtLeast(256)
    val spectrum = DoubleArray(nfft / 2 + 1)
    for (bin in spectrum.indices) {
        var re = 0.0
        var im = 0.0
        val omega = 2.0 * Math.PI * bin / nfft
        for (index in windowed.indices) {
            re += windowed[index] * kotlin.math.cos(omega * index)
            im -= windowed[index] * kotlin.math.sin(omega * index)
        }
        spectrum[bin] = re * re + im * im
    }
    val maxHz = sampleRate / 2.0
    val minMel = hzToMel(0.0)
    val maxMel = hzToMel(maxHz)
    val filter = DoubleArray(MEL_FILTERS)
    for (m in 0 until MEL_FILTERS) {
        val left = melToHz(minMel + (maxMel - minMel) * m / (MEL_FILTERS + 1))
        val center = melToHz(minMel + (maxMel - minMel) * (m + 1) / (MEL_FILTERS + 1))
        val right = melToHz(minMel + (maxMel - minMel) * (m + 2) / (MEL_FILTERS + 1))
        var sum = 0.0
        for (bin in spectrum.indices) {
            val hz = bin * maxHz / (spectrum.size - 1)
            val weight = when {
                hz < left || hz > right -> 0.0
                hz <= center -> (hz - left) / (center - left).coerceAtLeast(1.0)
                else -> (right - hz) / (right - center).coerceAtLeast(1.0)
            }
            sum += spectrum[bin] * weight
        }
        filter[m] = kotlin.math.ln((sum + 1e-10))
    }
    val features = FloatArray(FEATURES_PER_FRAME)
    features[0] = kotlin.math.sqrt(energy / count).toFloat()
    features[1] = (crossings.toFloat() / count)
    for (c in 0 until MFCC_COUNT) {
        var sum = 0.0
        for (m in filter.indices) {
            sum += filter[m] * kotlin.math.cos(Math.PI * c * (m + 0.5) / MEL_FILTERS)
        }
        features[c + 2] = sum.toFloat()
    }
    return features
}

fun pcmFeatures(samples: ShortArray, sampleRate: Int = 16_000): FloatArray {
    if (samples.isEmpty()) return FloatArray(KEYWORD_FEATURE_SIZE)
    val result = FloatArray(KEYWORD_FEATURE_SIZE)
    val frameSize = (samples.size / KEYWORD_FRAMES).coerceAtLeast(1)
    for (frame in 0 until KEYWORD_FRAMES) {
        val start = frame * frameSize
        val end = if (frame == KEYWORD_FRAMES - 1) samples.size else (start + frameSize).coerceAtMost(samples.size)
        val f = frameMfcc(samples, start, end, sampleRate)
        System.arraycopy(f, 0, result, frame * FEATURES_PER_FRAME, FEATURES_PER_FRAME)
    }
    return result
}

fun featureSimilarity(left: FloatArray, right: FloatArray): Float {
    val width = minOf(left.size, right.size)
    if (width == 0) return 0f
    var dot = 0.0
    var leftEnergy = 0.0
    var rightEnergy = 0.0
    for (index in 0 until width) {
        dot += left[index] * right[index]
        leftEnergy += left[index] * left[index]
        rightEnergy += right[index] * right[index]
    }
    if (leftEnergy <= 0.0 || rightEnergy <= 0.0) return 0f
    return (dot / (kotlin.math.sqrt(leftEnergy) * kotlin.math.sqrt(rightEnergy))).toFloat()
}

fun frameSimilarity(left: FloatArray, leftOffset: Int, right: FloatArray, rightOffset: Int, length: Int = FEATURES_PER_FRAME): Float {
    var specDot = 0.0
    var leftSpecEnergy = 0.0
    var rightSpecEnergy = 0.0
    for (i in 2 until length) {
        val l = left[leftOffset + i]
        val r = right[rightOffset + i]
        specDot += l * r
        leftSpecEnergy += l * l
        rightSpecEnergy += r * r
    }
    val specSim = if (leftSpecEnergy > 0.0 && rightSpecEnergy > 0.0) {
        (specDot / (kotlin.math.sqrt(leftSpecEnergy) * kotlin.math.sqrt(rightSpecEnergy))).toFloat()
    } else 0f

    val zcrDiff = kotlin.math.abs(left[leftOffset + 1] - right[rightOffset + 1])
    val zcrSim = (1.0f - zcrDiff * 8f).coerceIn(0f, 1f)
    val leftEnergy = left[leftOffset]
    val rightEnergy = right[rightOffset]
    val energySim = if (leftEnergy <= 0f && rightEnergy <= 0f) 1f
    else (minOf(leftEnergy, rightEnergy) / maxOf(leftEnergy, rightEnergy).coerceAtLeast(1e-6f)).coerceIn(0f, 1f)
    return (0.5f * specSim + 0.35f * zcrSim + 0.15f * energySim).coerceIn(0f, 1f)
}

fun keywordConfidence(live: FloatArray, enrolled: FloatArray): Float {
    if (live.isEmpty() || enrolled.isEmpty()) return 0f
    if (live.size < KEYWORD_FEATURE_SIZE || enrolled.size < KEYWORD_FEATURE_SIZE) {
        return featureSimilarity(live, enrolled)
    }
    var maxEnergy = 0f
    for (f in 0 until KEYWORD_FRAMES) {
        val frameEnergy = live[f * FEATURES_PER_FRAME]
        if (frameEnergy > maxEnergy) maxEnergy = frameEnergy
    }
    if (maxEnergy < 0.004f) return 0f
    val rows = KEYWORD_FRAMES
    val cols = KEYWORD_FRAMES
    val cost = Array(rows) { FloatArray(cols) }
    for (i in 0 until rows) {
        for (j in 0 until cols) {
            val local = 1f - frameSimilarity(live, i * FEATURES_PER_FRAME, enrolled, j * FEATURES_PER_FRAME)
            val prev = when {
                i == 0 && j == 0 -> 0f
                i == 0 -> cost[0][j - 1]
                j == 0 -> cost[i - 1][0]
                else -> minOf(cost[i - 1][j], cost[i][j - 1], cost[i - 1][j - 1])
            }
            cost[i][j] = local + prev
        }
    }
    val path = cost[rows - 1][cols - 1] / rows.coerceAtLeast(1)
    return (1f - path).coerceIn(0f, 1f)
}

fun keywordConfidenceScore(live: FloatArray, enrolled: List<FloatArray>): Float {
    if (enrolled.isEmpty()) return 0f
    return enrolled.maxOfOrNull { keywordConfidence(live, it) } ?: 0f
}

fun keywordTemplateQuality(features: FloatArray): String {
    if (features.size < KEYWORD_FEATURE_SIZE) return "That sample was too short."
    var energy = 0f
    for (frame in 0 until KEYWORD_FRAMES) energy += features[frame * FEATURES_PER_FRAME]
    if (energy / KEYWORD_FRAMES < 0.008f) return "That sample was too quiet. Record the phrase again."
    return ""
}

fun keywordEnrollmentValid(templates: List<FloatArray>, sensitivity: Int = 50): Boolean {
    if (templates.size < 2) return false
    if (templates.any { keywordTemplateQuality(it).isNotBlank() }) return false
    return templates.indices.all { index ->
        val others = templates.filterIndexed { other, _ -> other != index }
        keywordMatches(templates[index], others, sensitivity)
    }
}

fun keywordMatches(live: FloatArray, enrolled: List<FloatArray>, sensitivity: Int): Boolean {
    if (enrolled.isEmpty()) return false
    val confidence = keywordConfidenceScore(live, enrolled)
    val votes = enrolled.count { keywordConfidence(live, it) >= 0.86f - (sensitivity.coerceIn(0, 100) / 100f) * 0.18f }
    val threshold = 0.86f - (sensitivity.coerceIn(0, 100) / 100f) * 0.18f
    return votes >= (enrolled.size + 1) / 2 && confidence >= threshold
}

fun locationIntervalMs(mode: String): Long = when (mode) {
    "CRITICAL_ONLY" -> 180_000
    "SURVIVAL" -> 60_000
    "REDUCED" -> 15_000
    else -> 5_000
}

fun monitoringTickMs(mode: String): Long = when (mode) {
    "CRITICAL_ONLY" -> 120_000
    "SURVIVAL" -> 60_000
    "REDUCED" -> 30_000
    else -> 15_000
}

/** A low-g sample followed by a hard spike. This is a candidate, not a diagnosis. */
fun impactPattern(magnitudes: List<Float>): Boolean {
    var fell = false
    for (value in magnitudes.takeLast(50)) {
        if (value < 3.5f) fell = true
        if (fell && value > 28f) return true
    }
    return false
}

fun fallCountdownDone(cancelled: Boolean, elapsedMs: Long, windowMs: Long = 20_000): Boolean {
    return !cancelled && elapsedMs >= windowMs
}

const val WEARABLE_SOS_ACTION = "za.co.guardian.action.WEARABLE_SOS"

fun freezeIsArmed(decoyPin: String, releasePin: String): Boolean {
    return decoyPin.length in 4..8 && releasePin.length in 4..8 && decoyPin != releasePin
}

/** A decoy PIN is the password a person can enter while being told to pay. It is not a login password. */
fun decoyPinFreezes(entered: String, decoyPin: String): Boolean {
    return decoyPin.length in 4..8 && entered == decoyPin
}

fun releasePinMatches(entered: String, releasePin: String): Boolean {
    return releasePin.length in 4..8 && entered == releasePin
}

fun freezePatternsAreDistinct(sos: VolumePattern, freeze: VolumePattern): Boolean = sos.key != freeze.key

fun emergencyDialNumber(countryCode: String = "ZA"): String = if (countryCode == "ZA") "112" else "112"

fun captureEvidence(kind: String, batteryPercent: Int): Boolean {
    val mode = batteryMode(batteryPercent)
    return when (kind) {
        "audio" -> true
        "photo" -> mode == BatteryMode.NORMAL || mode == BatteryMode.REDUCED
        "video" -> mode == BatteryMode.NORMAL
        else -> false
    }
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

enum class MonitoringOrigin {
    USER_VISIBLE,
    ACCESSIBILITY,
    PROCESS_FOREGROUND,
    BACKGROUND,
}

data class MonitoringStart(
    val startService: Boolean,
    val locationUpdates: Boolean,
    val microphone: Boolean,
    val notifyToOpenApp: Boolean,
)

/**
 * Android 14 does not let a background start include the microphone or camera.
 * A background broadcast or a reboot also cannot be assumed to start a location
 * foreground service. The SOS itself is already stored before this plan runs.
 */
fun monitoringStart(
    origin: MonitoringOrigin,
    locationGranted: Boolean,
    microphoneGranted: Boolean,
    microphoneRequested: Boolean,
): MonitoringStart {
    val microphone = origin == MonitoringOrigin.USER_VISIBLE && microphoneGranted && microphoneRequested
    return when (origin) {
        MonitoringOrigin.USER_VISIBLE -> MonitoringStart(
            startService = true,
            locationUpdates = locationGranted,
            microphone = microphone,
            notifyToOpenApp = false,
        )
        MonitoringOrigin.ACCESSIBILITY,
        MonitoringOrigin.PROCESS_FOREGROUND,
        -> MonitoringStart(
            startService = true,
            locationUpdates = locationGranted,
            microphone = false,
            notifyToOpenApp = true,
        )
        MonitoringOrigin.BACKGROUND -> MonitoringStart(
            startService = false,
            locationUpdates = false,
            microphone = false,
            notifyToOpenApp = true,
        )
    }
}

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
    val stage: String = "EVIDENCE",
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
