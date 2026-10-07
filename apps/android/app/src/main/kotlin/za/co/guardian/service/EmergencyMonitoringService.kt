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
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
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
import za.co.guardian.core.captureEvidence
import za.co.guardian.core.heartbeatCoordinates
import za.co.guardian.core.locationIntervalMs
import za.co.guardian.core.monitoringTickMs
import za.co.guardian.core.shouldCaptureLocation
import za.co.guardian.core.OfflineIncidentRepository
import za.co.guardian.data.EvidenceBody
import za.co.guardian.data.EvidenceVault
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
    private var locationInterval = 0L
    private var shareLocation = false

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val microphone = intent?.getBooleanExtra("microphone", false) == true &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val location = intent?.getBooleanExtra("location", false) == true && shouldCaptureLocation(signals.hasFineLocation())
        shareLocation = location
        val notification = monitoringNotification(location)
        if (!startInForeground(notification, location, microphone)) {
            stopSelf()
            return START_NOT_STICKY
        }
        acquireWakeLock()
        if (location && !settingsQuiet()) listenForLocation(currentInterval())
        if (microphone) scope.launch { uploader.captureAudio() }
        scope.launch {
            while (true) {
                val keepGoing = uploader.tick()
                if (!keepGoing) {
                    stopSelf()
                    break
                }
                if (shareLocation && !settingsQuiet()) listenForLocation(currentInterval())
                delay(monitoringTickMs(signals.deviceState().batteryMode))
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

    override fun onTimeout(startId: Int, fgsType: Int) {
        scope.launch {
            try {
                val request = androidx.work.OneTimeWorkRequestBuilder<IncidentFlushWorker>()
                    .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build())
                    .build()
                androidx.work.WorkManager.getInstance(applicationContext).enqueueUniqueWork(
                    "guardian-emergency-fgs-timeout",
                    androidx.work.ExistingWorkPolicy.REPLACE,
                    request,
                )
            } catch (_: Exception) {}
            stopSelf(startId)
        }
    }

    private fun startInForeground(notification: Notification, location: Boolean, microphone: Boolean): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification)
            return true
        }
        val restricted = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
            (if (location) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0) or
            (if (microphone) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0)
        val attempts = listOf(restricted, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC).distinct()
        for (type in attempts) {
            try {
                startForeground(NOTIFICATION_ID, notification, type)
                if (type == ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC && location) {
                    shareLocation = false
                }
                return true
            } catch (_: SecurityException) {
                // This Android version refused the sensor type. Try data sync alone.
                shareLocation = false
            } catch (_: IllegalStateException) {
                // The process is not allowed to enter the foreground.
            }
        }
        return false
    }

    private fun currentInterval(): Long = locationIntervalMs(signals.deviceState().batteryMode)

    private fun listenForLocation(intervalMs: Long) {
        if (listener != null && locationInterval == intervalMs) return
        val manager = signals.locationManager()
        listener?.let { manager.removeUpdates(it) }
        val created = LocationListener { location -> scope.launch { uploader.remember(location) } }
        listener = created
        locationInterval = intervalMs
        try {
            if (manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 0f, created, Looper.getMainLooper())
            }
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                manager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, intervalMs, 0f, created, Looper.getMainLooper())
            }
        } catch (_: SecurityException) {
            shareLocation = false
            listener?.let { manager.removeUpdates(it) }
            listener = null
        }
    }

    private fun acquireWakeLock() {
        val power = getSystemService(POWER_SERVICE) as PowerManager
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "guardian:emergency").apply {
            setReferenceCounted(false)
            acquire(4 * 60 * 60 * 1000L)
        }
    }

    private fun monitoringNotification(sharingLocation: Boolean): Notification {
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
        val quiet = uploaderQuiet()
        return NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(if (quiet) "Guardian" else "Guardian SOS active")
            .setContentText(
                getString(
                    when {
                        quiet -> R.string.monitoring_quiet
                        sharingLocation -> R.string.monitoring_text
                        else -> R.string.monitoring_text_no_location
                    },
                ),
            )
            .setOngoing(!quiet)
            .setContentIntent(open)
            .build()
    }

    @Inject lateinit var settings: SettingsStore

    private fun settingsQuiet(): Boolean = settings.quietIncident()
    private fun uploaderQuiet(): Boolean = settings.quietIncident()

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
    private val vault: EvidenceVault,
) {
    @Volatile private var latest: Location? = null
    @Volatile private var recording = false

    suspend fun captureAudio() {
        val rate = 16_000
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return
        val recorder = AudioRecord(MediaRecorder.AudioSource.MIC, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, min.coerceAtLeast(32000))
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            return
        }
        val buffer = ByteArray(min.coerceAtLeast(32000))
        recording = true
        recorder.startRecording()
        try {
            while (settings.evidenceMode() && !settings.quietIncident()) {
                val incident = activeLocalIncident() ?: break
                val battery = signals.deviceState().batteryLevel ?: 100
                if (!captureEvidence("audio", battery)) break
                val read = recorder.read(buffer, 0, minOf(buffer.size, 16_000))
                if (read <= 0) break
                vault.store(incident.triggerId, "audio", buffer.copyOf(read))
                flushEvidence(incident.triggerId, incident.serverId)
            }
        } finally {
            recording = false
            recorder.stop()
            recorder.release()
        }
    }

    suspend fun remember(location: Location) {
        latest = location
        val incident = activeLocalIncident() ?: return
        val point = signals.toPoint(location)
        database.locations().insert(
            LocationEntity(
                clientPointId = UUID.randomUUID().toString(),
                incidentServerId = incident.serverId ?: "",
                latitude = point.latitude,
                longitude = point.longitude,
                accuracy = point.accuracy,
                speed = point.speed,
                bearing = point.heading,
                altitude = point.altitude,
                recordedAt = point.recordedAt,
                source = point.source,
                uploaded = false,
                localTriggerId = incident.triggerId,
            ),
        )
    }

    suspend fun tick(): Boolean {
        repository.flush()
        val incident = activeLocalIncident() ?: return true
        flushEvidence(incident.triggerId, incident.serverId)
        if (incident.state == "RESOLVED" || incident.state == "ARCHIVED") settings.clearTrigger()
        val incidentId = incident.serverId
        if (incidentId != null) {
            database.locations().bind(incident.triggerId, incidentId)
            uploadLocations(incidentId)
            sendHeartbeat(incidentId)
        }
        if (incidentId == null) return true
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
        val pending = database.locations().pendingForIncident(incidentId)
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
        val coordinates = heartbeatCoordinates(signals.hasFineLocation(), point?.latitude, point?.longitude)
        val body = HeartbeatBody(
            clientHeartbeatId = id,
            recordedAt = signals.timestamp(),
            latitude = coordinates.first,
            longitude = coordinates.second,
            accuracy = if (signals.hasFineLocation()) point?.accuracy else null,
            speed = if (signals.hasFineLocation()) point?.speed else null,
            heading = if (signals.hasFineLocation()) point?.heading else null,
            batteryLevel = device.batteryLevel,
            charging = device.charging,
            networkType = device.networkType,
            deviceOnline = device.networkType != "NO_INTERNET",
            evidenceStatus = if (recording) "UPLOADING" else "NONE",
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

    private suspend fun flushEvidence(localId: String, serverId: String?) {
        if (!serverId.isNullOrBlank()) vault.bind(localId, serverId)
        for (row in vault.pending()) {
            if (row.incidentLocalId != localId || row.serverIncidentId.isBlank()) continue
            val plain = vault.readPlain(row)
            val limit = if (row.type == "audio") 200_000 else 1_500_000
            if (plain == null || plain.size > limit) {
                vault.mark(row.evidenceId, "FAILED", row.retryCount + 1)
                continue
            }
            vault.mark(row.evidenceId, "UPLOADING", row.retryCount)
            try {
                api.evidence(
                    row.serverIncidentId,
                    EvidenceBody(
                        row.evidenceId,
                        row.sequence,
                        row.sha256,
                        when (row.type) {
                            "photo" -> "image/jpeg"
                            "video" -> "video/mp4"
                            else -> "audio/pcm"
                        },
                        EvidenceVault.base64(plain),
                    ),
                )
                vault.mark(row.evidenceId, "VERIFIED", row.retryCount)
                vault.deleteVerified(row)
            } catch (_: Exception) {
                vault.mark(row.evidenceId, "QUEUED", row.retryCount + 1)
            }
        }
    }

    private suspend fun activeLocalIncident() = database.incidents().list().firstOrNull { entity ->
        entity.state != "RESOLVED" && entity.state != "ARCHIVED"
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
        val prefs = context.getSharedPreferences("guardian_settings", Context.MODE_PRIVATE)
        val active = prefs.getBoolean("incident_active", false)
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
