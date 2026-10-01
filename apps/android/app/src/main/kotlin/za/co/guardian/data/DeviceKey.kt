package za.co.guardian.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

interface DeviceSigner {
    fun publicKeySpki(): String?
    fun sign(message: String): String?
}

@Singleton
class AndroidDeviceSigner @Inject constructor() : DeviceSigner {
    override fun publicKeySpki(): String? = runCatching {
        Base64.encodeToString(keyPair().public.encoded, Base64.NO_WRAP)
    }.getOrNull()

    override fun sign(message: String): String? = runCatching {
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(keyPair().private)
        signature.update(message.toByteArray(Charsets.UTF_8))
        Base64.encodeToString(signature.sign(), Base64.NO_WRAP)
    }.getOrNull()

    private fun keyPair(): KeyPair {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = keyStore.getEntry(ALIAS, null) as? KeyStore.PrivateKeyEntry
        if (existing != null) return KeyPair(existing.certificate.publicKey, existing.privateKey)
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .build()
        generator.initialize(spec)
        return generator.generateKeyPair()
    }

    private companion object {
        const val ALIAS = "guardian.device"
    }
}
