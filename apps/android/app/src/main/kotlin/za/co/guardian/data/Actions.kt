package za.co.guardian.data

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import za.co.guardian.MainActivity
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import retrofit2.HttpException
import za.co.guardian.core.CheckStatus
import za.co.guardian.core.HealthCheck
import za.co.guardian.core.LocalIncident
import za.co.guardian.core.OfflineIncidentRepository
import za.co.guardian.core.ProtectionHealth
import za.co.guardian.core.ProtectionHealthEvaluator
import za.co.guardian.core.SosContext
import za.co.guardian.core.SyncState
import za.co.guardian.service.EmergencyMonitoringService
import za.co.guardian.service.IncidentFlushWorker
import java.util.concurrent.TimeUnit
import javax.inject.Inject

sealed interface SosOutcome {
    data class Started(val incident: LocalIncident, val tracking: Boolean, val trackingNote: String = "") : SosOutcome
    data object NeedSignIn : SosOutcome
    data object NeedDevice : SosOutcome
}

interface SosActions {
    suspend fun send(
        type: za.co.guardian.core.TriggerType = za.co.guardian.core.TriggerType.MANUAL_SOS,
        origin: za.co.guardian.core.MonitoringOrigin = za.co.guardian.core.MonitoringOrigin.USER_VISIBLE,
    ): SosOutcome
}

interface ProtectionStatusSource {
    fun current(): ProtectionHealth
}

interface PracticeModeReader {
    fun enabled(): Boolean
    fun remainingMs(): Long = 0L
}

interface EmergencyServiceController {
    fun start(plan: za.co.guardian.core.MonitoringStart)
}

class DefaultSosActions @Inject constructor(
    private val repository: OfflineIncidentRepository,
    private val tokens: TokenStore,
    private val settings: SettingsStore,
    private val signals: PhoneSignals,
    private val health: AndroidProtectionHealth,
    private val controller: EmergencyServiceController,
    @ApplicationContext private val context: Context,
) : SosActions {
    override suspend fun send(
        type: za.co.guardian.core.TriggerType,
        origin: za.co.guardian.core.MonitoringOrigin,
    ): SosOutcome {
        val userId = tokens.userId() ?: return SosOutcome.NeedSignIn
        val deviceId = tokens.deviceServerId() ?: return SosOutcome.NeedDevice
        val (fresh, lastKnown) = signals.freshAndLastKnown()
        val incident = repository.trigger(
            type,
            SosContext(
                userId = userId,
                deviceId = deviceId,
                isTest = settings.enabled(),
                freshLocation = fresh,
                lastKnownLocation = lastKnown,
                deviceState = signals.deviceState(),
                protectionStatus = health.current().level.name,
            ),
        )
        settings.setIncidentActive(true)
        if (!settings.quietIncident()) settings.quietIncident(false)
        val stage = settings.advanceTrigger()
        val micGranted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.RECORD_AUDIO,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val audio = !settings.quietIncident() && micGranted && (settings.evidenceMode() || (stage == "SOS" && type == za.co.guardian.core.TriggerType.MANUAL_SOS && settings.shareAudio()))
        val plan = za.co.guardian.core.monitoringStart(origin, signals.hasFineLocation(), micGranted, audio && !settings.quietIncident())
        controller.start(plan)
        val tracking = plan.startService && plan.locationUpdates
        sendGuardianSms(incident.isTest)
        if (incident.syncState == SyncState.PENDING) {
            val request = OneTimeWorkRequestBuilder<IncidentFlushWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("guardian-incident-flush", ExistingWorkPolicy.KEEP, request)
        }
        val trackingNote = if (!plan.startService) {
            "saved. Android will not start location or the microphone from this background trigger. Open Guardian to share location."
        } else {
            ""
        }
        return SosOutcome.Started(incident, tracking, trackingNote)
    }

    private fun sendGuardianSms(testIncident: Boolean) {
        if (testIncident) return
        val phone = settings.guardianPhone()
        if (phone.isBlank()) return
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.SEND_SMS,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!granted) return
        try {
            val sms = if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                context.getSystemService(android.telephony.SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                android.telephony.SmsManager.getDefault()
            }
            sms?.sendTextMessage(
                phone,
                null,
                "Guardian: I need help. This text was sent from my phone.",
                null,
                null,
            )
        } catch (_: Exception) {
            // A missing SIM or a carrier rejection must not block the SOS that is already saved.
        }
    }
}

class AndroidEmergencyServiceController @Inject constructor(
    @ApplicationContext private val context: Context,
) : EmergencyServiceController {
    override fun start(plan: za.co.guardian.core.MonitoringStart) {
        if (!plan.startService) {
            if (plan.notifyToOpenApp) notifyOpenApp()
            return
        }
        val intent = Intent(context, EmergencyMonitoringService::class.java)
            .putExtra("location", plan.locationUpdates)
            .putExtra("microphone", plan.microphone)
        try {
            ContextCompat.startForegroundService(context, intent)
        } catch (_: Exception) {
            if (plan.notifyToOpenApp) notifyOpenApp()
        }
    }

    private fun notifyOpenApp() {
        val channelId = "guardian.resume"
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
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
            .setContentText("SOS is saved. Android will not start location until you open Guardian.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        if (android.os.Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            manager.notify(1002, notification)
        }
    }
}

class AndroidProtectionHealth @Inject constructor(
    private val tokens: TokenStore,
    private val signals: PhoneSignals,
    private val settings: SettingsStore,
    @ApplicationContext private val context: Context,
) : ProtectionStatusSource {
    private val evaluator = ProtectionHealthEvaluator()

    override fun current(): ProtectionHealth {
        val checks = listOf(
            check("location", "Location", signals.hasFineLocation(), "Location permission is off"),
            check("notifications", "Notifications", signals.hasNotifications(), "Notification permission is off"),
            check("device", "This phone", tokens.deviceServerId() != null, "This phone is not registered yet"),
            check("internet", "Internet", signals.deviceState().networkType != "NO_INTERNET", "No internet connection"),
            volumeCheck(),
            safeWordCheck(),
            if (settings.guardianReady()) HealthCheck("guardian", "Guardian", CheckStatus.PASS, "A guardian is saved")
            else HealthCheck("guardian", "Guardian", CheckStatus.FAIL, "Add a guardian in settings"),
        )
        return evaluator.evaluate(tokens.userId() != null, checks)
    }

    private fun volumeCheck(): HealthCheck {
        val enabled = android.provider.Settings.Secure.getString(
            context.contentResolver,
            android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ).orEmpty()
        val component = android.content.ComponentName(context, za.co.guardian.service.VolumeSosService::class.java).flattenToString()
        val pattern = settings.volumePattern()
        val detail = "${pattern.presses}× ${if (pattern.key == za.co.guardian.core.VolumeKey.DOWN) "volume down" else "volume up"} within ${settings.volumeWindowMs() / 1000.0}s. The buttons still change the volume."
        return if (enabled.contains(component) && settings.volumeConnected()) {
            HealthCheck("volume", "Volume trigger", CheckStatus.PASS, detail)
        } else {
            HealthCheck("volume", "Volume trigger", CheckStatus.FAIL, "Volume protection is off. Turn Guardian back on in accessibility settings.")
        }
    }

    private fun safeWordCheck(): HealthCheck {
        val phrase = settings.safeWord()
        val configured = phrase.length >= 4
        val mic = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.RECORD_AUDIO,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val detector = settings.safeWordTemplateCount() >= 3
        val age = settings.safeWordHeartbeatAgeMs()
        val listening = settings.safeWordEnabled() && age < 8_000
        val detail = buildString {
            append(if (configured) "Configured. " else "No phrase. ")
            append(if (mic) "Mic permission on. " else "Mic permission off. ")
            append(if (detector) "Detector ready. " else "Record the phrase 3 times. ")
            append(if (listening) "Listening. Last check ${age / 1000}s ago." else "Not listening.")
        }
        val status = when {
            listening && configured && mic && detector -> CheckStatus.PASS
            !configured && !detector -> CheckStatus.FAIL
            else -> CheckStatus.FAIL
        }
        return HealthCheck("safeword", "Safe word", status, detail.trim())
    }

    private fun check(id: String, label: String, ok: Boolean, failure: String): HealthCheck {
        return HealthCheck(id, label, if (ok) CheckStatus.PASS else CheckStatus.FAIL, if (ok) "Ready" else failure)
    }
}

class AuthRepository @Inject constructor(
    private val api: GuardianApi,
    private val tokens: TokenStore,
    private val signer: DeviceSigner,
) {
    suspend fun register(email: String, password: String, displayName: String) {
        val session = api.register(RegisterBody(email.trim(), password, displayName.trim(), true)).data
        tokens.saveSession(session.accessToken, session.refreshToken, session.user.id)
        tokens.setUserRole(session.user.role)
        registerDevice()
    }

    suspend fun login(email: String, password: String) {
        val session = api.login(LoginBody(email.trim(), password)).data
        tokens.saveSession(session.accessToken, session.refreshToken, session.user.id)
        tokens.setUserRole(session.user.role)
        registerDevice()
    }

    suspend fun registerDevice() {
        val device = api.registerDevice(
            DeviceBody(
                devicePublicId = tokens.publicDeviceId(),
                platform = "ANDROID",
                manufacturer = android.os.Build.MANUFACTURER ?: "unknown",
                model = android.os.Build.MODEL ?: "unknown",
                osVersion = android.os.Build.VERSION.RELEASE ?: "unknown",
                appVersion = za.co.guardian.BuildConfig.VERSION_NAME,
                publicKey = signer.publicKeySpki(),
            ),
        ).data
        tokens.saveDevice(device.id)
        if (tokens.emergencyCredential() == null) {
            val issued = api.emergencyCredential(EmergencyCredentialBody(device.id)).data
            tokens.saveEmergencyCredential(issued.credential)
        }
    }

    suspend fun logout() {
        val refresh = tokens.refreshToken()
        if (refresh != null) {
            try {
                api.logout(RefreshBody(refresh))
            } catch (_: Exception) {
                // Local sign-out still proceeds.
            }
        }
        tokens.clear()
    }

    suspend fun checkConnection(): String = api.health().data.status

    fun signedIn(): Boolean = tokens.accessToken() != null
}

fun Throwable.userMessage(): String {
    if (this is HttpException) {
        val raw = runCatching { response()?.errorBody()?.string() }.getOrNull().orEmpty()
        val match = Regex("\"message\"\\s*:\\s*\"([^\"]+)\"").find(raw)?.groupValues?.getOrNull(1)
        if (!match.isNullOrBlank()) return match
    }
    return message ?: "The request failed."
}

class ProtectionActions @Inject constructor(
    private val api: GuardianApi,
    private val database: GuardianDatabase,
    private val settings: SettingsStore,
) {
    suspend fun addGuardian(name: String, phone: String = ""): String {
        if (name.isBlank()) return "Enter a guardian's name."
        val saved = api.addGuardian(
            GuardianBody(name.trim(), canViewLocation = true, canViewEvidence = false, phone = phone.trim().ifBlank { null }),
        ).data
        settings.guardianReady(true)
        if (phone.isNotBlank()) settings.setGuardianPhone(phone)
        val delivery = if (phone.isBlank()) "No phone number was saved, so SMS cannot be sent for this guardian." else "The hub texts this number when SMS is configured. This phone can also text it after you allow SMS."
        return "Saved ${saved.displayName}. $delivery"
    }

    suspend fun startJourney(label: String, minutes: Int, mode: String): String {
        if (label.isBlank()) return "Enter where you are going."
        val bounded = minutes.coerceIn(1, 360)
        val interval = when (mode) {
            "MEETING" -> 120
            "HIGH_RISK" -> 60
            "RIDE", "DRIVE" -> 300
            else -> minOf(300, bounded * 60).coerceAtLeast(60)
        }
        val arrival = java.time.Instant.now().plusSeconds(bounded * 60L)
        val stamp = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            .withZone(java.time.ZoneOffset.UTC)
            .format(arrival)
        val journey = api.startJourney(JourneyBody(label.trim(), stamp, interval, mode)).data
        settings.setProtectionMode(mode)
        return "${mode.lowercase().replace('_', ' ')} watch is ${journey.status.lowercase()}. A missed check-in raises concern on the server. It does not replace the SOS button."
    }

    suspend fun saveProfile(bloodType: String, allergies: String, medications: String, notes: String): String {
        api.saveProfile(
            ProfileBody(
                bloodType = bloodType.trim().ifBlank { null },
                allergies = allergies.trim().ifBlank { null },
                medications = medications.trim().ifBlank { null },
                notes = notes.trim().ifBlank { null },
            ),
        )
        return "Emergency profile saved. It is shared with the monitoring hub during an incident export, not posted publicly."
    }

    suspend fun setPins(cancelPin: String, duressPin: String): String {
        if (!cancelPin.matches(Regex("[0-9]{4,8}")) || !duressPin.matches(Regex("[0-9]{4,8}"))) {
            return "Use two different PINs of 4 to 8 digits."
        }
        if (cancelPin == duressPin) return "The duress PIN must be different."
        api.setPins(PinBody(cancelPin, duressPin))
        return "PINs saved on the server. They are not shown again."
    }

    suspend fun cancel(pin: String): String {
        val incident = database.incidents().list().firstOrNull { it.serverId != null && it.state != "RESOLVED" && it.state != "ARCHIVED" }
            ?: return "There is no connected emergency to cancel."
        api.cancel(incident.serverId!!, CancelBody(pin))
        val after = api.incident(incident.serverId!!).data
        if (after.state == "RESOLVED" || after.state == "ARCHIVED") {
            settings.setIncidentActive(false)
            settings.clearTrigger()
        } else {
            settings.quietIncident(true)
            settings.setEvidenceMode(false)
        }
        return "Emergency cancelled."
    }
}

@Module
@InstallIn(SingletonComponent::class)
abstract class ActionBindings {
    @Binds abstract fun sos(impl: DefaultSosActions): SosActions
    @Binds abstract fun service(impl: AndroidEmergencyServiceController): EmergencyServiceController
    @Binds abstract fun health(impl: AndroidProtectionHealth): ProtectionStatusSource
    @Binds abstract fun practice(impl: SettingsStore): PracticeModeReader
    @Binds abstract fun signer(impl: AndroidDeviceSigner): DeviceSigner
}
