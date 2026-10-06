package za.co.guardian.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import androidx.core.app.NotificationCompat
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import za.co.guardian.MainActivity
import za.co.guardian.core.TriggerType
import za.co.guardian.core.WEARABLE_SOS_ACTION
import za.co.guardian.core.fallCountdownDone
import za.co.guardian.core.impactPattern
import za.co.guardian.data.SettingsStore
import za.co.guardian.data.SosActions
import javax.inject.Inject
import kotlin.math.sqrt

@AndroidEntryPoint
class FallWatchService : android.app.Service(), SensorEventListener {
    @Inject lateinit var actions: SosActions
    @Inject lateinit var settings: SettingsStore

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val magnitudes = ArrayDeque<Float>()
    private var pendingSince = 0L
    private var cancelled = false

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_CANCEL) {
            cancelled = true
            pendingSince = 0L
            notify("Impact detection is on. The last alert was cancelled.")
            return START_STICKY
        }
        val notification = notify("Impact detection is on. A possible fall waits 20 seconds before SOS.")
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH)
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        val manager = getSystemService(SENSOR_SERVICE) as SensorManager
        manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.also {
            manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
        scope.launch {
            while (true) {
                delay(1_000)
                val started = pendingSince
                if (started != 0L && fallCountdownDone(cancelled, System.currentTimeMillis() - started)) {
                    pendingSince = 0L
                    cancelled = false
                    magnitudes.clear()
                    actions.send(TriggerType.FALL_OR_IMPACT)
                    notify("A possible fall was sent as SOS. This is not a medical diagnosis.")
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        (getSystemService(SENSOR_SERVICE) as SensorManager).unregisterListener(this)
        settings.setFallWatch(false)
        scope.cancel()
        super.onDestroy()
    }

    override fun onSensorChanged(event: SensorEvent) {
        val magnitude = sqrt(event.values[0] * event.values[0] + event.values[1] * event.values[1] + event.values[2] * event.values[2])
        magnitudes.addLast(magnitude)
        while (magnitudes.size > 50) magnitudes.removeFirst()
        if (pendingSince == 0L && impactPattern(magnitudes.toList())) {
            cancelled = false
            pendingSince = System.currentTimeMillis()
            notify("Possible hard impact. SOS sends in 20 seconds unless you cancel.")
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun notify(text: String): Notification {
        val channelId = "guardian.impact"
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(channelId, "Impact detection", NotificationManager.IMPORTANCE_HIGH))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val cancel = PendingIntent.getService(
            this,
            1,
            Intent(this, FallWatchService::class.java).setAction(ACTION_CANCEL),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Guardian")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .addAction(0, "I'm OK", cancel)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 1002
        const val ACTION_CANCEL = "za.co.guardian.action.CANCEL_FALL"
    }
}

@AndroidEntryPoint
class WearableSosReceiver : BroadcastReceiver() {
    @Inject lateinit var actions: SosActions

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != WEARABLE_SOS_ACTION) return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                actions.send(TriggerType.WEARABLE)
            } finally {
                pending.finish()
            }
        }
    }
}
