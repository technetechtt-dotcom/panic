package za.co.guardian.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class EvidenceVault @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: Context,
    private val database: GuardianDatabase,
) {
    suspend fun store(localIncidentId: String, type: String, bytes: ByteArray): EvidenceEntity? {
        if (bytes.isEmpty() || localIncidentId.isBlank()) return null
        val id = java.util.UUID.randomUUID().toString()
        val sequence = database.evidence().lastSequence(localIncidentId, type) + 1
        val hash = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val directory = File(context.filesDir, "evidence").apply { mkdirs() }
        val file = File(directory, "$id.bin")
        val sealed = encrypt(bytes)
        file.writeBytes(sealed)
        val row = EvidenceEntity(
            evidenceId = id,
            incidentLocalId = localIncidentId,
            serverIncidentId = "",
            type = type,
            sequence = sequence,
            createdAtEpochMs = System.currentTimeMillis(),
            sha256 = hash,
            localPath = file.absolutePath,
            uploadState = "QUEUED",
            retryCount = 0,
            size = bytes.size,
        )
        database.evidence().insert(row)
        return row
    }

    suspend fun bind(localIncidentId: String, serverIncidentId: String) {
        if (serverIncidentId.isBlank()) return
        database.evidence().bind(localIncidentId, serverIncidentId)
    }

    suspend fun pending(): List<EvidenceEntity> = database.evidence().pending()

    fun readPlain(row: EvidenceEntity): ByteArray? {
        val file = File(row.localPath)
        if (!file.exists()) return null
        return decrypt(file.readBytes())
    }

    suspend fun mark(id: String, state: String, retryCount: Int) = database.evidence().mark(id, state, retryCount)

    fun deleteVerified(row: EvidenceEntity) {
        File(row.localPath).delete()
    }

    private fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(plain)
        val header = cipher.iv + encrypted
        return header
    }

    private fun decrypt(payload: ByteArray): ByteArray? {
        if (payload.size < 13) return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            val iv = payload.copyOfRange(0, 12)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            cipher.doFinal(payload.copyOfRange(12, payload.size))
        } catch (_: Exception) {
            null
        }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(ALIAS, null) as? SecretKey
        if (existing != null) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        private const val ALIAS = "guardian.evidence"

        fun sha256(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

        fun base64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)
    }
}
