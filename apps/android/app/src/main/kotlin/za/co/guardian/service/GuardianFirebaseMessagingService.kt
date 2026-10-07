package za.co.guardian.service

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import za.co.guardian.data.AuthRepository
import za.co.guardian.data.TokenStore
import javax.inject.Inject

@AndroidEntryPoint
class GuardianFirebaseMessagingService : FirebaseMessagingService() {
    @Inject lateinit var tokens: TokenStore
    @Inject lateinit var auth: AuthRepository

    override fun onNewToken(token: String) {
        tokens.setFcmToken(token)
        if (tokens.accessToken() == null) return
        CoroutineScope(Dispatchers.IO).launch {
            runCatching { auth.registerDevice() }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        // Display is handled by the system tray when the app is backgrounded.
        // Foreground incidents already use EmergencyMonitoringService notifications.
    }
}
