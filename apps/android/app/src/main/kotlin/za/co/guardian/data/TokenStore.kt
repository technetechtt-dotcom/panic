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
    }
}
