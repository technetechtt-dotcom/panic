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
import za.co.guardian.MainActivity
import za.co.guardian.data.GuardianApi
import za.co.guardian.data.JourneyPositionBody
import za.co.guardian.data.PhoneSignals
import za.co.guardian.data.ResponderLocationBody
import za.co.guardian.data.SettingsStore
import javax.inject.Inject

/**
 * Visible foreground location service for active Journey Protection and responder assignments.
 * It keeps a small persistent queue so temporary network loss does not discard the latest route samples.
 */
@AndroidEntryPoint
class ProtectionTrackingService : android.app.Service() {
    @Inject lateinit var api: GuardianApi
    @Inject lateinit var settings: SettingsStore
    @Inject lateinit var signals: PhoneSignals

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var listener: LocationListener? = null
    private val queue by lazy { getSharedPreferences("guardian_live_tracking_queue", Context.MODE_PRIVATE) }

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
        val existing = queue.getString(KEY, "").orEmpty().lineSequence().filter { it.isNotBlank() }.toMutableList()
        settings.journeyId()?.let { id -> existing += encode("J", id, location) }
        settings.responderIncidentId()?.let { id -> existing += encode("R", id, location) }
        val trimmed = existing.takeLast(50)
        queue.edit().putString(KEY, trimmed.joinToString("\n")).apply()
    }

    private suspend fun flushQueue() {
        val items = queue.getString(KEY, "").orEmpty().lineSequence().filter { it.isNotBlank() }.toList()
        if (items.isEmpty()) return
        val remaining = mutableListOf<String>()
        for (row in items) {
            val parts = row.split("\t")
            if (parts.size < 5) continue
            val kind = parts[0]
            val id = parts[1]
            val lat = parts[2].toDoubleOrNull() ?: continue
            val lon = parts[3].toDoubleOrNull() ?: continue
            val speed = parts[4].toDoubleOrNull()
            try {
                when (kind) {
                    "J" -> api.journeyPosition(id, JourneyPositionBody(lat, lon))
                    "R" -> api.responderLocation(id, ResponderLocationBody(lat, lon, speed))
                }
            } catch (_: Exception) {
                remaining += row
            }
        }
        queue.edit().putString(KEY, remaining.takeLast(50).joinToString("\n")).apply()
    }

    private fun encode(kind: String, id: String, location: Location): String {
        val speed = if (location.hasSpeed()) location.speed.toDouble() else 0.0
        return listOf(kind, id, location.latitude.toString(), location.longitude.toString(), speed.toString()).joinToString("\t")
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
