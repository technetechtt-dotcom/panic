package za.co.guardian.service

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import za.co.guardian.R
import za.co.guardian.core.TriggerType
import za.co.guardian.core.keywordMatches
import za.co.guardian.core.pcmFeatures
import za.co.guardian.data.SettingsStore
import za.co.guardian.data.SosActions
import javax.inject.Inject

@AndroidEntryPoint
class SafeWordService : android.app.Service() {
    @Inject lateinit var actions: SosActions
    @Inject lateinit var settings: SettingsStore

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var matched = false

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val templates = settings.safeWordTemplates()
        val mic = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (!settings.safeWordEnabled() || templates.size < 3 || !mic) {
            settings.safeWordEnabled(false)
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = listeningNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        scope.launch { listen(templates) }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    private suspend fun listen(enrolled: List<FloatArray>) {
        val rate = 16_000
        val min = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return
        val recorder = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            rate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            min.coerceAtLeast(rate * 2),
        )
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            return
        }
        val window = ShortArray(rate)
        recorder.startRecording()
        var hits = 0
        try {
            while (scope.isActive && !matched && settings.safeWordEnabled()) {
                var filled = 0
                while (filled < window.size) {
                    val read = recorder.read(window, filled, window.size - filled)
                    if (read <= 0) break
                    filled += read
                }
                settings.noteSafeWordHeartbeat()
                if (filled < window.size / 2) {
                    delay(200)
                    continue
                }
                val live = pcmFeatures(window.copyOf(filled))
                if (keywordMatches(live, enrolled, settings.safeWordSensitivity())) {
                    hits += 1
                    if (hits >= 2) {
                        matched = true
                        actions.send(TriggerType.VOICE_SAFE_WORD, za.co.guardian.core.MonitoringOrigin.PROCESS_FOREGROUND)
                        stopSelf()
                    }
                } else {
                    hits = 0
                }
            }
        } finally {
            recorder.stop()
            recorder.release()
        }
    }

    private fun listeningNotification(): Notification {
        val channelId = "guardian.safeword"
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(channelId, getString(R.string.safeword_channel), NotificationManager.IMPORTANCE_LOW))
        }
        return NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Safe word listening")
            .setContentText(getString(R.string.safeword_text))
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 1003
    }
}
