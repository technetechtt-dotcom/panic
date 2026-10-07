package za.co.guardian

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import za.co.guardian.data.AuthRepository
import za.co.guardian.data.TokenStore
import javax.inject.Inject

@HiltAndroidApp
class GuardianApp : Application(), Configuration.Provider {
    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var tokens: TokenStore
    @Inject lateinit var auth: AuthRepository

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()

    override fun onCreate() {
        super.onCreate()
        registerFcm()
    }

    private fun registerFcm() {
        try {
            if (FirebaseApp.getApps(this).isEmpty()) FirebaseApp.initializeApp(this)
            if (FirebaseApp.getApps(this).isEmpty()) return
            FirebaseMessaging.getInstance().token.addOnSuccessListener { token ->
                tokens.setFcmToken(token)
                if (tokens.accessToken() == null) return@addOnSuccessListener
                CoroutineScope(Dispatchers.IO).launch {
                    runCatching { auth.registerDevice() }
                }
            }
        } catch (_: Exception) {
            // google-services.json is not in this build, so FCM is not registered.
        }
    }
}
