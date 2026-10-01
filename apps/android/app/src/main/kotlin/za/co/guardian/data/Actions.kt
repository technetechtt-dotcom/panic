package za.co.guardian.data

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
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
    data class Started(val incident: LocalIncident, val tracking: Boolean) : SosOutcome
    data object NeedSignIn : SosOutcome
    data object NeedDevice : SosOutcome
}

interface SosActions {
    suspend fun send(type: za.co.guardian.core.TriggerType = za.co.guardian.core.TriggerType.MANUAL_SOS): SosOutcome
}

interface ProtectionStatusSource {
    fun current(): ProtectionHealth
}

interface PracticeModeReader {
    fun enabled(): Boolean
    fun remainingMs(): Long = 0L
}

interface EmergencyServiceController {
    fun start(captureAudio: Boolean = false)
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
    override suspend fun send(type: za.co.guardian.core.TriggerType): SosOutcome {
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
        settings.quietIncident(false)
        val tracking = signals.hasFineLocation()
        val audio = type == za.co.guardian.core.TriggerType.MANUAL_SOS && settings.shareAudio()
        controller.start(audio)
        if (incident.syncState == SyncState.PENDING) {
            val request = OneTimeWorkRequestBuilder<IncidentFlushWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("guardian-incident-flush", ExistingWorkPolicy.KEEP, request)
        }
        return SosOutcome.Started(incident, tracking)
    }
}

class AndroidEmergencyServiceController @Inject constructor(
    @ApplicationContext private val context: Context,
) : EmergencyServiceController {
    override fun start(captureAudio: Boolean) {
        val intent = Intent(context, EmergencyMonitoringService::class.java).putExtra("captureAudio", captureAudio)
        try {
            ContextCompat.startForegroundService(context, intent)
        } catch (_: Exception) {
            // Android can refuse a foreground service started from the background. The SOS is already stored.
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
        return if (enabled.contains(component)) {
            HealthCheck("volume", "Volume trigger", CheckStatus.PASS, "Three volume-down presses send SOS. The buttons still change the volume.")
        } else {
            HealthCheck("volume", "Volume trigger", CheckStatus.FAIL, "Turn on Guardian in accessibility settings")
        }
    }

    private fun safeWordCheck(): HealthCheck {
        val phrase = settings.safeWord()
        if (phrase.length < 4) return HealthCheck("safeword", "Safe word", CheckStatus.FAIL, "Choose a phrase of at least 4 letters")
        val available = android.speech.SpeechRecognizer.isRecognitionAvailable(context)
        return if (available) {
            HealthCheck("safeword", "Safe word", CheckStatus.PASS, "Listening uses the phone speech recognizer. The microphone indicator stays visible.")
        } else {
            HealthCheck("safeword", "Safe word", CheckStatus.UNAVAILABLE, "This phone has no speech recognizer")
        }
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
        registerDevice()
    }

    suspend fun login(email: String, password: String) {
        val session = api.login(LoginBody(email.trim(), password)).data
        tokens.saveSession(session.accessToken, session.refreshToken, session.user.id)
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
    suspend fun addGuardian(name: String): String {
        if (name.isBlank()) return "Enter a guardian's name."
        val saved = api.addGuardian(GuardianBody(name.trim(), canViewLocation = false, canViewEvidence = false)).data
        settings.guardianReady(true)
        return "Saved ${saved.displayName}. Guardian is not texted automatically."
    }

    suspend fun startJourney(label: String, minutes: Int): String {
        if (label.isBlank()) return "Enter where you are going."
        val bounded = minutes.coerceIn(1, 360)
        val arrival = java.time.Instant.now().plusSeconds(bounded * 60L)
        val stamp = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
            .withZone(java.time.ZoneOffset.UTC)
            .format(arrival)
        val journey = api.startJourney(JourneyBody(label.trim(), stamp, minOf(300, bounded * 60).coerceAtLeast(60))).data
        return "Journey ${journey.status.lowercase()}. A missed check-in raises concern. It does not send SOS by itself."
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
        settings.quietIncident(true)
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
