package za.co.guardian.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import za.co.guardian.core.CheckStatus
import za.co.guardian.core.LocalIncident
import za.co.guardian.core.ProtectionHealth
import za.co.guardian.core.ProtectionLevel
import za.co.guardian.core.SyncState
import za.co.guardian.data.AndroidProtectionHealth
import za.co.guardian.data.AuthRepository
import za.co.guardian.data.PracticeModeReader
import za.co.guardian.data.ProtectionStatusSource
import za.co.guardian.data.GuardianDatabase
import za.co.guardian.data.SettingsStore
import za.co.guardian.data.SosActions
import za.co.guardian.data.SosOutcome
import za.co.guardian.data.userMessage
import javax.inject.Inject

private val GuardianColors = darkColorScheme(
    primary = Color(0xFFF4F7FB),
    background = Color(0xFF0E1116),
    surface = Color(0xFF171C24),
    error = Color(0xFFE23B3B),
    onBackground = Color(0xFFF4F7FB),
    onSurface = Color(0xFFF4F7FB),
)

@Composable
fun GuardianTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = GuardianColors, content = content)
}

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val actions: SosActions,
    private val healthSource: ProtectionStatusSource,
    private val practiceMode: PracticeModeReader,
    private val tokens: za.co.guardian.data.TokenStore? = null,
    private val api: za.co.guardian.data.GuardianApi? = null,
) : ViewModel() {
    private val healthState = MutableStateFlow(healthSource.current())
    val health: StateFlow<ProtectionHealth> = healthState
    private val messageState = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = messageState
    private val activeState = MutableStateFlow<LocalIncident?>(null)
    val active: StateFlow<LocalIncident?> = activeState
    private val practiceState = MutableStateFlow(practiceMode.enabled())
    val practice: StateFlow<Boolean> = practiceState
    var role by mutableStateOf(tokens?.userRole() ?: "USER")
        private set
    var assignments by mutableStateOf<List<Pair<String, String>>>(emptyList())
        private set
    var remainingMs by mutableStateOf(practiceMode.remainingMs())
        private set

    fun refresh() {
        healthState.value = healthSource.current()
        practiceState.value = practiceMode.enabled()
        remainingMs = practiceMode.remainingMs()
        role = tokens?.userRole() ?: "USER"
        if (role == "RESPONDER" && api != null) {
            viewModelScope.launch {
                assignments = try {
                    api.incidents().data.map { incident ->
                        incident.id to "${incident.userDisplayName.ifBlank { "Person" }} · ${incident.state}"
                    }
                } catch (_: Exception) {
                    emptyList()
                }
            }
        }
    }

    fun confirmPayment(pin: String, context: android.content.Context): String {
        val decoy = tokens?.freezeDecoyPin().orEmpty()
        val release = tokens?.freezeReleasePin().orEmpty()
        val armed = za.co.guardian.core.freezeIsArmed(decoy, release)
        if (armed && za.co.guardian.core.decoyPinFreezes(pin, decoy)) {
            context.startActivity(android.content.Intent(context, FreezeActivity::class.java))
            return "Payment could not be confirmed."
        }
        if (za.co.guardian.core.releasePinMatches(pin, release)) return "Nothing was transferred."
        return "That password was not accepted."
    }

    fun reportLocated(incidentId: String) = updateAssignment(incidentId, "USER_LOCATED", "Location report sent. This does not close the incident.")

    fun updateAssignment(incidentId: String, status: String, success: String) {
        val client = api ?: return
        viewModelScope.launch {
            try {
                client.responderStatus(incidentId, za.co.guardian.data.ResponderStatusBody(status))
                messageState.value = success
            } catch (_: Exception) {
                messageState.value = "The responder update was not sent."
            }
        }
    }

    fun openEmergencyDialer(context: android.content.Context) {
        val intent = android.content.Intent(
            android.content.Intent.ACTION_DIAL,
            android.net.Uri.parse("tel:${za.co.guardian.core.emergencyDialNumber()}"),
        )
        context.startActivity(intent)
    }

    fun sendSos() {
        viewModelScope.launch {
            messageState.value = null
            when (val outcome = actions.send()) {
                SosOutcome.NeedSignIn -> messageState.value = "Sign in before sending SOS."
                SosOutcome.NeedDevice -> messageState.value = "Connect once so this phone can be registered."
                is SosOutcome.Started -> {
                    activeState.value = outcome.incident
                    val prefix = if (outcome.incident.isTest) "Test SOS. " else "SOS "
                    messageState.value = prefix + when {
                        outcome.incident.syncState == SyncState.PENDING -> "saved on this phone. It will send when connected."
                        outcome.tracking -> "sent. Location sharing is on."
                        outcome.trackingNote.isNotBlank() -> outcome.trackingNote
                        else -> "sent. Live tracking needs location permission."
                    }
                }
            }
        }
    }
}

@HiltViewModel
class AuthViewModel @Inject constructor(private val auth: AuthRepository) : ViewModel() {
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    fun register(email: String, password: String, name: String, onDone: () -> Unit, phone: String = "") = submit(onDone) {
        auth.register(email, password, name, phone)
    }

    fun login(email: String, password: String, onDone: () -> Unit) = submit(onDone) {
        auth.login(email, password)
    }

    fun forgot(email: String, onDone: (String) -> Unit) {
        viewModelScope.launch {
            busy = true
            error = null
            try {
                onDone(auth.forgotPassword(email))
            } catch (caught: Exception) {
                error = caught.userMessage()
            } finally {
                busy = false
            }
        }
    }

    fun reset(token: String, password: String, onDone: () -> Unit) = submit(onDone) {
        auth.resetPassword(token, password)
    }

    fun verify(token: String, onDone: () -> Unit) = submit(onDone) {
        auth.verifyEmail(token)
    }

    private fun submit(onDone: () -> Unit, block: suspend () -> Unit) {
        viewModelScope.launch {
            busy = true
            error = null
            try {
                block()
                onDone()
            } catch (error: Exception) {
                this@AuthViewModel.error = error.userMessage()
            } finally {
                busy = false
            }
        }
    }
}

@HiltViewModel
class HistoryViewModel @Inject constructor(
    private val database: GuardianDatabase,
    private val protection: za.co.guardian.data.ProtectionActions,
) : ViewModel() {
    private val itemsState = MutableStateFlow<List<HistoryRow>>(emptyList())
    val items: StateFlow<List<HistoryRow>> = itemsState
    var journeys by mutableStateOf<List<za.co.guardian.data.JourneyWire>>(emptyList())
        private set

    fun refresh() {
        viewModelScope.launch {
            itemsState.value = database.incidents().list().map { incident ->
                HistoryRow(
                    id = incident.triggerId,
                    title = if (incident.isTest) "TEST · ${incident.triggerType}" else incident.triggerType,
                    detail = "${incident.state} · ${incident.syncState}",
                    whenLabel = java.text.DateFormat.getDateTimeInstance().format(java.util.Date(incident.createdAtEpochMs)),
                    isTest = incident.isTest,
                )
            }
            runCatching { journeys = protection.listJourneys() }
        }
    }
}

data class HistoryRow(
    val id: String,
    val title: String,
    val detail: String,
    val whenLabel: String,
    val isTest: Boolean,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val settings: SettingsStore,
    private val tokens: za.co.guardian.data.TokenStore,
    private val protection: za.co.guardian.data.ProtectionActions,
    private val vault: za.co.guardian.data.EvidenceVault,
    private val database: za.co.guardian.data.GuardianDatabase,
    private val signals: za.co.guardian.data.PhoneSignals,
    private val api: za.co.guardian.data.GuardianApi,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
) : ViewModel() {
    var testRemaining by mutableStateOf(settings.remainingMs())
        private set
    var status by mutableStateOf<String?>(null)
        private set
    var shareAudio by mutableStateOf(settings.shareAudio())
        private set
    var guardians by mutableStateOf<List<za.co.guardian.data.GuardianWire>>(emptyList())
        private set
    var devices by mutableStateOf<List<za.co.guardian.data.DeviceListItem>>(emptyList())
        private set
    var incidentActive by mutableStateOf(settings.incidentActive())
        private set
    var profile by mutableStateOf<za.co.guardian.data.ProfileWire?>(null)
        private set
    var journeys by mutableStateOf<List<za.co.guardian.data.JourneyWire>>(emptyList())
        private set
    var phrase by mutableStateOf(settings.safeWord())
        private set
    var sampleCount by mutableStateOf(settings.safeWordTemplateCount())
        private set
    var listening by mutableStateOf(settings.safeWordEnabled())
        private set
    var sensitivity by mutableStateOf(settings.safeWordSensitivity())
        private set
    var volumePattern by mutableStateOf(settings.volumePattern().name)
        private set
    var volumeWindow by mutableStateOf(settings.volumeWindowMs())
        private set
    var volumeVibrate by mutableStateOf(settings.vibrateOnTrigger())
        private set
    var volumeConnected by mutableStateOf(settings.volumeConnected())
        private set
    var protectionMode by mutableStateOf(settings.protectionMode())
        private set
    var battery by mutableStateOf<Int?>(null)
        private set
    var network by mutableStateOf("UNKNOWN")
        private set
    var lastLocation by mutableStateOf("No confirmed location yet")
        private set
    var liveState by mutableStateOf("LOCAL")
        private set
    var liveHeartbeat by mutableStateOf("none")
        private set
    var liveContact by mutableStateOf("unknown")
        private set
    var liveClaim by mutableStateOf("Unclaimed")
        private set

    fun refresh() {
        testRemaining = settings.remainingMs()
        shareAudio = settings.shareAudio()
        incidentActive = settings.incidentActive()
        phrase = settings.safeWord()
        sampleCount = settings.safeWordTemplateCount()
        listening = settings.safeWordEnabled()
        sensitivity = settings.safeWordSensitivity()
        volumePattern = settings.volumePattern().name
        volumeWindow = settings.volumeWindowMs()
        volumeVibrate = settings.vibrateOnTrigger()
        volumeConnected = settings.volumeConnected()
        protectionMode = settings.protectionMode()
        val device = signals.deviceState()
        battery = device.batteryLevel
        network = device.networkType
        val (fresh, lastKnown) = signals.freshAndLastKnown()
        val point = fresh ?: lastKnown
        lastLocation = if (point == null) "No confirmed location yet" else "${"%.5f".format(point.latitude)}, ${"%.5f".format(point.longitude)}"
        viewModelScope.launch {
            runCatching { guardians = protection.listGuardians() }
            runCatching { devices = protection.listDevices() }
            runCatching { profile = protection.loadProfile() }
            runCatching { journeys = protection.listJourneys() }
            val open = database.incidents().list().firstOrNull { it.serverId != null && it.state != "RESOLVED" && it.state != "ARCHIVED" }
            val serverId = open?.serverId
            if (serverId != null) {
                runCatching {
                    val live = api.incident(serverId).data
                    liveState = live.state
                    liveContact = live.contactStatus.ifBlank { "unknown" }
                    liveHeartbeat = live.lastHeartbeatAt ?: "none"
                    liveClaim = if (live.claimedBy.isNullOrBlank()) "Unclaimed" else "Operator claimed"
                    if (live.lastLatitude != null && live.lastLongitude != null) {
                        lastLocation = "${"%.5f".format(live.lastLatitude)}, ${"%.5f".format(live.lastLongitude)}"
                    }
                    if (live.lastBattery != null) battery = live.lastBattery.toInt()
                }
            }
        }
    }

    fun updateSensitivity(value: Int) {
        settings.setSafeWordSensitivity(value)
        sensitivity = value
    }

    fun disableListening() {
        settings.safeWordEnabled(false)
        listening = false
        context.stopService(android.content.Intent(context, za.co.guardian.service.SafeWordService::class.java))
        status = "Safe-word listening is off."
    }

    fun clearSamples() {
        settings.clearSafeWordTemplates()
        sampleCount = 0
        settings.safeWordEnabled(false)
        listening = false
        status = "Recorded samples were deleted. Record the current phrase again before listening."
    }

    fun setMode(mode: String) {
        settings.setProtectionMode(mode)
        protectionMode = mode
        status = "Mode is $mode."
    }

    fun note(message: String) {
        status = message
    }

    fun startTest() {
        settings.startTestSession()
        testRemaining = settings.remainingMs()
        status = "Test session ends in 10 minutes. SOS during it is marked as a test."
    }

    fun startVolumeTest() {
        settings.startVolumeTest()
        val pattern = settings.volumePattern()
        status = "Press ${if (pattern.key == za.co.guardian.core.VolumeKey.DOWN) "volume down" else "volume up"} ${pattern.presses} times in the next 30 seconds. Guardian will not send SOS."
    }

    fun cycleVolumePattern() {
        val order = za.co.guardian.core.VolumePattern.entries
        val next = order[(order.indexOf(settings.volumePattern()) + 1) % order.size]
        settings.setVolumePattern(next)
        volumePattern = next.name
        status = "Volume trigger is now ${next.presses}× ${next.key.name.lowercase()}."
    }

    fun cycleFreezePattern() {
        val order = za.co.guardian.core.VolumePattern.entries.filter { it.key != settings.volumePattern().key }
        if (order.isEmpty()) {
            status = "Choose an SOS volume pattern first. The freeze pattern has to use the other volume key."
            return
        }
        val next = order[(order.indexOf(settings.freezePattern()) + 1).mod(order.size)]
        settings.setFreezePattern(next)
        status = "Freeze pattern is ${next.presses}× ${next.key.name.lowercase()}. It does not send SOS."
    }

    fun saveFreezePins(decoy: String, release: String) {
        if (!za.co.guardian.core.freezeIsArmed(decoy, release)) {
            status = "Use two different 4 to 8 digit PINs. The decoy freezes the screen. The other PIN leaves the freeze."
            return
        }
        tokens.setFreezeDecoyPin(decoy)
        tokens.setFreezeReleasePin(release)
        status = "Freeze PINs stay on this phone. A reboot leaves the freeze. Android can still open the power menu. Screen pinning is requested, and the system asks before it pins."
    }

    fun toggleVolumeVibration() {
        val enabled = !settings.vibrateOnTrigger()
        settings.setVibrateOnTrigger(enabled)
        volumeVibrate = enabled
        status = if (enabled) "The phone vibrates when the volume pattern matches." else "Volume confirmation is silent."
    }

    fun cycleVolumeWindow() {
        val windows = listOf(1_000L, 1_500L, 2_000L, 3_000L)
        val index = windows.indexOf(settings.volumeWindowMs()).let { if (it < 0) 1 else it }
        val next = windows[(index + 1) % windows.size]
        settings.setVolumeWindowMs(next)
        volumeWindow = next
        status = "Volume presses must fit inside ${next / 1000.0} seconds."
    }

    fun updateShareAudio(enabled: Boolean) {
        val granted = androidx.core.content.ContextCompat.checkSelfPermission(
            context,
            android.Manifest.permission.RECORD_AUDIO,
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        if (enabled && !granted) {
            settings.setShareAudio(false)
            shareAudio = false
            status = "Microphone permission was not granted, so audio sharing stays off."
            return
        }
        settings.setShareAudio(enabled)
        shareAudio = enabled
    }

    fun saveSafeWord(phrase: String) {
        val previous = settings.safeWord()
        settings.setSafeWord(phrase)
        this.phrase = settings.safeWord()
        sampleCount = settings.safeWordTemplateCount()
        listening = settings.safeWordEnabled()
        val cleared = previous.isNotBlank() && !previous.equals(phrase.trim(), ignoreCase = true)
        status = za.co.guardian.core.phraseQualityWarning(phrase) + " The phrase stays on this phone." +
            if (cleared) " Previous recordings were deleted because the phrase changed." else ""
    }

    fun recordSafeWordSample() {
        viewModelScope.launch(kotlinx.coroutines.Dispatchers.IO) {
            val granted = androidx.core.content.ContextCompat.checkSelfPermission(
                context,
                android.Manifest.permission.RECORD_AUDIO,
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            if (!granted) {
                status = "Allow the microphone before recording a sample."
                return@launch
            }
            val samples = recordPhraseSample()
            if (samples == null) {
                status = "The microphone did not start."
                return@launch
            }
            settings.addSafeWordTemplate(za.co.guardian.core.pcmFeatures(samples))
            status = "${settings.safeWordTemplateCount()} samples saved. ${za.co.guardian.core.phraseQualityWarning(settings.safeWord())}"
        }
    }

    fun prepareSafeWord(): Boolean {
        if (settings.safeWord().trim().length < 4 || settings.safeWordTemplateCount() < 3) {
            status = "Save a phrase and record it 3 times before listening starts."
            return false
        }
        settings.safeWordEnabled(true)
        status = "Safe word protection is on. Listening is on-device and the microphone indicator stays visible."
        return true
    }

    private fun recordPhraseSample(): ShortArray? {
        val rate = 16_000
        val min = android.media.AudioRecord.getMinBufferSize(rate, android.media.AudioFormat.CHANNEL_IN_MONO, android.media.AudioFormat.ENCODING_PCM_16BIT)
        if (min <= 0) return null
        val recorder = android.media.AudioRecord(
            android.media.MediaRecorder.AudioSource.MIC,
            rate,
            android.media.AudioFormat.CHANNEL_IN_MONO,
            android.media.AudioFormat.ENCODING_PCM_16BIT,
            min.coerceAtLeast(rate * 2),
        )
        if (recorder.state != android.media.AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            return null
        }
        val samples = ShortArray(rate * 2)
        recorder.startRecording()
        var filled = 0
        while (filled < samples.size) {
            val read = recorder.read(samples, filled, samples.size - filled)
            if (read <= 0) break
            filled += read
        }
        recorder.stop()
        recorder.release()
        return if (filled > rate / 2) samples.copyOf(filled) else null
    }

    fun checkConnection() = run { "Backend ${auth.checkConnection()}" }
    fun addGuardian(name: String, phone: String, email: String = "") = run { protection.addGuardian(name, phone, email) }
    fun acceptInvitation(token: String) = run { protection.acceptInvitation(token) }
    fun removeGuardian(id: String) = run { protection.removeGuardian(id) }
    fun revokeDevice(id: String) = run { protection.revokeDevice(id) }
    fun extendJourney(minutes: String) = run { protection.extendJourney(minutes.toIntOrNull() ?: 15) }
    fun completeJourney() = run { protection.completeJourney() }
    fun checkIn() = run { protection.checkIn() }
    fun exportAccount() = run { protection.exportAccount() }
    fun eraseAccount(password: String) = run { protection.eraseAccount(password) }
    fun startJourney(label: String, minutes: String) = run { protection.startJourney(label, minutes.toIntOrNull() ?: 30, settings.protectionMode()) }
    fun cycleProtectionMode() {
        val modes = listOf("WALK", "RIDE", "DRIVE", "MEETING", "HIGH_RISK")
        val next = modes[(modes.indexOf(settings.protectionMode()).coerceAtLeast(0) + 1) % modes.size]
        settings.setProtectionMode(next)
        status = "Mode is $next. Ride and drive use a wider corridor. Meeting and high-risk check in sooner."
    }
    fun toggleFallWatch() {
        val enabled = !settings.fallWatch()
        settings.setFallWatch(enabled)
        val intent = android.content.Intent(context, za.co.guardian.service.FallWatchService::class.java)
        if (enabled) {
            androidx.core.content.ContextCompat.startForegroundService(context, intent)
            status = "Impact detection is on. Android shows a Guardian notification. A possible fall waits 20 seconds."
        } else {
            context.stopService(intent)
            status = "Impact detection is off."
        }
    }
    fun saveCapture(type: String, bytes: ByteArray) = run {
        val incident = database.incidents().list().firstOrNull { it.state != "RESOLVED" && it.state != "ARCHIVED" }
            ?: return@run "Send SOS before saving a photo or video. The camera is not used in the background."
        val battery = signals.deviceState().batteryLevel ?: 100
        if (!za.co.guardian.core.captureEvidence(type, battery)) {
            return@run "Battery is too low for $type. Short audio can still be kept."
        }
        if (bytes.size > 1_500_000) return@run "That file is larger than 1.5 MB. Use a shorter clip."
        vault.store(incident.triggerId, type, bytes)
        "Saved on this phone. It uploads with the open emergency."
    }
    fun saveProfile(blood: String, allergies: String, medications: String, notes: String) = run {
        protection.saveProfile(blood, allergies, medications, notes)
    }
    fun savePins(cancelPin: String, duressPin: String) = run { protection.setPins(cancelPin, duressPin) }
    fun cancel(pin: String) = run { protection.cancel(pin) }

    fun finishOnboarding(onDone: () -> Unit) {
        settings.setOnboarded(true)
        onDone()
    }

    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch {
            auth.logout()
            onDone()
        }
    }

    private fun run(block: suspend () -> String) {
        viewModelScope.launch {
            status = try {
                block()
            } catch (error: Exception) {
                error.userMessage()
            }
        }
    }
}

@Composable
fun WelcomeScreen(
    onRegister: () -> Unit,
    onLogin: () -> Unit,
    onPrivacy: () -> Unit = {},
    onTerms: () -> Unit = {},
    onHelp: () -> Unit = {},
    onSafety: () -> Unit = {},
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("GUARDIAN", fontSize = 14.sp, color = Color(0xFFF5C451), fontWeight = FontWeight.Bold)
        Text("Personal safety", fontSize = 36.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        Text("Guardian sends an SOS you start yourself. It does not replace calling official emergency services.")
        Spacer(Modifier.height(24.dp))
        Button(onClick = onRegister, modifier = Modifier.fillMaxWidth().height(56.dp)) { Text("Create account") }
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onLogin, modifier = Modifier.fillMaxWidth()) { Text("I already have an account") }
        TextButton(onClick = onPrivacy, modifier = Modifier.fillMaxWidth()) { Text("Privacy Policy") }
        TextButton(onClick = onTerms, modifier = Modifier.fillMaxWidth()) { Text("Terms of Use") }
        TextButton(onClick = onHelp, modifier = Modifier.fillMaxWidth()) { Text("How Guardian Works") }
        TextButton(onClick = onSafety, modifier = Modifier.fillMaxWidth()) { Text("Safety Disclaimer") }
        TextButton(onClick = onHelp, modifier = Modifier.fillMaxWidth()) { Text("Help & Contact") }
        Text("Accessibility: large system fonts scroll on this page. TalkBack labels use the button names above.", color = Color(0xFFB7C0CC), modifier = Modifier.padding(top = 8.dp))
    }
}

@Composable
fun RegisterScreen(
    onDone: () -> Unit,
    onBack: () -> Unit,
    onTerms: () -> Unit = {},
    onPrivacy: () -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel(),
) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var consent by remember { mutableStateOf(false) }
    var terms by remember { mutableStateOf(false) }
    var privacy by remember { mutableStateOf(false) }
    val ready = consent && terms && privacy && password.length >= 12 && password == confirm
    AuthForm(
        title = "Create account",
        error = viewModel.error,
        busy = viewModel.busy,
        onBack = onBack,
        onSubmit = {
            if (!ready) return@AuthForm
            viewModel.register(email, password, name, onDone, phone)
        },
    ) {
        OutlinedTextField(name, { name = it }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(phone, { phone = it }, label = { Text("Mobile number") }, modifier = Modifier.fillMaxWidth())
        PasswordField(password, { password = it }, "Password")
        PasswordField(confirm, { confirm = it }, "Confirm password")
        Text("Password must be at least 12 characters. The server rejects shorter passwords.", color = Color(0xFFB7C0CC))
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Switch(checked = consent, onCheckedChange = { consent = it })
            Text("I understand SOS will share my location with the monitoring hub.", modifier = Modifier.padding(start = 8.dp))
        }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Switch(checked = terms, onCheckedChange = { terms = it })
            TextButton(onClick = onTerms) { Text("I accept the Terms of Use") }
        }
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Switch(checked = privacy, onCheckedChange = { privacy = it })
            TextButton(onClick = onPrivacy) { Text("I accept the Privacy Policy") }
        }
    }
}

@Composable
fun LoginScreen(
    onDone: () -> Unit,
    onBack: () -> Unit,
    onForgot: () -> Unit = {},
    onReset: () -> Unit = {},
    onVerify: () -> Unit = {},
    viewModel: AuthViewModel = hiltViewModel(),
) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    AuthForm(
        title = "Sign in",
        error = viewModel.error,
        busy = viewModel.busy,
        onBack = onBack,
        onSubmit = { viewModel.login(email, password, onDone) },
    ) {
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
        PasswordField(password, { password = it }, "Password")
        TextButton(onClick = onForgot) { Text("Forgot password?") }
        TextButton(onClick = onReset) { Text("I have a reset token") }
        TextButton(onClick = onVerify) { Text("Verify email") }
        Text("A lost phone is revoked from Profile → Devices after you sign in on a replacement.", color = Color(0xFFB7C0CC))
    }
}

@Composable
private fun AuthForm(
    title: String,
    error: String?,
    busy: Boolean,
    onBack: () -> Unit,
    onSubmit: () -> Unit,
    fields: @Composable () -> Unit,
) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text(title, fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(16.dp))
        fields()
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 12.dp))
        Spacer(Modifier.height(16.dp))
        Button(onClick = onSubmit, enabled = !busy, modifier = Modifier.fillMaxWidth().height(56.dp)) {
            Text(if (busy) "Please wait" else "Continue")
        }
    }
}

@Composable
fun HomeScreen(
    onHistory: () -> Unit,
    onSettings: () -> Unit,
    onProtect: () -> Unit = onSettings,
    onGuardians: () -> Unit = onSettings,
    onProfile: () -> Unit = onSettings,
    onActiveIncident: () -> Unit = onSettings,
    onAllowLocation: () -> Unit,
    onAllowNotifications: () -> Unit,
    onFixVolume: () -> Unit = onProtect,
    onFixSafeWord: () -> Unit = onProtect,
    onFixGuardian: () -> Unit = onGuardians,
    onFixDevice: () -> Unit = onProfile,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val health by viewModel.health.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val activeIncident by viewModel.active.collectAsStateWithLifecycle()
    val practice by viewModel.practice.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    androidx.compose.runtime.LaunchedEffect(practice) {
        while (practice) {
            kotlinx.coroutines.delay(1_000)
            viewModel.refresh()
        }
    }
    Scaffold(bottomBar = { BottomNav(onHome = {}, onProtect = onProtect, onGuardians = onGuardians, onActivity = onHistory, onProfile = onProfile, selected = "home") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            if (practice) {
                Surface(color = Color(0xFFF5C451), modifier = Modifier.fillMaxWidth()) {
                    val minutes = viewModel.remainingMs / 60_000
                    val seconds = (viewModel.remainingMs % 60_000) / 1_000
                    Column(Modifier.padding(12.dp)) {
                        Text("TEST MODE", color = Color(0xFF111111), fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text("%02d:%02d remaining".format(minutes, seconds), color = Color(0xFF111111))
                    }
                }
            }
            Text(health.level.name.replace('_', ' '), fontSize = 34.sp, fontWeight = FontWeight.Bold)
            Text(if (health.level == ProtectionLevel.PROTECTED) "Guardian is ready." else "Manual SOS is available. Some protection is not ready.")
            if (viewModel.role == "RESPONDER") {
                Text("Assigned incidents", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                if (viewModel.assignments.isEmpty()) Text("No assigned incidents are on this phone yet.")
                viewModel.assignments.forEach { (id, label) ->
                    Text(label, modifier = Modifier.padding(top = 8.dp))
                    Button(onClick = { viewModel.updateAssignment(id, "ACCEPTED", "Assignment accepted.") }, modifier = Modifier.fillMaxWidth()) { Text("Accept assignment") }
                    Button(onClick = { viewModel.updateAssignment(id, "EN_ROUTE", "Marked en route.") }, modifier = Modifier.fillMaxWidth()) { Text("En route") }
                    Button(onClick = { viewModel.updateAssignment(id, "ON_SCENE", "Marked on scene.") }, modifier = Modifier.fillMaxWidth()) { Text("On scene") }
                    Button(onClick = { viewModel.reportLocated(id) }, modifier = Modifier.fillMaxWidth()) { Text("Report person located") }
                    Button(onClick = { viewModel.updateAssignment(id, "COMPLETED", "Assignment completed.") }, modifier = Modifier.fillMaxWidth()) { Text("Complete assignment") }
                    Button(onClick = { viewModel.updateAssignment(id, "DECLINED", "Assignment declined.") }, modifier = Modifier.fillMaxWidth()) { Text("Decline assignment") }
                }
            }
            Spacer(Modifier.height(16.dp))
            health.checks.forEach { check ->
                val mark = when (check.status) {
                    CheckStatus.PASS -> "Ready"
                    CheckStatus.FAIL -> "Fix >"
                    CheckStatus.UNAVAILABLE -> "Later"
                }
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        Text(check.label, fontWeight = FontWeight.SemiBold)
                        Text(check.detail, color = Color(0xFFB7C0CC))
                    }
                    if (check.status == CheckStatus.FAIL) {
                        TextButton(onClick = {
                            when (check.id) {
                                "location" -> onAllowLocation()
                                "notifications" -> onAllowNotifications()
                                "volume" -> onFixVolume()
                                "safeword" -> onFixSafeWord()
                                "guardian" -> onFixGuardian()
                                "device" -> onFixDevice()
                                "internet" -> context.startActivity(android.content.Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS))
                                else -> onProtect()
                            }
                        }) { Text(mark) }
                    } else {
                        Text(mark)
                    }
                }
            }
            if (activeIncident != null) {
                Text(
                    "Emergency is active on this phone. Open Active Incident for a photo, a short video, or a PIN cancellation. Android still shows its location and microphone icons.",
                    modifier = Modifier.padding(top = 12.dp),
                )
                Button(onClick = onActiveIncident, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text("Open active incident")
                }
            }
            message?.let { Text(it, modifier = Modifier.padding(top = 12.dp)) }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = viewModel::sendSos,
                modifier = Modifier.fillMaxWidth().height(120.dp).semantics { contentDescription = "Send emergency SOS now" },
            ) { Text("SOS", fontSize = 40.sp, fontWeight = FontWeight.Bold) }
            Button(onClick = { viewModel.openEmergencyDialer(context) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text("Open the phone dialer for 112")
            }
            Text("This opens the dialer. Guardian does not place the call.", modifier = Modifier.padding(vertical = 8.dp))
        }
    }
}

@Composable
fun HistoryScreen(
    onHome: () -> Unit,
    onSettings: () -> Unit,
    onProtect: () -> Unit = onSettings,
    onGuardians: () -> Unit = onSettings,
    onProfile: () -> Unit = onSettings,
    viewModel: HistoryViewModel = hiltViewModel(),
) {
    val rows by viewModel.items.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<HistoryRow?>(null) }
    var selectedJourney by remember { mutableStateOf<za.co.guardian.data.JourneyWire?>(null) }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Scaffold(bottomBar = { BottomNav(onHome = onHome, onProtect = onProtect, onGuardians = onGuardians, onActivity = {}, onProfile = onProfile, selected = "activity") }) { padding ->
        if (selected != null) {
            Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
                TextButton(onClick = { selected = null }) { Text("Back") }
                Text(if (selected!!.isTest) "Test history" else "Incident detail", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
                Text("When ${selected!!.whenLabel}")
                Text("Trigger ${selected!!.title}")
                Text("Status ${selected!!.detail}")
                Text("Local ID ${selected!!.id}")
                Text("Operator response and evidence are on the monitoring hub for a synced incident.")
            }
        } else if (selectedJourney != null) {
            Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
                TextButton(onClick = { selectedJourney = null }) { Text("Back") }
                Text("Journey history", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
                Text("Destination ${selectedJourney!!.destinationLabel.ifBlank { "saved journey" }}")
                Text("Status ${selectedJourney!!.status}")
                Text("Expected ${selectedJourney!!.expectedArrivalAt ?: "not set"}")
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(padding).padding(20.dp)) {
                item { Text("Activity", fontSize = 32.sp, fontWeight = FontWeight.SemiBold) }
                item { Text("Incident history", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp)) }
                val incidents = rows.filter { !it.isTest }
                if (incidents.isEmpty()) item { Text("No SOS events on this phone yet.", modifier = Modifier.padding(top = 8.dp)) }
                items(incidents, key = { it.id }) { row ->
                    TextButton(onClick = { selected = row }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(row.title, fontWeight = FontWeight.SemiBold)
                            Text("${row.whenLabel} · ${row.detail}")
                        }
                    }
                }
                item { Text("Journey history", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp)) }
                if (viewModel.journeys.isEmpty()) item { Text("No journeys on this account yet.", modifier = Modifier.padding(top = 8.dp)) }
                items(viewModel.journeys, key = { it.id }) { journey ->
                    TextButton(onClick = { selectedJourney = journey }, modifier = Modifier.fillMaxWidth()) {
                        Text("${journey.destinationLabel.ifBlank { "Journey" }} · ${journey.status}")
                    }
                }
                item { Text("Test history", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp)) }
                val tests = rows.filter { it.isTest }
                if (tests.isEmpty()) item { Text("No test incidents on this phone yet.", modifier = Modifier.padding(top = 8.dp)) }
                items(tests, key = { it.id }) { row ->
                    TextButton(onClick = { selected = row }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(row.title, fontWeight = FontWeight.SemiBold)
                            Text("${row.whenLabel} · ${row.detail}")
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(
    onHome: () -> Unit,
    onHistory: () -> Unit,
    onSignedOut: () -> Unit,
    onGuardians: () -> Unit = onHistory,
    onProfile: () -> Unit = onSignedOut,
    onVolume: () -> Unit = {},
    onSafeWord: () -> Unit = {},
    onJourney: () -> Unit = {},
    onDuress: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    var pendingMic by remember { mutableStateOf<String?>(null) }
    val audioPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (pendingMic == "share") viewModel.updateShareAudio(granted)
        pendingMic = null
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Scaffold(bottomBar = { BottomNav(onHome = onHome, onProtect = {}, onGuardians = onGuardians, onActivity = onHistory, onProfile = onProfile, selected = "protect") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            Text("Protect", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
            Text(
                if (viewModel.testRemaining > 0) "Test session: ${(viewModel.testRemaining / 60000) + 1} min left"
                else "No test session. A test expires on its own.",
                modifier = Modifier.padding(vertical = 8.dp),
            )
            Button(onClick = viewModel::startTest, modifier = Modifier.fillMaxWidth()) { Text("Start 10 minute test") }
            Spacer(Modifier.height(12.dp))
            Text("Mode ${viewModel.protectionMode.replace('_', ' ')}", fontWeight = FontWeight.SemiBold)
            ModeCards(viewModel.protectionMode, viewModel::setMode)
            Button(onClick = onVolume, modifier = Modifier.fillMaxWidth()) { Text("Volume SOS") }
            Button(onClick = onSafeWord, modifier = Modifier.fillMaxWidth()) { Text("Safe word") }
            Button(onClick = onJourney, modifier = Modifier.fillMaxWidth()) { Text("Active journey") }
            Button(onClick = onDuress, modifier = Modifier.fillMaxWidth()) { Text("Duress & coercion") }
            Button(onClick = viewModel::toggleFallWatch, modifier = Modifier.fillMaxWidth()) { Text("Toggle impact detection") }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Share short audio during an on-screen SOS")
                Switch(checked = viewModel.shareAudio, onCheckedChange = { enabled ->
                    if (enabled) {
                        pendingMic = "share"
                        audioPermission.launch(android.Manifest.permission.RECORD_AUDIO)
                    } else {
                        viewModel.updateShareAudio(false)
                    }
                })
            }
            viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
        }
    }
}

@Composable
fun GuardiansScreen(
    onHome: () -> Unit,
    onProtect: () -> Unit,
    onActivity: () -> Unit,
    onProfile: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    var guardian by remember { mutableStateOf("") }
    var guardianPhone by remember { mutableStateOf("") }
    var guardianEmail by remember { mutableStateOf("") }
    var inviteToken by remember { mutableStateOf("") }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Scaffold(bottomBar = { BottomNav(onHome = onHome, onProtect = onProtect, onGuardians = {}, onActivity = onActivity, onProfile = onProfile, selected = "guardians") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            Text("Guardians", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
            Text("Invite by email so they can accept on a Guardian account. Phone is used for SMS when the hub has Twilio.", modifier = Modifier.padding(vertical = 8.dp))
            OutlinedTextField(guardian, { guardian = it }, label = { Text("Guardian name") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(guardianPhone, { guardianPhone = it }, label = { Text("Phone") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(guardianEmail, { guardianEmail = it }, label = { Text("Email for invitation") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { viewModel.addGuardian(guardian, guardianPhone, guardianEmail) }, modifier = Modifier.fillMaxWidth()) { Text("Add guardian") }
            OutlinedTextField(inviteToken, { inviteToken = it }, label = { Text("Invitation token to accept") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            Button(onClick = { viewModel.acceptInvitation(inviteToken) }, modifier = Modifier.fillMaxWidth()) { Text("Accept invitation on this account") }
            viewModel.guardians.forEach { row ->
                Text("${row.displayName} · ${row.relationship} · priority ${row.priority} · ${row.invitationStatus}", modifier = Modifier.padding(top = 8.dp))
                if (!row.phone.isNullOrBlank()) Text(row.phone, color = Color(0xFFB7C0CC))
                if (row.lastAcknowledgedAt != null) Text("Last acknowledged ${row.lastAcknowledgedAt}")
                Button(onClick = { viewModel.removeGuardian(row.id) }, modifier = Modifier.fillMaxWidth()) { Text("Remove ${row.displayName}") }
            }
            if (viewModel.guardians.isEmpty()) Text("No guardians saved yet.", modifier = Modifier.padding(top = 12.dp))
            viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
        }
    }
}

@Composable
fun ProfileScreen(
    onHome: () -> Unit,
    onProtect: () -> Unit,
    onGuardians: () -> Unit,
    onActivity: () -> Unit,
    onSignedOut: () -> Unit,
    onEmergencyProfile: () -> Unit = {},
    onDevices: () -> Unit = {},
    onPrivacy: () -> Unit = {},
    onHelp: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Scaffold(bottomBar = { BottomNav(onHome = onHome, onProtect = onProtect, onGuardians = onGuardians, onActivity = onActivity, onProfile = {}, selected = "profile") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            Text("Profile", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
            Text("Blood type ${viewModel.profile?.bloodType ?: "not loaded"}", modifier = Modifier.padding(top = 12.dp))
            Button(onClick = onEmergencyProfile, modifier = Modifier.fillMaxWidth()) { Text("Emergency profile") }
            Button(onClick = onDevices, modifier = Modifier.fillMaxWidth()) { Text("My devices") }
            Button(onClick = onPrivacy, modifier = Modifier.fillMaxWidth()) { Text("Account & privacy") }
            Button(onClick = onHelp, modifier = Modifier.fillMaxWidth()) { Text("Help & support") }
            Button(onClick = viewModel::checkConnection, modifier = Modifier.fillMaxWidth()) { Text("Check connection") }
            viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
            Spacer(Modifier.height(20.dp))
            Button(onClick = { viewModel.signOut(onSignedOut) }, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
        }
    }
}

@Composable
fun ActiveIncidentScreen(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var cancelPin by remember { mutableStateOf("") }
    val photoCapture = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.TakePicturePreview(),
    ) { bitmap ->
        if (bitmap == null) return@rememberLauncherForActivityResult
        val stream = java.io.ByteArrayOutputStream()
        bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 70, stream)
        viewModel.saveCapture("photo", stream.toByteArray())
    }
    val videoCapture = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val uri = result.data?.data ?: return@rememberLauncherForActivityResult
        viewModel.saveCapture("video", context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: byteArrayOf())
    }
    val cameraPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) photoCapture.launch(null)
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            androidx.compose.runtime.LaunchedEffect(Unit) {
                while (true) {
                    viewModel.refresh()
                    kotlinx.coroutines.delay(4_000)
                }
            }
            Text(if (viewModel.incidentActive) "SOS ACTIVE" else "Active incident", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
            Text("State                    ${viewModel.liveState}")
            Text("SOS sent                 ✓")
            Text("Monitoring               ${viewModel.liveClaim}")
            Text("Contact                  ${viewModel.liveContact}")
            Text("Last heartbeat           ${viewModel.liveHeartbeat}")
            Text("Last location            ${viewModel.lastLocation}")
            Text("Battery                  ${viewModel.battery ?: "unknown"}%")
            Text("Network                  ${viewModel.network}")
            Text("Evidence                 Recording if you capture it")
            Text("This page refreshes from the server every 4 seconds while the incident is open.")
            Text("Photos and video are taken by you, with the camera app visible. They are not captured in the background.", modifier = Modifier.padding(vertical = 8.dp))
            Button(onClick = { cameraPermission.launch(android.Manifest.permission.CAMERA) }, modifier = Modifier.fillMaxWidth()) { Text("Take a photo") }
            Button(onClick = {
                val intent = android.content.Intent(android.provider.MediaStore.ACTION_VIDEO_CAPTURE)
                intent.putExtra(android.provider.MediaStore.EXTRA_DURATION_LIMIT, 8)
                intent.putExtra(android.provider.MediaStore.EXTRA_VIDEO_QUALITY, 0)
                videoCapture.launch(intent)
            }, modifier = Modifier.fillMaxWidth()) { Text("Record a short video") }
            PasswordField(cancelPin, { cancelPin = it }, "Cancel PIN", numeric = true)
            Button(onClick = { viewModel.cancel(cancelPin) }, modifier = Modifier.fillMaxWidth()) { Text("I'm safe / cancel with PIN") }
            Text("The cancel screen always says the emergency is cancelled. A duress PIN keeps monitoring open. Android still shows location and microphone icons.", modifier = Modifier.padding(vertical = 8.dp))
            viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
            Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back") }
        }
    }
}

@Composable
private fun BottomNav(
    onHome: () -> Unit,
    onProtect: () -> Unit,
    onGuardians: () -> Unit,
    onActivity: () -> Unit,
    onProfile: () -> Unit,
    selected: String,
) {
    NavigationBar {
        NavigationBarItem(selected = selected == "home", onClick = onHome, icon = { Icon(Icons.Filled.Home, contentDescription = "Home") }, label = { Text("Home") })
        NavigationBarItem(selected = selected == "protect", onClick = onProtect, icon = { Icon(Icons.Filled.Lock, contentDescription = "Protect") }, label = { Text("Protect") })
        NavigationBarItem(selected = selected == "guardians", onClick = onGuardians, icon = { Icon(Icons.Filled.Person, contentDescription = "Guardians") }, label = { Text("Guardians") })
        NavigationBarItem(selected = selected == "activity", onClick = onActivity, icon = { Icon(Icons.Filled.DateRange, contentDescription = "Activity") }, label = { Text("Activity") })
        NavigationBarItem(selected = selected == "profile", onClick = onProfile, icon = { Icon(Icons.Filled.Settings, contentDescription = "Profile") }, label = { Text("Profile") })
    }
}

@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    SetupOnboardingScreen(onDone)
}

@Composable
fun SurfacePreview() {
    Surface(color = Color(0xFF0E1116)) {}
}
