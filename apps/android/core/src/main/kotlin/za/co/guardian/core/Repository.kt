package za.co.guardian.core

enum class SyncState { PENDING, SYNCED, FAILED }

data class LocalIncident(
    val triggerId: String,
    val correlationId: String,
    val serverId: String?,
    val userId: String,
    val deviceId: String,
    val state: IncidentState,
    val isTest: Boolean,
    val syncState: SyncState,
    val createdAtEpochMs: Long,
    val capsule: DistressCapsule,
    val lastError: String?,
)

data class SosContext(
    val userId: String,
    val deviceId: String,
    val isTest: Boolean,
    val freshLocation: GeoPoint?,
    val lastKnownLocation: GeoPoint?,
    val deviceState: DeviceState,
    val protectionStatus: String,
)

interface IncidentLocalStore {
    suspend fun insert(incident: LocalIncident)
    suspend fun update(incident: LocalIncident)
    suspend fun get(triggerId: String): LocalIncident?
    suspend fun list(): List<LocalIncident>
    suspend fun pending(): List<LocalIncident>
}

data class RemoteCreateResult(val serverId: String, val replayed: Boolean)

interface IncidentRemoteApi {
    suspend fun create(incident: LocalIncident): RemoteCreateResult
}

class OfflineIncidentRepository(
    private val local: IncidentLocalStore,
    private val remote: IncidentRemoteApi,
    private val engine: EmergencyTriggerEngine = EmergencyTriggerEngine(),
    private val capsules: DistressCapsuleBuilder = DistressCapsuleBuilder(),
    private val newId: () -> String,
    private val now: () -> Long,
    private val timestamp: (Long) -> String,
) {
    suspend fun triggerManual(context: SosContext): LocalIncident {
        val event = TriggerEvent(
            triggerId = newId(),
            userId = context.userId,
            deviceId = context.deviceId,
            triggerType = TriggerType.MANUAL_SOS,
            timestampEpochMs = now(),
            confidence = null,
            protectionSessionId = null,
            metadata = emptyMap(),
            deviceState = context.deviceState,
        )
        val decision = engine.receive(event)
        check(decision.disposition == TriggerDisposition.IMMEDIATE_INCIDENT) {
            "Manual SOS must create an incident immediately."
        }
        val createdAt = event.timestampEpochMs
        val incident = LocalIncident(
            triggerId = event.triggerId,
            correlationId = newId(),
            serverId = null,
            userId = context.userId,
            deviceId = context.deviceId,
            state = IncidentState.SOS,
            isTest = context.isTest,
            syncState = SyncState.PENDING,
            createdAtEpochMs = createdAt,
            capsule = capsules.build(
                CapsuleInput(
                    timestamp = timestamp(createdAt),
                    freshLocation = context.freshLocation,
                    lastKnownLocation = context.lastKnownLocation,
                    deviceState = context.deviceState,
                    protectionStatus = context.protectionStatus,
                    isDuress = false,
                ),
            ),
            lastError = null,
        )
        capsules.encode(incident.capsule)
        local.insert(incident)
        return send(incident)
    }

    suspend fun flush(): Int {
        var sent = 0
        for (incident in local.pending()) {
            val updated = send(incident)
            if (updated.syncState == SyncState.SYNCED) sent += 1
        }
        return sent
    }

    suspend fun hasPending(): Boolean = local.pending().isNotEmpty()

    private suspend fun send(incident: LocalIncident): LocalIncident {
        return try {
            val result = remote.create(incident)
            val synced = incident.copy(serverId = result.serverId, syncState = SyncState.SYNCED, lastError = null)
            local.update(synced)
            synced
        } catch (error: Exception) {
            val pending = incident.copy(syncState = SyncState.PENDING, lastError = error.message ?: "Upload failed")
            local.update(pending)
            pending
        }
    }
}
