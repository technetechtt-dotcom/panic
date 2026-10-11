package za.co.guardian.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Formal campaign harness. Fixture WAV/PCM files under
 * `src/test/resources/safeword-campaign/` unlock the keep/replace gate in docs/SAFEWORD_CAMPAIGN.md.
 * Without fixtures this suite only proves the gate helpers, and MFCC remains the production matcher.
 */
class SafeWordCampaignTest {
    @Test
    fun campaignGateHelpersRejectSilenceAndAcceptConsistentTones() {
        val silence = pcmFeatures(ShortArray(16_000) { 0 })
        assertTrue(keywordTemplateQuality(silence).isNotBlank())
        val a = pcmFeatures(ShortArray(16_000) { index -> (kotlin.math.sin(index / 8.0) * 8000).toInt().toShort() })
        val b = pcmFeatures(ShortArray(16_000) { index -> (kotlin.math.sin(index / 8.0) * 8000).toInt().toShort() })
        val c = pcmFeatures(ShortArray(16_000) { index -> (kotlin.math.sin(index / 8.0) * 8000).toInt().toShort() })
        assertEquals("", keywordTemplateQuality(a))
        assertTrue(keywordEnrollmentValid(listOf(a, b, c), sensitivity = 5))
    }

    @Test
    fun campaignDirectoryIsOptionalUntilFieldRecordingsExist() {
        val root = java.io.File("src/test/resources/safeword-campaign")
        if (!root.exists()) {
            assertTrue(true, "No campaign fixtures yet; MFCC stays until docs/SAFEWORD_CAMPAIGN.md gate is measured.")
            return
        }
        val positives = root.resolve("positive").listFiles()?.filter { it.extension == "pcm" }.orEmpty()
        val negatives = root.resolve("negative").listFiles()?.filter { it.extension == "pcm" }.orEmpty()
        if (positives.isEmpty() || negatives.isEmpty()) {
            assertTrue(true, "Campaign folders are present but empty; keep MFCC.")
            return
        }
        val templates = positives.take(3).map { pcmFeatures(readPcm16(it)) }
        assertTrue(keywordEnrollmentValid(templates, sensitivity = 5))
        var hits = 0
        for (file in positives.drop(3)) {
            val score = keywordConfidenceScore(pcmFeatures(readPcm16(file)), templates)
            if (score >= 0.72f) hits += 1
        }
        var falseHits = 0
        for (file in negatives) {
            val score = keywordConfidenceScore(pcmFeatures(readPcm16(file)), templates)
            if (score >= 0.72f) falseHits += 1
        }
        val acceptRate = if (positives.size <= 3) 1.0 else hits.toDouble() / (positives.size - 3)
        val falseRate = falseHits.toDouble() / negatives.size
        assertTrue(acceptRate >= 0.85, "Positive accept $acceptRate below campaign gate")
        assertTrue(falseRate <= 0.02, "False accept $falseRate above campaign gate")
    }

    private fun readPcm16(file: java.io.File): ShortArray {
        val bytes = file.readBytes()
        val samples = ShortArray(bytes.size / 2)
        var i = 0
        while (i + 1 < bytes.size) {
            samples[i / 2] = ((bytes[i + 1].toInt() shl 8) or (bytes[i].toInt() and 0xff)).toShort()
            i += 2
        }
        return samples
    }
}
