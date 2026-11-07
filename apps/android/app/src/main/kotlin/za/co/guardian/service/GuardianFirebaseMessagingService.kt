package za.co.guardian.service

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import za.co.guardian.MainActivity
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
        val type = message.data["type"].orEmpty()
        if (type != "GUARDIAN_INCIDENT") return
        val roomUrl = message.data["roomUrl"].orEmpty()
        val incidentId = message.data["incidentId"].orEmpty()
        val title = message.notification?.title ?: "Guardian alert"
        val body = message.notification?.body ?: "Someone you protect needs help."

        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Guardian alerts", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "Urgent alerts for people you protect."
                    enableVibration(true)
                },
            )
        }

        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("roomUrl", roomUrl)
            .putExtra("incidentId", incidentId)
            .putExtra("guardianAlert", true)
        val pending = PendingIntent.getActivity(
            this,
            incidentId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(pending)
            .build()

        if (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        ) {
            manager.notify(incidentId.hashCode().takeIf { it != 0 } ?: 3101, notification)
        }
    }

    private companion object {
        const val CHANNEL_ID = "guardian.trusted.alerts"
    }
}
