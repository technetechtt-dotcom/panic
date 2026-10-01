package za.co.guardian.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.NotificationCompat
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import za.co.guardian.R
import za.co.guardian.core.TriggerType
import za.co.guardian.core.safeWordMatches
import za.co.guardian.data.SettingsStore
import za.co.guardian.data.SosActions
import javax.inject.Inject

@AndroidEntryPoint
class SafeWordService : android.app.Service() {
    @Inject lateinit var actions: SosActions
    @Inject lateinit var settings: SettingsStore

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var recognizer: SpeechRecognizer? = null
    private var matched = false

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val phrase = settings.safeWord()
        if (phrase.length < 4 || !SpeechRecognizer.isRecognitionAvailable(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val notification = listeningNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        listen(phrase)
        return START_STICKY
    }

    override fun onDestroy() {
        recognizer?.destroy()
        scope.cancel()
        super.onDestroy()
    }

    private fun listen(phrase: String) {
        if (matched) return
        val speech = recognizer ?: SpeechRecognizer.createSpeechRecognizer(this).also { recognizer = it }
        speech.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) = Unit
            override fun onBeginningOfSpeech() = Unit
            override fun onRmsChanged(rmsdB: Float) = Unit
            override fun onBufferReceived(buffer: ByteArray?) = Unit
            override fun onEndOfSpeech() = Unit
            override fun onPartialResults(partialResults: Bundle?) {
                consider(partialResults, restart = false, phrase = phrase)
            }
            override fun onEvent(eventType: Int, params: Bundle?) = Unit
            override fun onError(error: Int) {
                if (!matched && (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                    listen(phrase)
                } else if (!matched) {
                    stopSelf()
                }
            }

            override fun onResults(results: Bundle?) {
                consider(results, restart = true, phrase = phrase)
            }
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        speech.startListening(intent)
    }

    private fun consider(results: Bundle?, restart: Boolean, phrase: String) {
        val lines = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
        if (lines.any { safeWordMatches(it, phrase) }) {
            matched = true
            scope.launch(Dispatchers.IO) { actions.send(TriggerType.VOICE_SAFE_WORD) }
            stopSelf()
            return
        }
        if (restart && !matched) listen(phrase)
    }

    private fun listeningNotification(): Notification {
        val channelId = "guardian.safeword"
        val manager = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(NotificationChannel(channelId, getString(R.string.safeword_channel), NotificationManager.IMPORTANCE_LOW))
        }
        return NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Safe word listening")
            .setContentText(getString(R.string.safeword_text))
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val NOTIFICATION_ID = 1003
    }
}
