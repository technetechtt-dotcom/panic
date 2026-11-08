package za.co.guardian.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
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
        val captureId = UUID.randomUUID().toString()
        val hash = sha256(bytes)
        return storeChunk(
            localIncidentId = localIncidentId,
            type = type,
            bytes = bytes,
            captureId = captureId,
            chunkIndex = 0,
            chunkCount = 1,
            originalSha256 = hash,
            originalSize = bytes.size.toLong(),
            capturedAtEpochMs = System.currentTimeMillis(),
        )
    }

    suspend fun storeFileChunks(
        localIncidentId: String,
        type: String,
        file: File,
        chunkBytes: Int = 900_000,
    ): Int {
        if (!file.exists() || file.length() <= 0L) return 0
        val boundedChunk = chunkBytes.coerceIn(64 * 1024, 1_400_000)
        val captureId = UUID.randomUUID().toString()
        val capturedAt = System.currentTimeMillis()
        val originalSize = file.length()
        val originalHash = file.inputStream().buffered().use { input ->
            val digest = MessageDigest.getInstance("SHA-256")
            val buffer = ByteArray(128 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                digest.update(buffer, 0, read)
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }
        val chunkCount = ((originalSize + boundedChunk - 1) / boundedChunk).toInt()
        var stored = 0
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(boundedChunk)
            var index = 0
            while (true) {
                val read = input.read(buffer)
                if (read <= 0) break
                if (
                    storeChunk(
                        localIncidentId = localIncidentId,
                        type = type,
                        bytes = buffer.copyOf(read),
                        captureId = captureId,
                        chunkIndex = index,
                        chunkCount = chunkCount,
                        originalSha256 = originalHash,
                        originalSize = originalSize,
                        capturedAtEpochMs = capturedAt,
                    ) != null
                ) stored += 1
                index += 1
            }
        }
        return stored
    }

    private suspend fun storeChunk(
        localIncidentId: String,
        type: String,
        bytes: ByteArray,
        captureId: String,
        chunkIndex: Int,
        chunkCount: Int,
        originalSha256: String,
        originalSize: Long,
        capturedAtEpochMs: Long,
    ): EvidenceEntity? {
        if (bytes.isEmpty() || localIncidentId.isBlank()) return null
        val id = UUID.randomUUID().toString()
        val sequence = database.evidence().lastSequence(localIncidentId, type) + 1
        val hash = sha256(bytes)
        val directory = File(context.filesDir, "evidence").apply { mkdirs() }
        val file = File(directory, "$id.bin")
        file.writeBytes(encrypt(bytes))
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
            captureId = captureId,
            chunkIndex = chunkIndex,
            chunkCount = chunkCount,
            originalSha256 = originalSha256,
            originalSize = originalSize,
            capturedAtEpochMs = capturedAtEpochMs,
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
        return cipher.iv + encrypted
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
