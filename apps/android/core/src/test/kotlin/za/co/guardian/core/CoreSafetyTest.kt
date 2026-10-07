package za.co.guardian.core

import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CoreSafetyTest {
    private val device = DeviceState(80, false, "CELLULAR", "NORMAL")

    @Test
    fun deliberateSosDoesNotWaitForConfidenceOrFusion() {
        val engine = EmergencyTriggerEngine()
        val manual = engine.receive(event(TriggerType.MANUAL_SOS, confidence = null))
        val whispered = engine.receive(event(TriggerType.VOICE_SAFE_WORD, confidence = 0.1))
        val duress = engine.receive(event(TriggerType.DURESS, confidence = null))
        val fall = engine.receive(event(TriggerType.FALL_OR_IMPACT, confidence = 0.99))
        assertEquals(TriggerDisposition.IMMEDIATE_INCIDENT, manual.disposition)
        assertEquals(TriggerDisposition.IMMEDIATE_INCIDENT, whispered.disposition)
        assertEquals(TriggerDisposition.IMMEDIATE_INCIDENT, duress.disposition)
        assertEquals(TriggerDisposition.HOLD_FOR_FUSION, fall.disposition)
    }

    @Test
    fun distressCapsuleStaysSmallAndAllowsAMissingFix() {
        val builder = DistressCapsuleBuilder()
        val capsule = builder.build(
            CapsuleInput("2026-10-01T09:00:00.000Z", null, null, device, "LIMITED_PROTECTION", false),
        )
        assertNull(capsule.latitude)
        assertTrue(builder.encode(capsule).toByteArray().size < 800)
    }

    @Test
    fun criticalUploadsLeaveTheQueueBeforeBulkAndRetriesKeepTheIdempotencyKey() {
        val queue = UploadQueue()
        assertTrue(queue.enqueue(item("bulk", UploadPriority.BULK, "video-1", 1)))
        assertTrue(queue.enqueue(item("sos", UploadPriority.CRITICAL, "sos-1", 2)))
        assertFalse(queue.enqueue(item("sos-copy", UploadPriority.CRITICAL, "sos-1", 3)))
        assertEquals("sos", queue.nextReady(10)?.id)
        queue.markFailed("sos", 10)
        assertEquals("sos-1", queue.nextReady(10_000)?.idempotencyKey)
        assertEquals(1_000L, retryDelayMs(1, UploadPriority.CRITICAL))
        assertEquals(30_000L, retryDelayMs(10, UploadPriority.CRITICAL))
    }

    @Test
    fun offlineSosIsStoredOnceAndARetryDoesNotCreateAnotherIncident() = runBlocking {
        val store = MemoryIncidentStore()
        var calls = 0
        val remote = object : IncidentRemoteApi {
            override suspend fun create(incident: LocalIncident, stage: String): RemoteCreateResult {
                calls += 1
                if (calls == 1) error("offline")
                return RemoteCreateResult("server-1", calls > 2)
            }

            override suspend fun escalate(incident: LocalIncident, triggerId: String, type: TriggerType, stage: String): RemoteCreateResult {
                return RemoteCreateResult(incident.serverId ?: "missing", false, true)
            }
        }
        val repository = repository(store, remote)
        val first = repository.triggerManual(context(isTest = true))
        assertEquals(SyncState.PENDING, first.syncState)
        assertEquals(1, store.rows.size)
        val sent = repository.flush()
        assertEquals(1, sent)
        assertEquals("server-1", store.get(first.triggerId)?.serverId)
        assertEquals(1, store.rows.size)
        assertEquals(2, calls)
    }

    @Test
    fun protectionIsLimitedWhenACheckIsUnavailableAndOffWhenSignedOut() {
        val evaluator = ProtectionHealthEvaluator()
        val checks = listOf(
            HealthCheck("location", "Location", CheckStatus.PASS, "Granted"),
            HealthCheck("volume", "Volume trigger", CheckStatus.UNAVAILABLE, "Not in this version"),
        )
        assertEquals(ProtectionLevel.LIMITED_PROTECTION, evaluator.evaluate(true, checks).level)
        assertEquals(ProtectionLevel.PROTECTION_OFF, evaluator.evaluate(false, checks).level)
        assertEquals(ProtectionLevel.PROTECTED, evaluator.evaluate(true, listOf(checks[0].copy(id = "only"))).level)
    }

    @Test
    fun fusionExplainsItsScoreAndIsSeparateFromDeliberateSos() {
        val fusion = SafetyFusionEngine()
        val concern = fusion.evaluate(listOf("ROUTE_DEVIATION"))
        assertEquals(RiskLevel.CONCERN, concern.level)
        assertEquals(listOf("ROUTE_DEVIATION"), concern.reasons)
        val high = fusion.evaluate(
            listOf("ROUTE_DEVIATION", "MISSED_CHECK_IN", "WEARABLE_SEPARATION", "VEHICLE_SPEED_MOVEMENT", "NOT_A_RULE"),
        )
        assertEquals(55, high.score)
        assertEquals(RiskLevel.HIGH_RISK, high.level)
        assertEquals(4, high.reasons.size)
    }

    @Test
    fun incidentTransitionsMatchTheServerContract() {
        val machine = IncidentStateMachine()
        assertEquals(IncidentState.ACKNOWLEDGED, machine.transition(IncidentState.SOS, IncidentState.ACKNOWLEDGED))
        assertFailsWith<IllegalArgumentException> {
            machine.transition(IncidentState.RESOLVED, IncidentState.SOS)
        }
    }

    @Test
    fun aSecondTriggerEscalatesTheOpenIncidentInsteadOfCreatingAnother() = runBlocking {
        val store = MemoryIncidentStore()
        val escalations = MemoryEscalationStore()
        var created = 0
        var escalated = 0
        val remote = object : IncidentRemoteApi {
            override suspend fun create(incident: LocalIncident, stage: String): RemoteCreateResult {
                created += 1
                return RemoteCreateResult("server-1", false)
            }
            override suspend fun escalate(incident: LocalIncident, triggerId: String, type: TriggerType, stage: String): RemoteCreateResult {
                escalated += 1
                return RemoteCreateResult(incident.serverId ?: "missing", false, true)
            }
        }
        var n = 0
        val repository = OfflineIncidentRepository(
            store,
            remote,
            newId = { "id-${n++}" },
            now = { 1_000L },
            timestamp = { "2026-10-01T09:00:01.000Z" },
            escalations = escalations,
        )
        val first = repository.trigger(TriggerType.MANUAL_SOS, context(false))
        val second = repository.trigger(TriggerType.VOLUME_BUTTON, context(false))
        assertEquals(first.triggerId, second.triggerId)
        assertEquals(1, store.rows.size)
        assertEquals(1, created)
        assertEquals(1, escalated)
    }

    @Test
    fun locationBreadcrumbsAreKeptBeforeAServerIncidentExists() {
        val log = LocationBreadcrumbLog()
        assertFalse(log.record(null, "point-0"))
        assertTrue(log.record("local-1", "point-1"))
        assertTrue(log.readyToUpload().isEmpty())
        log.bind("local-1", "server-1")
        assertEquals("server-1", log.readyToUpload().single().incidentServerId)
    }

    @Test
    fun heartbeatOmitsCoordinatesWhenLocationPermissionIsMissing() {
        assertFalse(shouldCaptureLocation(false))
        assertEquals(null to null, heartbeatCoordinates(false, -26.2, 28.0))
        assertEquals(-26.2 to 28.0, heartbeatCoordinates(true, -26.2, 28.0))
    }

    @Test
    fun volumeChordAndSafeWordAndTestSessionFollowTheirRules() {
        val detector = VolumeChordDetector(requiredPresses = 3, windowMs = 1_000, direction = VolumeKey.DOWN)
        assertFalse(detector.onPress(VolumeKey.DOWN, 0))
        assertFalse(detector.onPress(VolumeKey.DOWN, 100))
        assertFalse(detector.onPress(VolumeKey.UP, 150))
        assertFalse(detector.onPress(VolumeKey.DOWN, 200))
        assertFalse(detector.onPress(VolumeKey.DOWN, 300))
        assertTrue(detector.onPress(VolumeKey.DOWN, 400))
        assertTrue(safeWordMatches("please call the safe harbour now", "safe harbour"))
        assertFalse(safeWordMatches("safe", "safe harbour"))
        assertEquals("SOS", triggerStage(1))
        assertEquals("EVIDENCE", triggerStage(2))
        assertEquals("PRIORITY", triggerStage(3))
        assertTrue(phraseQualityWarning("dog").contains("high false-trigger"))
        val tone = pcmFeatures(ShortArray(1600) { index -> (kotlin.math.sin(index / 8.0) * 8000).toInt().toShort() })
        assertEquals(KEYWORD_FEATURE_SIZE, tone.size)
        assertTrue(keywordMatches(tone, listOf(tone), 40))
        assertFalse(keywordMatches(tone, emptyList(), 100))
        val tone1 = pcmFeatures(ShortArray(16000) { index -> (kotlin.math.sin(index / 8.0) * 8000).toInt().toShort() })
        val toneDiff = pcmFeatures(ShortArray(16000) { index -> (kotlin.math.sin(index / 2.0) * 8000).toInt().toShort() })
        val silence = pcmFeatures(ShortArray(16000) { 0 })
        assertTrue(keywordConfidence(tone1, tone1) > 0.95f)
        assertTrue(keywordMatches(tone1, listOf(tone1), 50))
        assertFalse(keywordMatches(toneDiff, listOf(tone1), 50))
        assertFalse(keywordMatches(silence, listOf(tone1), 50))
        assertTrue(captureEvidence("audio", 4))
        assertFalse(captureEvidence("video", 4))
        assertFalse(captureEvidence("photo", 10))
        assertTrue(locationIntervalMs("SURVIVAL") > locationIntervalMs("NORMAL"))
        assertTrue(impactPattern(listOf(9.8f, 2f, 40f)))
        assertFalse(impactPattern(listOf(9.8f, 9.8f, 12f)))
        assertFalse(fallCountdownDone(cancelled = true, elapsedMs = 21_000))
        assertTrue(fallCountdownDone(cancelled = false, elapsedMs = 20_000))
        assertTrue(freezeIsArmed("2580", "2468"))
        assertFalse(freezeIsArmed("2580", "2580"))
        assertTrue(decoyPinFreezes("2580", "2580"))
        assertFalse(decoyPinFreezes("1111", "2580"))
        assertTrue(releasePinMatches("2468", "2468"))
        assertFalse(releasePinMatches("2580", "2468"))
        assertTrue(freezePatternsAreDistinct(VolumePattern.DOWN_3, VolumePattern.UP_2))
        assertFalse(freezePatternsAreDistinct(VolumePattern.DOWN_3, VolumePattern.DOWN_2))
        assertEquals("112", emergencyDialNumber())
        val visible = monitoringStart(MonitoringOrigin.USER_VISIBLE, locationGranted = true, microphoneGranted = true, microphoneRequested = true)
        assertTrue(visible.startService && visible.locationUpdates && visible.microphone)
        val volume = monitoringStart(MonitoringOrigin.ACCESSIBILITY, locationGranted = true, microphoneGranted = true, microphoneRequested = true)
        assertTrue(volume.startService && volume.locationUpdates)
        assertFalse(volume.microphone)
        val pocket = monitoringStart(MonitoringOrigin.BACKGROUND, locationGranted = true, microphoneGranted = true, microphoneRequested = true)
        assertFalse(pocket.startService || pocket.locationUpdates || pocket.microphone)
        assertTrue(pocket.notifyToOpenApp)
        val session = startTestSession(1_000, 60_000)
        assertTrue(session.active(30_000))
        assertFalse(session.active(61_000))
        assertEquals(0L, session.remainingMs(61_000))
    }

    @Test
    fun networkAndBatteryPoliciesUseTheDocumentedThresholds() {
        assertEquals(NetworkClass.NO_INTERNET, classifyNetwork(false, false, false, false))
        assertEquals(NetworkClass.POOR_NETWORK, classifyNetwork(true, false, true, false))
        assertEquals(NetworkClass.WIFI, classifyNetwork(true, true, true, false))
        assertEquals(BatteryMode.NORMAL, batteryMode(40))
        assertEquals(BatteryMode.REDUCED, batteryMode(20))
        assertEquals(BatteryMode.SURVIVAL, batteryMode(10))
        assertEquals(BatteryMode.CRITICAL_ONLY, batteryMode(4))
    }

    private fun event(type: TriggerType, confidence: Double?) = TriggerEvent(
        triggerId = "t",
        userId = "u",
        deviceId = "d",
        triggerType = type,
        timestampEpochMs = 0,
        confidence = confidence,
        protectionSessionId = null,
        metadata = emptyMap(),
        deviceState = device,
    )

    private fun item(id: String, priority: UploadPriority, key: String, createdAt: Long) = OutboxItem(
        id = id,
        priority = priority,
        type = "UPLOAD",
        payloadJson = "{}",
        idempotencyKey = key,
        attempts = 0,
        nextAttemptAtEpochMs = 0,
        createdAtEpochMs = createdAt,
    )

    private fun context(isTest: Boolean) = SosContext(
        userId = "user",
        deviceId = "device",
        isTest = isTest,
        freshLocation = null,
        lastKnownLocation = null,
        deviceState = device,
        protectionStatus = "LIMITED_PROTECTION",
    )

    private fun repository(store: IncidentLocalStore, remote: IncidentRemoteApi): OfflineIncidentRepository {
        var n = 0
        return OfflineIncidentRepository(store, remote, newId = { "id-${n++}" }, now = { 1_000L }, timestamp = { "2026-10-01T09:00:01.000Z" })
    }
}

private class MemoryIncidentStore : IncidentLocalStore {
    val rows = linkedMapOf<String, LocalIncident>()
    override suspend fun insert(incident: LocalIncident) {
        rows[incident.triggerId] = incident
    }
    override suspend fun update(incident: LocalIncident) {
        rows[incident.triggerId] = incident
    }
    override suspend fun get(triggerId: String) = rows[triggerId]
    override suspend fun list() = rows.values.toList()
    override suspend fun pending() = rows.values.filter { it.syncState == SyncState.PENDING }
}
