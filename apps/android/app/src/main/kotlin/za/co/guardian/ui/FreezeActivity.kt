package za.co.guardian.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import android.text.InputType
import android.view.Gravity
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import dagger.hilt.android.AndroidEntryPoint
import za.co.guardian.core.releasePinMatches
import za.co.guardian.data.TokenStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

/**
 * Covers the app with one still screen until the release PIN is entered.
 * Android still owns the power button. Screen pinning is requested so the
 * freeze can stay in front, and the system asks before it pins. A reboot
 * does not restore this screen.
 */
@AndroidEntryPoint
class FreezeActivity : ComponentActivity() {
    @Inject lateinit var tokens: TokenStore

    private var released = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // A back press leaves the frozen screen in place.
            }
        })
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val root = FrameLayout(this)
        root.setBackgroundColor(0xFF101114.toInt())
        val clock = TextView(this)
        clock.text = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
        clock.textSize = 72f
        clock.setTextColor(0xFFF4F7FB.toInt())
        clock.gravity = Gravity.CENTER
        val clockParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
        )
        clockParams.gravity = Gravity.CENTER
        root.addView(clock, clockParams)
        val pin = EditText(this)
        pin.inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        pin.hint = "Password"
        pin.visibility = android.view.View.GONE
        val pinParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
        )
        pinParams.gravity = Gravity.BOTTOM
        pinParams.bottomMargin = 80
        pinParams.leftMargin = 48
        pinParams.rightMargin = 48
        root.addView(pin, pinParams)
        clock.setOnLongClickListener {
            pin.visibility = android.view.View.VISIBLE
            pin.requestFocus()
            true
        }
        pin.setOnEditorActionListener { _, _, _ ->
            if (releasePinMatches(pin.text?.toString().orEmpty(), tokens.freezeReleasePin())) {
                released = true
                try {
                    stopLockTask()
                } catch (_: IllegalStateException) {
                    // Pinning was never accepted.
                }
                finish()
            } else {
                pin.text = null
                pin.visibility = android.view.View.GONE
            }
            true
        }
        setContentView(root)
        try {
            startLockTask()
        } catch (_: IllegalArgumentException) {
            // This device will not pin the screen. The freeze remains an activity.
        } catch (_: SecurityException) {
            // The system refused pinning.
        }
    }
}
