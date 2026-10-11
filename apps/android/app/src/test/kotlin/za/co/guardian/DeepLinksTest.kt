package za.co.guardian

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DeepLinksTest {
    @Test
    fun parsesAppSchemeVerifyResetInvite() {
        assertEquals("verify", parseGuardianDeepLinkString("guardian://verify?token=abc123tokenvalue")!!.destination)
        assertEquals("abc123tokenvalue", parseGuardianDeepLinkString("guardian://reset?token=abc123tokenvalue")!!.token)
        assertEquals("invite", parseGuardianDeepLinkString("guardian://invite?token=uuid-here-token-1")!!.destination)
    }

    @Test
    fun parsesHttpsLinkHostPaths() {
        val verify = parseGuardianDeepLinkString("https://links.guardian.app/v/tokenvalue1234567890")
        assertEquals("verify", verify!!.destination)
        assertEquals("tokenvalue1234567890", verify.token)
        assertEquals("reset", parseGuardianDeepLinkString("https://links.guardian.app/r/tokenvalue1234567890")!!.destination)
        assertEquals("invite", parseGuardianDeepLinkString("https://links.guardian.app/i/tokenvalue1234567890")!!.destination)
    }

    @Test
    fun rejectsUnknownHosts() {
        assertNull(parseGuardianDeepLinkString("https://evil.example/v/token"))
    }
}
