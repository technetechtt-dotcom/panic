package za.co.guardian

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class FirebaseConfigTest {
    @Test
    fun debugBuildsMayOmitGoogleServicesAndReleaseMustNotUseAPlaceholder() {
        val file = File("google-services.json")
        if (!file.exists()) {
            assertFalse(BuildConfig.FIREBASE_CONFIGURED)
            return
        }
        val text = file.readText()
        assertEquals(true, text.contains("\"mobilesdk_app_id\""))
        assertFalse(text.contains("YOUR_PROJECT"))
        assertFalse(text.contains("placeholder"))
    }
}
