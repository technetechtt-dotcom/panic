package za.co.guardian

import android.content.Intent
import android.net.Uri

data class DeepLinkRoute(val destination: String, val token: String)

fun parseGuardianDeepLink(intent: Intent?): DeepLinkRoute? {
    val uri = intent?.data ?: return null
    return parseGuardianDeepLinkString(uri.toString())
}

fun parseGuardianUri(uri: Uri): DeepLinkRoute? = parseGuardianDeepLinkString(uri.toString())

fun parseGuardianDeepLinkString(raw: String): DeepLinkRoute? {
    val value = raw.trim()
    if (value.startsWith("guardian://", ignoreCase = true)) {
        val without = value.removePrefix("guardian://").removePrefix("GUARDIAN://")
        val host = without.substringBefore('?').substringBefore('/').lowercase()
        val query = without.substringAfter('?', missingDelimiterValue = "")
        val token = query.split('&').mapNotNull { part ->
            val key = part.substringBefore('=')
            val encoded = part.substringAfter('=', missingDelimiterValue = "")
            if (key == "token") decode(encoded) else null
        }.firstOrNull()?.takeIf { it.isNotBlank() } ?: return null
        return when (host) {
            "verify" -> DeepLinkRoute("verify", token)
            "reset" -> DeepLinkRoute("reset", token)
            "invite" -> DeepLinkRoute("invite", token)
            else -> null
        }
    }
    val https = Regex("^https://links\\.guardian\\.app/(v|r|i)/([^/?#]+)", RegexOption.IGNORE_CASE).find(value) ?: return null
    val kind = https.groupValues[1].lowercase()
    val token = decode(https.groupValues[2])
    return when (kind) {
        "v" -> DeepLinkRoute("verify", token)
        "r" -> DeepLinkRoute("reset", token)
        "i" -> DeepLinkRoute("invite", token)
        else -> null
    }
}

private fun decode(value: String): String = try {
    java.net.URLDecoder.decode(value, Charsets.UTF_8.name())
} catch (_: Exception) {
    value
}
