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
)

@Entity(tableName = "heartbeat_outbox")
data class HeartbeatEntity(
    @PrimaryKey val clientHeartbeatId: String,
    val incidentServerId: String,
    val payloadJson: String,
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

@Database(
    entities = [IncidentEntity::class, LocationEntity::class, HeartbeatEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class GuardianDatabase : RoomDatabase() {
    abstract fun incidents(): IncidentDao
    abstract fun locations(): LocationDao
    abstract fun heartbeats(): HeartbeatDao
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
        Room.databaseBuilder(context, GuardianDatabase::class.java, "guardian.db").build()
}
