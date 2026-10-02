package za.co.guardian.service

import android.accessibilityservice.AccessibilityService
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import androidx.core.app.NotificationCompat
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import za.co.guardian.R
import za.co.guardian.core.TriggerType
import za.co.guardian.core.VolumeChordDetector
import za.co.guardian.core.VolumeKey
import za.co.guardian.data.SettingsStore
import za.co.guardian.data.SosActions
import javax.inject.Inject

@AndroidEntryPoint
class VolumeSosService : AccessibilityService() {
    @Inject lateinit var actions: SosActions
    @Inject lateinit var settings: SettingsStore

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val detector = VolumeChordDetector()
    private var lastPatternAt = 0L
    private var appliedPattern = ""
    private var appliedWindow = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        settings.volumeConnected(true)
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0) return false
        val key = when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_DOWN -> VolumeKey.DOWN
            KeyEvent.KEYCODE_VOLUME_UP -> VolumeKey.UP
            else -> return false
        }
        val pattern = settings.volumePattern()
        val window = settings.volumeWindowMs()
        if (appliedPattern != pattern.name || appliedWindow != window) {
            detector.direction = pattern.key
            detector.requiredPresses = pattern.presses
            detector.windowMs = window
            appliedPattern = pattern.name
            appliedWindow = window
        }
        if (!detector.onPress(key, event.eventTime)) return false
        if (settings.volumeTestActive(System.currentTimeMillis())) {
            settings.noteVolumeTest()
            if (settings.vibrateOnTrigger()) vibrate()
            return false
        }
        val now = event.eventTime
        if (now - lastPatternAt < 5_000) return false
        lastPatternAt = now
        if (settings.vibrateOnTrigger()) vibrate()
        scope.launch { actions.send(TriggerType.VOLUME_BUTTON) }
        return false
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        settings.volumeConnected(false)
        notifyUnavailable()
        scope.cancel()
        super.onDestroy()
    }

    private fun vibrate() {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            getSystemService(VIBRATOR_SERVICE) as Vibrator
        }
        if (!vibrator.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(180, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(180)
        }
    }

    private fun notifyUnavailable() {
        val channelId = "guardian.volume"
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(channelId, "Volume protection", NotificationManager.IMPORTANCE_HIGH))
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Volume protection is off")
            .setContentText(getString(R.string.volume_unavailable))
            .setAutoCancel(true)
            .build()
        manager.notify(1004, notification)
    }
}
