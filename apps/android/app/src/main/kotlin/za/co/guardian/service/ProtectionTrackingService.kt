package za.co.guardian.service

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import retrofit2.HttpException
import za.co.guardian.MainActivity
import za.co.guardian.data.GuardianApi
import za.co.guardian.data.JourneyPositionBody
import za.co.guardian.data.PhoneSignals
import za.co.guardian.data.ResponderLocationBody
import za.co.guardian.data.SettingsStore
import java.io.IOException
import java.util.UUID
import javax.inject.Inject
import kotlin.math.min
import kotlin.math.pow

/**
 * Visible foreground location service for active Journey Protection and responder assignments.
 * Pending location samples are encrypted at rest and retained across restarts/network loss.
 */
@AndroidEntryPoint
class ProtectionTrackingService : android.app.Service() {
    @Inject lateinit var api: GuardianApi
    @Inject lateinit var settings: SettingsStore
    @Inject lateinit var signals: PhoneSignals

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var listener: LocationListener? = null
    private val queue: SharedPreferences by lazy {
        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        EncryptedSharedPreferences.create(
            "guardian_live_tracking_queue_secure",
            masterKeyAlias,
            this,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

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
        scope.launch { flushQueue() }
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

    private fun enqueue(location: Location) {
        val existing = readQueue().toMutableList()
        settings.journeyId()?.let { id -> existing += sample("J", id, location) }
        settings.responderIncidentId()?.let { id -> existing += sample("R", id, location) }
        writeQueue(existing.takeLast(MAX_PENDING_SAMPLES))
    }

    private suspend fun flushQueue() {
        val now = System.currentTimeMillis()
        val remaining = mutableListOf<TrackingSample>()
        val dead = readDead().toMutableList()
        for (sample in readQueue()) {
            if (sample.nextAttemptAt > now) {
                remaining += sample
                continue
            }
            try {
                when (sample.kind) {
                    "J" -> api.journeyPosition(sample.targetId, JourneyPositionBody(sample.latitude, sample.longitude))
                    "R" -> api.responderLocation(sample.targetId, ResponderLocationBody(sample.latitude, sample.longitude, sample.speed))
                    else -> continue
                }
            } catch (error: Exception) {
                if (isPermanent(error)) {
                    dead += sample.copy(lastError = errorLabel(error), nextAttemptAt = Long.MAX_VALUE)
                } else {
                    val attempts = sample.retryCount + 1
                    val delay = min(MAX_BACKOFF_MS, (2.0.pow(attempts.coerceAtMost(12)) * BASE_BACKOFF_MS).toLong())
                    remaining += sample.copy(
                        retryCount = attempts,
                        nextAttemptAt = now + delay,
                        lastError = errorLabel(error),
                    )
                }
            }
        }
        writeQueue(remaining.takeLast(MAX_PENDING_SAMPLES))
        writeDead(dead.takeLast(MAX_DEAD_SAMPLES))
    }

    private fun sample(kind: String, targetId: String, location: Location): TrackingSample = TrackingSample(
        kind = kind,
        targetId = targetId,
        sampleId = UUID.randomUUID().toString(),
        recordedAt = if (location.time > 0) location.time else System.currentTimeMillis(),
        latitude = location.latitude,
        longitude = location.longitude,
        speed = if (location.hasSpeed()) location.speed.toDouble() else null,
        accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
        bearing = if (location.hasBearing()) location.bearing.toDouble() else null,
        source = location.provider ?: "unknown",
        retryCount = 0,
        nextAttemptAt = 0L,
        lastError = "",
    )

    private fun isPermanent(error: Exception): Boolean {
        if (error is HttpException) {
            val code = error.code()
            return code in setOf(400, 403, 404, 409, 410, 422)
        }
        return false
    }

    private fun errorLabel(error: Exception): String = when (error) {
        is HttpException -> "HTTP ${error.code()}"
        is IOException -> "NETWORK"
        else -> error::class.java.simpleName.take(80)
    }

    private fun readQueue(): List<TrackingSample> =
        queue.getString(KEY, "").orEmpty().lineSequence().mapNotNull(::decode).toList()

    private fun writeQueue(rows: List<TrackingSample>) {
        queue.edit().putString(KEY, rows.joinToString("\n", transform = ::encode)).apply()
    }

    private fun readDead(): List<TrackingSample> =
        queue.getString(DEAD_KEY, "").orEmpty().lineSequence().mapNotNull(::decode).toList()

    private fun writeDead(rows: List<TrackingSample>) {
        queue.edit().putString(DEAD_KEY, rows.joinToString("\n", transform = ::encode)).apply()
    }

    private fun encode(row: TrackingSample): String = listOf(
        row.kind,
        row.targetId,
        row.sampleId,
        row.recordedAt,
        row.latitude,
        row.longitude,
        row.speed ?: "",
        row.accuracy ?: "",
        row.bearing ?: "",
        row.source.replace("\t", " ").replace("\n", " "),
        row.retryCount,
        row.nextAttemptAt,
        row.lastError.replace("\t", " ").replace("\n", " "),
    ).joinToString("\t")

    private fun decode(raw: String): TrackingSample? {
        val p = raw.split("\t")
        if (p.size < 12) return null
        return TrackingSample(
            kind = p[0],
            targetId = p[1],
            sampleId = p[2],
            recordedAt = p[3].toLongOrNull() ?: return null,
            latitude = p[4].toDoubleOrNull() ?: return null,
            longitude = p[5].toDoubleOrNull() ?: return null,
            speed = p[6].toDoubleOrNull(),
            accuracy = p[7].toDoubleOrNull(),
            bearing = p[8].toDoubleOrNull(),
            source = p[9],
            retryCount = p[10].toIntOrNull() ?: 0,
            nextAttemptAt = p[11].toLongOrNull() ?: 0L,
            lastError = p.getOrNull(12).orEmpty(),
        )
    }

    override fun onDestroy() {
        listener?.let { runCatching { signals.locationManager().removeUpdates(it) } }
        scope.cancel()
        super.onDestroy()
    }

    private data class TrackingSample(
        val kind: String,
        val targetId: String,
        val sampleId: String,
        val recordedAt: Long,
        val latitude: Double,
        val longitude: Double,
        val speed: Double?,
        val accuracy: Double?,
        val bearing: Double?,
        val source: String,
        val retryCount: Int,
        val nextAttemptAt: Long,
        val lastError: String,
    )

    companion object {
        private const val CHANNEL = "guardian.protection.tracking"
        private const val NOTIFICATION_ID = 2201
        private const val KEY = "pending"
        private const val DEAD_KEY = "dead"
        private const val MAX_PENDING_SAMPLES = 2_000
        private const val MAX_DEAD_SAMPLES = 200
        private const val BASE_BACKOFF_MS = 2_000L
        private const val MAX_BACKOFF_MS = 5 * 60_000L

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
