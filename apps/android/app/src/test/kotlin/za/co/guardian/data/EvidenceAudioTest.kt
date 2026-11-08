package za.co.guardian.data

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class EvidenceAudioTest {
    @Test
    fun capturesPlayableWavWithoutChangingPcmSamples() {
        val pcm = byteArrayOf(0, 1, 2, 3)
        val wav = EvidenceVault.pcm16MonoWav(pcm)
        assertEquals("RIFF", String(wav.copyOfRange(0, 4)))
        assertEquals("WAVE", String(wav.copyOfRange(8, 12)))
        val header = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals(wav.size - 8, header.getInt(4))
        assertEquals(16_000, header.getInt(24))
        assertEquals(pcm.size, header.getInt(40))
        assertArrayEquals(pcm, wav.copyOfRange(44, wav.size))
    }
}
