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
    suspend fun send(): SosOutcome
}

interface ProtectionStatusSource {
    fun current(): ProtectionHealth
}

interface PracticeModeReader {
    fun enabled(): Boolean
}

interface EmergencyServiceController {
    fun start()
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
    override suspend fun send(): SosOutcome {
        val userId = tokens.userId() ?: return SosOutcome.NeedSignIn
        val deviceId = tokens.deviceServerId() ?: return SosOutcome.NeedDevice
        val (fresh, lastKnown) = signals.freshAndLastKnown()
        val incident = repository.triggerManual(
            SosContext(
                userId = userId,
                deviceId = deviceId,
                isTest = settings.practiceMode(),
                freshLocation = fresh,
                lastKnownLocation = lastKnown,
                deviceState = signals.deviceState(),
                protectionStatus = health.current().level.name,
            ),
        )
        settings.setIncidentActive(true)
        val tracking = signals.hasFineLocation()
        if (tracking) controller.start()
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
    override fun start() {
        ContextCompat.startForegroundService(context, Intent(context, EmergencyMonitoringService::class.java))
    }
}

class AndroidProtectionHealth @Inject constructor(
    private val tokens: TokenStore,
    private val signals: PhoneSignals,
) : ProtectionStatusSource {
    private val evaluator = ProtectionHealthEvaluator()

    override fun current(): ProtectionHealth {
        val checks = listOf(
            check("location", "Location", signals.hasFineLocation(), "Location permission is off"),
            check("notifications", "Notifications", signals.hasNotifications(), "Notification permission is off"),
            check("device", "This phone", tokens.deviceServerId() != null, "This phone is not registered yet"),
            check("internet", "Internet", signals.deviceState().networkType != "NO_INTERNET", "No internet connection"),
            HealthCheck("volume", "Volume trigger", CheckStatus.UNAVAILABLE, "Not in this version"),
            HealthCheck("safeword", "Safe word", CheckStatus.UNAVAILABLE, "Not in this version"),
            HealthCheck("guardian", "Guardian", CheckStatus.UNAVAILABLE, "Not in this version"),
        )
        return evaluator.evaluate(tokens.userId() != null, checks)
    }

    private fun check(id: String, label: String, ok: Boolean, failure: String): HealthCheck {
        return HealthCheck(id, label, if (ok) CheckStatus.PASS else CheckStatus.FAIL, if (ok) "Ready" else failure)
    }
}

class AuthRepository @Inject constructor(
    private val api: GuardianApi,
    private val tokens: TokenStore,
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

@Module
@InstallIn(SingletonComponent::class)
abstract class ActionBindings {
    @Binds abstract fun sos(impl: DefaultSosActions): SosActions
    @Binds abstract fun service(impl: AndroidEmergencyServiceController): EmergencyServiceController
    @Binds abstract fun health(impl: AndroidProtectionHealth): ProtectionStatusSource
    @Binds abstract fun practice(impl: SettingsStore): PracticeModeReader
}
