package za.co.guardian.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.room.Update
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import za.co.guardian.core.DistressCapsule
import za.co.guardian.core.IncidentLocalStore
import za.co.guardian.core.IncidentState
import za.co.guardian.core.LocalIncident
import za.co.guardian.core.SyncState
import javax.inject.Singleton

@Entity(tableName = "incidents")
data class IncidentEntity(
    @PrimaryKey val triggerId: String,
    val correlationId: String,
    val serverId: String?,
    val userId: String,
    val deviceId: String,
    val state: String,
    val isTest: Boolean,
    val triggerType: String = "MANUAL_SOS",
    val syncState: String,
    val createdAtEpochMs: Long,
    val capsuleJson: String,
    val lastError: String?,
)

@Entity(
    tableName = "locations",
    indices = [Index(value = ["clientPointId"], unique = true)],
)
data class LocationEntity(
    @PrimaryKey val clientPointId: String,
    val incidentServerId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double?,
    val speed: Double?,
    val bearing: Double?,
    val altitude: Double?,
    val recordedAt: String,
    val source: String,
    val uploaded: Boolean,
    val localTriggerId: String = "",
)

@Entity(tableName = "escalation_outbox")
data class EscalationEntity(
    @PrimaryKey val triggerId: String,
    val localIncidentTriggerId: String,
    val triggerType: String,
    val createdAtEpochMs: Long,
    val sent: Boolean,
)

@Dao
interface EscalationDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: EscalationEntity)

    @Query("SELECT * FROM escalation_outbox WHERE sent = 0")
    suspend fun pending(): List<EscalationEntity>

    @Query("UPDATE escalation_outbox SET sent = 1 WHERE triggerId = :triggerId")
    suspend fun markSent(triggerId: String)
}

@Entity(tableName = "heartbeat_outbox")
data class HeartbeatEntity(
    @PrimaryKey val clientHeartbeatId: String,
    val incidentServerId: String,
    val payloadJson: String,
    val localTriggerId: String = "",
)

@Dao
interface IncidentDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: IncidentEntity)

    @Update
    suspend fun update(entity: IncidentEntity)

    @Query("SELECT * FROM incidents WHERE triggerId = :triggerId")
    suspend fun get(triggerId: String): IncidentEntity?

    @Query("SELECT * FROM incidents ORDER BY createdAtEpochMs DESC")
    suspend fun list(): List<IncidentEntity>

    @Query("SELECT * FROM incidents WHERE syncState = 'PENDING'")
    suspend fun pending(): List<IncidentEntity>

    @Query("UPDATE incidents SET state = :state WHERE serverId = :serverId")
    suspend fun updateState(serverId: String, state: String)
}

@Dao
interface LocationDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: LocationEntity)

    @Query("SELECT * FROM locations WHERE uploaded = 0 ORDER BY recordedAt ASC LIMIT 20")
    suspend fun pending(): List<LocationEntity>

    @Query("UPDATE locations SET uploaded = 1 WHERE clientPointId = :id")
    suspend fun markUploaded(id: String)

    @Query("UPDATE locations SET incidentServerId = :serverId WHERE localTriggerId = :triggerId AND incidentServerId = ''")
    suspend fun bind(triggerId: String, serverId: String)

    @Query("SELECT * FROM locations WHERE incidentServerId = :incidentServerId ORDER BY recordedAt ASC")
    suspend fun forIncident(incidentServerId: String): List<LocationEntity>
}

@Dao
interface HeartbeatDao {
    @Query("SELECT * FROM heartbeat_outbox LIMIT 1")
    suspend fun pending(): HeartbeatEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(entity: HeartbeatEntity)

    @Query("DELETE FROM heartbeat_outbox WHERE clientHeartbeatId = :id")
    suspend fun delete(id: String)
}

@Entity(tableName = "evidence_outbox")
data class EvidenceEntity(
    @PrimaryKey val evidenceId: String,
    val incidentLocalId: String,
    val serverIncidentId: String,
    val type: String,
    val sequence: Int,
    val createdAtEpochMs: Long,
    val sha256: String,
    val localPath: String,
    val uploadState: String,
    val retryCount: Int,
    val size: Int,
)

@Dao
interface EvidenceDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(entity: EvidenceEntity)

    @Query("SELECT * FROM evidence_outbox WHERE uploadState IN ('CAPTURED', 'QUEUED', 'FAILED', 'UPLOADING') ORDER BY sequence ASC")
    suspend fun pending(): List<EvidenceEntity>

    @Query("UPDATE evidence_outbox SET serverIncidentId = :serverId WHERE incidentLocalId = :localId AND serverIncidentId = ''")
    suspend fun bind(localId: String, serverId: String)

    @Query("UPDATE evidence_outbox SET uploadState = :state, retryCount = :retryCount WHERE evidenceId = :id")
    suspend fun mark(id: String, state: String, retryCount: Int)

    @Query("SELECT COALESCE(MAX(sequence), -1) FROM evidence_outbox WHERE incidentLocalId = :localId AND type = :type")
    suspend fun lastSequence(localId: String, type: String): Int
}

@Database(
    entities = [IncidentEntity::class, LocationEntity::class, HeartbeatEntity::class, EscalationEntity::class, EvidenceEntity::class],
    version = 3,
    exportSchema = true,
)
abstract class GuardianDatabase : RoomDatabase() {
    abstract fun incidents(): IncidentDao
    abstract fun locations(): LocationDao
    abstract fun heartbeats(): HeartbeatDao
    abstract fun escalations(): EscalationDao
    abstract fun evidence(): EvidenceDao
}

class RoomIncidentStore(
    private val dao: IncidentDao,
    private val json: Json,
) : IncidentLocalStore {
    override suspend fun insert(incident: LocalIncident) = dao.insert(incident.toEntity(json))
    override suspend fun update(incident: LocalIncident) = dao.update(incident.toEntity(json))
    override suspend fun get(triggerId: String): LocalIncident? = dao.get(triggerId)?.toModel(json)
    override suspend fun list(): List<LocalIncident> = dao.list().map { it.toModel(json) }
    override suspend fun pending(): List<LocalIncident> = dao.pending().map { it.toModel(json) }
}

private fun LocalIncident.toEntity(json: Json) = IncidentEntity(
    triggerId = triggerId,
    correlationId = correlationId,
    serverId = serverId,
    userId = userId,
    deviceId = deviceId,
    state = state.name,
    isTest = isTest,
    triggerType = triggerType.name,
    syncState = syncState.name,
    createdAtEpochMs = createdAtEpochMs,
    capsuleJson = json.encodeToString(capsule),
    lastError = lastError,
)

private fun IncidentEntity.toModel(json: Json) = LocalIncident(
    triggerId = triggerId,
    correlationId = correlationId,
    serverId = serverId,
    userId = userId,
    deviceId = deviceId,
    state = IncidentState.valueOf(state),
    isTest = isTest,
    triggerType = runCatching { za.co.guardian.core.TriggerType.valueOf(triggerType) }.getOrDefault(za.co.guardian.core.TriggerType.MANUAL_SOS),
    syncState = SyncState.valueOf(syncState),
    createdAtEpochMs = createdAtEpochMs,
    capsule = json.decodeFromString<DistressCapsule>(capsuleJson),
    lastError = lastError,
)

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides
    @Singleton
    fun database(@ApplicationContext context: Context): GuardianDatabase =
        Room.databaseBuilder(context, GuardianDatabase::class.java, "guardian.db")
            .addMigrations(MIGRATION_1_2, MIGRATION_2_3)
            .build()
}

private val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE incidents ADD COLUMN triggerType TEXT NOT NULL DEFAULT 'MANUAL_SOS'")
        db.execSQL("ALTER TABLE locations ADD COLUMN localTriggerId TEXT NOT NULL DEFAULT ''")
        db.execSQL("ALTER TABLE heartbeat_outbox ADD COLUMN localTriggerId TEXT NOT NULL DEFAULT ''")
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS escalation_outbox (
                triggerId TEXT NOT NULL PRIMARY KEY,
                localIncidentTriggerId TEXT NOT NULL,
                triggerType TEXT NOT NULL,
                createdAtEpochMs INTEGER NOT NULL,
                sent INTEGER NOT NULL
            )
            """.trimIndent(),
        )
    }
}

private val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS evidence_outbox (
                evidenceId TEXT NOT NULL PRIMARY KEY,
                incidentLocalId TEXT NOT NULL,
                serverIncidentId TEXT NOT NULL,
                type TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                createdAtEpochMs INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                localPath TEXT NOT NULL,
                uploadState TEXT NOT NULL,
                retryCount INTEGER NOT NULL,
                size INTEGER NOT NULL
            )
            """.trimIndent(),
        )
    }
}

class RoomEscalationStore(private val dao: EscalationDao) : za.co.guardian.core.EscalationLocalStore {
    override suspend fun add(item: za.co.guardian.core.LocalEscalation) {
        dao.insert(
            EscalationEntity(item.triggerId, item.incidentTriggerId, item.triggerType, item.createdAtEpochMs, item.sent),
        )
    }

    override suspend fun pending(): List<za.co.guardian.core.LocalEscalation> {
        return dao.pending().map {
            za.co.guardian.core.LocalEscalation(it.triggerId, it.localIncidentTriggerId, it.triggerType, it.createdAtEpochMs, it.sent)
        }
    }

    override suspend fun markSent(triggerId: String) = dao.markSent(triggerId)
}
