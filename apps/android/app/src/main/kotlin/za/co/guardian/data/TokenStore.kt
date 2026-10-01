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

    override fun enabled(): Boolean = practiceMode()
    fun practiceMode(): Boolean = prefs.getBoolean(PRACTICE, false)
    fun setPracticeMode(enabled: Boolean) = prefs.edit().putBoolean(PRACTICE, enabled).apply()
    fun incidentActive(): Boolean = prefs.getBoolean(ACTIVE, false)
    fun setIncidentActive(active: Boolean) = prefs.edit().putBoolean(ACTIVE, active).apply()

    private companion object {
        const val PRACTICE = "practice"
        const val ACTIVE = "incident_active"
    }
}
