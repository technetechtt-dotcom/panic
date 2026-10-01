package za.co.guardian.service

import android.accessibilityservice.AccessibilityService
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
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

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount != 0) return false
        val key = when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_DOWN -> VolumeKey.DOWN
            KeyEvent.KEYCODE_VOLUME_UP -> VolumeKey.UP
            else -> return false
        }
        if (!detector.onPress(key, event.eventTime)) return false
        if (settings.volumeTestActive(System.currentTimeMillis())) {
            settings.noteVolumeTest()
            return false
        }
        val now = event.eventTime
        if (now - lastPatternAt < 5_000) return false
        lastPatternAt = now
        scope.launch { actions.send(TriggerType.VOLUME_BUTTON) }
        return false
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }
}
