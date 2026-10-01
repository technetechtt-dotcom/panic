package za.co.guardian.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import za.co.guardian.MainActivity
import za.co.guardian.R
import za.co.guardian.core.OfflineIncidentRepository
import za.co.guardian.data.GuardianApi
import za.co.guardian.data.GuardianDatabase
import za.co.guardian.data.HeartbeatBody
import za.co.guardian.data.HeartbeatEntity
import za.co.guardian.data.LocationBatchBody
import za.co.guardian.data.LocationEntity
import za.co.guardian.data.LocationPointBody
import za.co.guardian.data.PhoneSignals
import za.co.guardian.data.SettingsStore
import java.util.UUID
import javax.inject.Inject

@AndroidEntryPoint
class EmergencyMonitoringService : android.app.Service() {
    @Inject lateinit var uploader: EmergencyUploader
    @Inject lateinit var signals: PhoneSignals

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var wakeLock: PowerManager.WakeLock? = null
    private var listener: LocationListener? = null

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val notification = monitoringNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        if (!signals.hasFineLocation()) {
            stopSelf()
            return START_NOT_STICKY
        }
        acquireWakeLock()
        listenForLocation()
        scope.launch {
            while (true) {
                val keepGoing = uploader.tick()
                if (!keepGoing) {
                    stopSelf()
                    break
                }
                delay(15_000)
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        listener?.let { signals.locationManager().removeUpdates(it) }
        wakeLock?.let { if (it.isHeld) it.release() }
        scope.cancel()
        super.onDestroy()
    }

    private fun listenForLocation() {
        val manager = signals.locationManager()
        val created = LocationListener { location -> scope.launch { uploader.remember(location) } }
        listener = created
        try {
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 5_000L, 0f, created, Looper.getMainLooper())
            }
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5_000L, 0f, created, Looper.getMainLooper())
            }
        } catch (_: SecurityException) {
            stopSelf()
        }
    }

    private fun acquireWakeLock() {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "guardian:emergency").apply {
            setReferenceCounted(false)
            acquire(4 * 60 * 60 * 1000L)
        }
    }

    private fun monitoringNotification(): Notification {
        val channelId = "guardian.emergency"
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(channelId, getString(R.string.monitoring_channel), NotificationManager.IMPORTANCE_HIGH),
            )
        }
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Guardian SOS active")
            .setContentText(getString(R.string.monitoring_text))
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 1001
    }
}

class EmergencyUploader @Inject constructor(
    private val repository: OfflineIncidentRepository,
    private val api: GuardianApi,
    private val database: GuardianDatabase,
    private val signals: PhoneSignals,
    private val settings: SettingsStore,
) {
    @Volatile private var latest: Location? = null

    suspend fun remember(location: Location) {
        latest = location
        val incident = activeServerIncident() ?: return
        val point = signals.toPoint(location)
        database.locations().insert(
            LocationEntity(
                clientPointId = UUID.randomUUID().toString(),
                incidentServerId = incident,
                latitude = point.latitude,
                longitude = point.longitude,
                accuracy = point.accuracy,
                speed = point.speed,
                bearing = point.heading,
                altitude = point.altitude,
                recordedAt = point.recordedAt,
                source = point.source,
                uploaded = false,
            ),
        )
    }

    suspend fun tick(): Boolean {
        repository.flush()
        val incidentId = activeServerIncident() ?: return true
        uploadLocations(incidentId)
        sendHeartbeat(incidentId)
        return try {
            val state = api.incident(incidentId).data.state
            database.incidents().updateState(incidentId, state)
            if (state == "RESOLVED" || state == "ARCHIVED") {
                settings.setIncidentActive(false)
                false
            } else {
                true
            }
        } catch (_: Exception) {
            true
        }
    }

    private suspend fun uploadLocations(incidentId: String) {
        val pending = database.locations().pending().filter { it.incidentServerId == incidentId }
        if (pending.isEmpty()) return
        try {
            api.locations(
                incidentId,
                LocationBatchBody(
                    pending.map { point ->
                        LocationPointBody(
                            clientPointId = point.clientPointId,
                            latitude = point.latitude,
                            longitude = point.longitude,
                            accuracy = point.accuracy,
                            speed = point.speed,
                            bearing = point.bearing,
                            altitude = point.altitude,
                            recordedAt = point.recordedAt,
                            source = point.source,
                        )
                    },
                ),
            )
            pending.forEach { database.locations().markUploaded(it.clientPointId) }
        } catch (_: Exception) {
            // The same point ids are retried. The server treats duplicates as already stored.
        }
    }

    private suspend fun sendHeartbeat(incidentId: String) {
        val device = signals.deviceState()
        val existing = database.heartbeats().pending()
        val id = existing?.clientHeartbeatId ?: UUID.randomUUID().toString()
        val point = latest?.let(signals::toPoint)
        val body = HeartbeatBody(
            clientHeartbeatId = id,
            recordedAt = signals.timestamp(),
            latitude = point?.latitude,
            longitude = point?.longitude,
            accuracy = point?.accuracy,
            speed = point?.speed,
            heading = point?.heading,
            batteryLevel = device.batteryLevel,
            charging = device.charging,
            networkType = device.networkType,
            deviceOnline = device.networkType != "NO_INTERNET",
            evidenceStatus = "NONE",
            permissionsStatus = if (signals.hasFineLocation()) "LOCATION_GRANTED" else "LOCATION_MISSING",
            batteryMode = device.batteryMode,
        )
        database.heartbeats().save(HeartbeatEntity(id, incidentId, id))
        try {
            api.heartbeat(incidentId, body)
            database.heartbeats().delete(id)
        } catch (_: Exception) {
            // Keep the same heartbeat id for the next attempt.
        }
    }

    private suspend fun activeServerIncident(): String? {
        return database.incidents().list().firstOrNull { entity ->
            entity.serverId != null && entity.state != "RESOLVED" && entity.state != "ARCHIVED"
        }?.serverId
    }
}

@HiltWorker
class IncidentFlushWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val repository: OfflineIncidentRepository,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        repository.flush()
        return if (repository.hasPending()) Result.retry() else Result.success()
    }
}

class ResumeProtectionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val active = context.getSharedPreferences("guardian_settings", Context.MODE_PRIVATE)
            .getBoolean("incident_active", false)
        if (!active) return
        val channelId = "guardian.resume"
        val manager = context.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(channelId, "Resume Guardian", NotificationManager.IMPORTANCE_HIGH),
            )
        }
        val open = PendingIntent.getActivity(
            context,
            1,
            Intent(context, MainActivity::class.java).putExtra("resume", true),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Guardian needs you to reopen the app")
            .setContentText("An emergency was active. Android does not let Guardian resume tracking until you open it.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        if (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            manager.notify(1002, notification)
        }
    }
}
