package za.co.guardian.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TokenStore @Inject constructor(@ApplicationContext context: Context) {
    private val prefs: SharedPreferences

    init {
        val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)
        prefs = EncryptedSharedPreferences.create(
            "guardian_tokens",
            masterKeyAlias,
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    fun accessToken(): String? = prefs.getString(ACCESS, null)
    fun refreshToken(): String? = prefs.getString(REFRESH, null)
    fun userId(): String? = prefs.getString(USER, null)
    fun deviceServerId(): String? = prefs.getString(DEVICE, null)

    fun publicDeviceId(): String {
        val existing = prefs.getString(PUBLIC_DEVICE, null)
        if (existing != null) return existing
        val created = UUID.randomUUID().toString()
        prefs.edit().putString(PUBLIC_DEVICE, created).apply()
        return created
    }

    fun saveSession(accessToken: String, refreshToken: String, userId: String) {
        prefs.edit().putString(ACCESS, accessToken).putString(REFRESH, refreshToken).putString(USER, userId).apply()
    }

    fun saveDevice(serverId: String) {
        prefs.edit().putString(DEVICE, serverId).apply()
    }

    fun emergencyCredential(): String? = prefs.getString(EMERGENCY, null)
    fun saveEmergencyCredential(credential: String) = prefs.edit().putString(EMERGENCY, credential).apply()
    fun userRole(): String = prefs.getString(ROLE, "USER").orEmpty()
    fun setUserRole(role: String) = prefs.edit().putString(ROLE, role).apply()
    fun freezeDecoyPin(): String = prefs.getString(FREEZE_DECOY, "").orEmpty()
    fun setFreezeDecoyPin(pin: String) = prefs.edit().putString(FREEZE_DECOY, pin).apply()
    fun freezeReleasePin(): String = prefs.getString(FREEZE_RELEASE, "").orEmpty()
    fun setFreezeReleasePin(pin: String) = prefs.edit().putString(FREEZE_RELEASE, pin).apply()

    fun clear() {
        val publicId = prefs.getString(PUBLIC_DEVICE, null)
        prefs.edit().clear().apply()
        if (publicId != null) prefs.edit().putString(PUBLIC_DEVICE, publicId).apply()
    }

    private companion object {
        const val ACCESS = "access"
        const val REFRESH = "refresh"
        const val USER = "user"
        const val DEVICE = "device"
        const val PUBLIC_DEVICE = "public_device"
        const val EMERGENCY = "emergency"
        const val ROLE = "role"
        const val FREEZE_DECOY = "freeze_decoy"
        const val FREEZE_RELEASE = "freeze_release"
    }
}

@Singleton
class SettingsStore @Inject constructor(@ApplicationContext context: Context) : PracticeModeReader {
    private val prefs = context.getSharedPreferences("guardian_settings", Context.MODE_PRIVATE)

    override fun enabled(): Boolean = testSessionActive(System.currentTimeMillis())
    override fun remainingMs(): Long {
        val until = prefs.getLong(TEST_UNTIL, 0L)
        return (until - System.currentTimeMillis()).coerceAtLeast(0L)
    }

    fun testSessionActive(now: Long): Boolean {
        val until = prefs.getLong(TEST_UNTIL, 0L)
        if (until == 0L) return false
        if (now >= until) {
            prefs.edit().remove(TEST_UNTIL).apply()
            return false
        }
        return true
    }

    fun startTestSession(now: Long = System.currentTimeMillis()) {
        val session = za.co.guardian.core.startTestSession(now)
        prefs.edit().putLong(TEST_UNTIL, session.expiresAtEpochMs).remove(PRACTICE).apply()
    }

    fun safeWord(): String = prefs.getString(SAFE_WORD, "").orEmpty()
    fun setSafeWord(phrase: String) = prefs.edit().putString(SAFE_WORD, phrase.trim()).apply()
    fun shareAudio(): Boolean = prefs.getBoolean(SHARE_AUDIO, false)
    fun setShareAudio(enabled: Boolean) = prefs.edit().putBoolean(SHARE_AUDIO, enabled).apply()
    fun volumeTestActive(now: Long): Boolean = now < prefs.getLong(VOLUME_TEST_UNTIL, 0L)
    fun startVolumeTest(now: Long = System.currentTimeMillis()) = prefs.edit().putLong(VOLUME_TEST_UNTIL, now + 30_000).apply()
    fun noteVolumeTest() = prefs.edit().putLong(VOLUME_TEST_SEEN, System.currentTimeMillis()).apply()
    fun volumeTestSeen(): Long = prefs.getLong(VOLUME_TEST_SEEN, 0L)
    fun guardianReady(ready: Boolean) = prefs.edit().putBoolean(GUARDIAN_READY, ready).apply()
    fun guardianReady(): Boolean = prefs.getBoolean(GUARDIAN_READY, false)
    fun incidentActive(): Boolean = prefs.getBoolean(ACTIVE, false)
    fun setIncidentActive(active: Boolean) = prefs.edit().putBoolean(ACTIVE, active).apply()
    fun quietIncident(quiet: Boolean) = prefs.edit().putBoolean(QUIET, quiet).apply()
    fun quietIncident(): Boolean = prefs.getBoolean(QUIET, false)
    fun volumePattern(): za.co.guardian.core.VolumePattern =
        za.co.guardian.core.VolumePattern.fromStored(prefs.getString(VOLUME_PATTERN, null))
    fun setVolumePattern(pattern: za.co.guardian.core.VolumePattern) =
        prefs.edit().putString(VOLUME_PATTERN, pattern.name).apply()
    fun volumeWindowMs(): Long = prefs.getLong(VOLUME_WINDOW, 1_500L).coerceIn(800L, 4_000L)
    fun setVolumeWindowMs(windowMs: Long) = prefs.edit().putLong(VOLUME_WINDOW, windowMs.coerceIn(800L, 4_000L)).apply()
    fun vibrateOnTrigger(): Boolean = prefs.getBoolean(VOLUME_VIBRATE, true)
    fun setVibrateOnTrigger(enabled: Boolean) = prefs.edit().putBoolean(VOLUME_VIBRATE, enabled).apply()
    fun volumeConnected(connected: Boolean) = prefs.edit().putBoolean(VOLUME_CONNECTED, connected).apply()
    fun volumeConnected(): Boolean = prefs.getBoolean(VOLUME_CONNECTED, false)
    fun advanceTrigger(): String {
        val count = prefs.getInt(TRIGGER_COUNT, 0) + 1
        prefs.edit().putInt(TRIGGER_COUNT, count).apply()
        val stage = za.co.guardian.core.triggerStage(count)
        if (stage != "SOS") prefs.edit().putBoolean(EVIDENCE_MODE, true).apply()
        return stage
    }
    fun triggerStage(): String = za.co.guardian.core.triggerStage(prefs.getInt(TRIGGER_COUNT, 0).coerceAtLeast(1))
    fun clearTrigger() = prefs.edit().putInt(TRIGGER_COUNT, 0).putBoolean(EVIDENCE_MODE, false).putBoolean(QUIET, false).apply()
    fun evidenceMode(): Boolean = prefs.getBoolean(EVIDENCE_MODE, false)
    fun setEvidenceMode(enabled: Boolean) = prefs.edit().putBoolean(EVIDENCE_MODE, enabled).apply()
    fun safeWordTemplates(): List<FloatArray> {
        return prefs.getString(SAFE_TEMPLATES, "").orEmpty().split(';').mapNotNull { row ->
            val values = row.split(',').mapNotNull { it.toFloatOrNull() }
            if (values.size < 8) null else values.take(8).toFloatArray()
        }
    }
    fun addSafeWordTemplate(features: FloatArray) {
        val encoded = features.joinToString(",")
        val existing = prefs.getString(SAFE_TEMPLATES, "").orEmpty()
        val next = if (existing.isBlank()) encoded else "$existing;$encoded"
        prefs.edit().putString(SAFE_TEMPLATES, next).apply()
    }
    fun safeWordTemplateCount(): Int = safeWordTemplates().size
    fun safeWordSensitivity(): Int = prefs.getInt(SAFE_SENSITIVITY, 50).coerceIn(0, 100)
    fun setSafeWordSensitivity(value: Int) = prefs.edit().putInt(SAFE_SENSITIVITY, value.coerceIn(0, 100)).apply()
    fun safeWordEnabled(enabled: Boolean) = prefs.edit().putBoolean(SAFE_ENABLED, enabled).apply()
    fun safeWordEnabled(): Boolean = prefs.getBoolean(SAFE_ENABLED, false)
    fun noteSafeWordHeartbeat(now: Long = System.currentTimeMillis()) = prefs.edit().putLong(SAFE_HEARTBEAT, now).apply()
    fun onboarded(): Boolean = prefs.getBoolean(ONBOARDED, false)
    fun setOnboarded(done: Boolean) = prefs.edit().putBoolean(ONBOARDED, done).apply()
    fun fallWatch(): Boolean = prefs.getBoolean(FALL_WATCH, false)
    fun setFallWatch(enabled: Boolean) = prefs.edit().putBoolean(FALL_WATCH, enabled).apply()
    fun protectionMode(): String = prefs.getString(PROTECTION_MODE, "WALK").orEmpty()
    fun setProtectionMode(mode: String) = prefs.edit().putString(PROTECTION_MODE, mode).apply()
    fun freezePattern(): za.co.guardian.core.VolumePattern =
        za.co.guardian.core.VolumePattern.fromStored(prefs.getString(FREEZE_PATTERN, za.co.guardian.core.VolumePattern.UP_2.name))
    fun setFreezePattern(pattern: za.co.guardian.core.VolumePattern) = prefs.edit().putString(FREEZE_PATTERN, pattern.name).apply()
    fun guardianPhone(): String = prefs.getString(GUARDIAN_PHONE, "").orEmpty()
    fun setGuardianPhone(phone: String) = prefs.edit().putString(GUARDIAN_PHONE, phone.trim()).apply()
    fun safeWordHeartbeatAgeMs(now: Long = System.currentTimeMillis()): Long {
        val at = prefs.getLong(SAFE_HEARTBEAT, 0L)
        if (at == 0L) return Long.MAX_VALUE
        return (now - at).coerceAtLeast(0L)
    }

    private companion object {
        const val PRACTICE = "practice"
        const val TEST_UNTIL = "test_until"
        const val ACTIVE = "incident_active"
        const val SAFE_WORD = "safe_word"
        const val SHARE_AUDIO = "share_audio"
        const val VOLUME_TEST_UNTIL = "volume_test_until"
        const val VOLUME_TEST_SEEN = "volume_test_seen"
        const val GUARDIAN_READY = "guardian_ready"
        const val QUIET = "quiet_incident"
        const val VOLUME_PATTERN = "volume_pattern"
        const val VOLUME_WINDOW = "volume_window_ms"
        const val VOLUME_VIBRATE = "volume_vibrate"
        const val VOLUME_CONNECTED = "volume_connected"
        const val TRIGGER_COUNT = "trigger_count"
        const val EVIDENCE_MODE = "evidence_mode"
        const val SAFE_TEMPLATES = "safe_templates"
        const val SAFE_SENSITIVITY = "safe_sensitivity"
        const val SAFE_ENABLED = "safe_enabled"
        const val SAFE_HEARTBEAT = "safe_heartbeat"
        const val ONBOARDED = "onboarded"
        const val FALL_WATCH = "fall_watch"
        const val PROTECTION_MODE = "protection_mode"
        const val FREEZE_PATTERN = "freeze_pattern"
        const val GUARDIAN_PHONE = "guardian_phone"
    }
}
