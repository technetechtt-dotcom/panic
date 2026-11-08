package za.co.guardian.service

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException
import za.co.guardian.MainActivity
import za.co.guardian.data.GuardianApi
import za.co.guardian.data.JourneyPositionBody
import za.co.guardian.data.PhoneSignals
import za.co.guardian.data.ResponderLocationBody
import za.co.guardian.data.SettingsStore
import za.co.guardian.data.guardianEncryptedPreferences
import java.time.Instant
import java.util.UUID
import javax.inject.Inject

/**
 * Visible foreground location service for active Journey Protection and responder assignments.
 * Each sample is persisted in Room with a Keystore-encrypted payload and retried independently.
 */
@AndroidEntryPoint
class ProtectionTrackingService : android.app.Service() {
    @Inject lateinit var api: GuardianApi
    @Inject lateinit var settings: SettingsStore
    @Inject lateinit var signals: PhoneSignals
    @Inject lateinit var database: za.co.guardian.data.GuardianDatabase
    @Inject lateinit var vault: za.co.guardian.data.EvidenceVault

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var listener: LocationListener? = null
    private var retryJob: kotlinx.coroutines.Job? = null
    private val queue by lazy { guardianEncryptedPreferences(this, "guardian_live_tracking_queue_secure") }
    private val queueMutex = Mutex()

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Guardian protection tracking")
            .setContentText("Location is being shared for an active journey or responder assignment.")
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    2201,
                    Intent(this, MainActivity::class.java),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, "Protection tracking", NotificationManager.IMPORTANCE_LOW))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        if (retryJob == null) retryJob = scope.launch {
            migrateQueue()
            while (isActive) { flushQueue(); delay(15_000L) }
        }
        listen()
        return START_STICKY
    }

    private fun listen() {
        if (listener != null) return
        val manager = signals.locationManager()
        val created = LocationListener { location ->
            scope.launch {
                enqueue(location)
                flushQueue()
                if (settings.journeyId() == null && settings.responderIncidentId() == null) stopSelf()
            }
        }
        listener = created
        try {
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 10_000L, 5f, created, Looper.getMainLooper())
            }
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 15_000L, 10f, created, Looper.getMainLooper())
            }
        } catch (_: SecurityException) {
            stopSelf()
        }
    }

    private suspend fun persist(sample: TrackSample, dead: Boolean = false) {
        database.tracking().put(za.co.guardian.data.TrackingEntity(sample.sampleId, vault.encrypt(sample.encode().toByteArray(Charsets.UTF_8)), sample.nextAttemptAt, dead))
    }

    private suspend fun migrateQueue() = queueMutex.withLock {
        if (queue.getBoolean("migrated_to_room", false)) return@withLock
        for (line in queue.getString(KEY, "").orEmpty().lineSequence().filter { it.isNotBlank() }) {
            TrackSample.decode(line)?.let { persist(it) }
        }
        // Pre-encryption builds had no capture time. Preserve those rows as encrypted dead letters,
        // labelled UNKNOWN_TIME rather than inventing a historical GPS timestamp.
        val legacy = getSharedPreferences("guardian_live_tracking_queue", Context.MODE_PRIVATE)
        for (line in legacy.getString(KEY, "").orEmpty().lineSequence().filter { it.isNotBlank() }) {
            val parts = line.split("\t")
            if (parts.size >= 5) {
                val lat = parts[2].toDoubleOrNull(); val lon = parts[3].toDoubleOrNull()
                if (lat != null && lon != null) persist(TrackSample(parts[0], parts[1], UUID.randomUUID().toString(), "UNKNOWN_TIME", lat, lon, null, parts[4].toDoubleOrNull(), null, "LEGACY", 0, 0L), dead = true)
            }
        }
        check(legacy.edit().clear().commit())
        check(queue.edit().remove(KEY).putBoolean("migrated_to_room", true).commit())
    }

    private suspend fun enqueue(location: Location) = queueMutex.withLock {
        settings.journeyId()?.let { persist(TrackSample.from("J", it, location)) }
        settings.responderIncidentId()?.let { persist(TrackSample.from("R", it, location)) }
    }

    private suspend fun flushQueue() = queueMutex.withLock {
        val now = System.currentTimeMillis()
        for (row in database.tracking().due(now)) {
            val plain = vault.decrypt(row.sealed)
            val sample = plain?.let { TrackSample.decode(it.toString(Charsets.UTF_8)) }
            if (sample == null) { database.tracking().put(row.copy(dead = true)); continue }
            try {
                when (sample.kind) {
                    "J" -> api.journeyPosition(sample.targetId, JourneyPositionBody(sample.latitude, sample.longitude, sample.sampleId, sample.recordedAt, sample.accuracy, sample.speed, sample.bearing, sample.source))
                    "R" -> api.responderLocation(sample.targetId, ResponderLocationBody(sample.latitude, sample.longitude, sample.speed, sample.sampleId, sample.recordedAt, sample.accuracy, sample.bearing, sample.source))
                }
                database.tracking().delete(sample.sampleId)
            } catch (cancelled: kotlinx.coroutines.CancellationException) {
                throw cancelled
            } catch (error: HttpException) {
                if (error.code() in setOf(400, 403, 404, 409, 410, 422)) {
                    // Preserve rejected evidence encrypted for review; stop generating samples for a closed target.
                    persist(sample, dead = true)
                    val errorCode = runCatching { org.json.JSONObject(error.response()?.errorBody()?.string().orEmpty()).optJSONObject("error")?.optString("code") }.getOrNull()
                    if (error.code() in setOf(404, 410) || errorCode in setOf("JOURNEY_CLOSED", "ASSIGNMENT_CLOSED")) {
                        if (sample.kind == "J" && settings.journeyId() == sample.targetId) settings.setJourneyId(null)
                        if (sample.kind == "R" && settings.responderIncidentId() == sample.targetId) settings.setResponderIncidentId(null)
                    }
                } else persist(sample.retry(now))
            } catch (_: Exception) {
                persist(sample.retry(now))
            }
        }
    }

    private data class TrackSample(
        val kind: String,
        val targetId: String,
        val sampleId: String,
        val recordedAt: String,
        val latitude: Double,
        val longitude: Double,
        val accuracy: Double?,
        val speed: Double?,
        val bearing: Double?,
        val source: String,
        val retryCount: Int,
        val nextAttemptAt: Long,
    ) {
        fun encode(): String = listOf(
            kind, targetId, sampleId, recordedAt,
            latitude.toString(), longitude.toString(),
            accuracy?.toString().orEmpty(), speed?.toString().orEmpty(), bearing?.toString().orEmpty(),
            source, retryCount.toString(), nextAttemptAt.toString(),
        ).joinToString("\t")

        fun retry(now: Long): TrackSample {
            val nextRetry = (retryCount + 1).coerceAtMost(12)
            val delay = (5_000L * (1L shl nextRetry.coerceAtMost(8))).coerceAtMost(15 * 60_000L)
            return copy(retryCount = nextRetry, nextAttemptAt = now + delay)
        }

        companion object {
            fun from(kind: String, targetId: String, location: Location): TrackSample = TrackSample(
                kind = kind,
                targetId = targetId,
                sampleId = UUID.randomUUID().toString(),
                recordedAt = Instant.ofEpochMilli(location.time.takeIf { it > 0L } ?: System.currentTimeMillis()).toString(),
                latitude = location.latitude,
                longitude = location.longitude,
                accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                speed = if (location.hasSpeed()) location.speed.toDouble() else null,
                bearing = if (location.hasBearing()) location.bearing.toDouble() else null,
                source = location.provider?.uppercase() ?: "UNKNOWN",
                retryCount = 0,
                nextAttemptAt = 0L,
            )

            fun decode(row: String): TrackSample? {
                val p = row.split("\t")
                if (p.size < 12) return null
                return TrackSample(
                    p[0], p[1], p[2], p[3],
                    p[4].toDoubleOrNull() ?: return null,
                    p[5].toDoubleOrNull() ?: return null,
                    p[6].toDoubleOrNull(), p[7].toDoubleOrNull(), p[8].toDoubleOrNull(),
                    p[9], p[10].toIntOrNull() ?: 0, p[11].toLongOrNull() ?: 0L,
                )
            }
        }
    }

    override fun onDestroy() {
        listener?.let { runCatching { signals.locationManager().removeUpdates(it) } }
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "guardian.protection.tracking"
        private const val NOTIFICATION_ID = 2201
        private const val KEY = "pending"

        fun ensureRunning(context: Context) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return
            runCatching {
                ContextCompat.startForegroundService(context, Intent(context, ProtectionTrackingService::class.java))
            }
        }

        fun stopIfIdle(context: Context, settings: SettingsStore) {
            if (settings.journeyId() == null && settings.responderIncidentId() == null) {
                context.stopService(Intent(context, ProtectionTrackingService::class.java))
            }
        }
    }
}
