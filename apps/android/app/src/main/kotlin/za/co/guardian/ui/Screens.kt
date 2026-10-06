package za.co.guardian.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
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

    fun refresh() {
        healthState.value = healthSource.current()
        practiceState.value = practiceMode.enabled()
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

    fun reportLocated(incidentId: String) {
        val client = api ?: return
        viewModelScope.launch {
            try {
                client.responderStatus(incidentId, za.co.guardian.data.ResponderStatusBody("USER_LOCATED"))
                messageState.value = "Location report sent. This does not close the incident."
            } catch (_: Exception) {
                messageState.value = "The location report was not sent."
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

    fun register(email: String, password: String, name: String, onDone: () -> Unit) = submit(onDone) {
        auth.register(email, password, name)
    }

    fun login(email: String, password: String, onDone: () -> Unit) = submit(onDone) {
        auth.login(email, password)
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
class HistoryViewModel @Inject constructor(private val database: GuardianDatabase) : ViewModel() {
    private val itemsState = MutableStateFlow<List<String>>(emptyList())
    val items: StateFlow<List<String>> = itemsState

    fun refresh() {
        viewModelScope.launch {
            itemsState.value = database.incidents().list().map { incident ->
                val test = if (incident.isTest) "TEST · " else ""
                "$test${incident.state} · ${incident.syncState}"
            }
        }
    }
}

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val settings: SettingsStore,
    private val tokens: za.co.guardian.data.TokenStore,
    private val protection: za.co.guardian.data.ProtectionActions,
    private val vault: za.co.guardian.data.EvidenceVault,
    private val database: za.co.guardian.data.GuardianDatabase,
    private val signals: za.co.guardian.data.PhoneSignals,
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
) : ViewModel() {
    var testRemaining by mutableStateOf(settings.remainingMs())
        private set
    var status by mutableStateOf<String?>(null)
        private set
    var shareAudio by mutableStateOf(settings.shareAudio())
        private set

    fun refresh() {
        testRemaining = settings.remainingMs()
        shareAudio = settings.shareAudio()
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
        status = if (enabled) "The phone vibrates when the volume pattern matches." else "Volume confirmation is silent."
    }

    fun cycleVolumeWindow() {
        val windows = listOf(1_000L, 1_500L, 2_000L, 3_000L)
        val index = windows.indexOf(settings.volumeWindowMs()).let { if (it < 0) 1 else it }
        val next = windows[(index + 1) % windows.size]
        settings.setVolumeWindowMs(next)
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
        settings.setSafeWord(phrase)
        status = za.co.guardian.core.phraseQualityWarning(phrase) + " The phrase stays on this phone."
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
    fun addGuardian(name: String, phone: String) = run { protection.addGuardian(name, phone) }
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
fun WelcomeScreen(onRegister: () -> Unit, onLogin: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("GUARDIAN", fontSize = 14.sp, color = Color(0xFFF5C451), fontWeight = FontWeight.Bold)
        Text("Personal safety", fontSize = 36.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        Text("Guardian sends an SOS you start yourself. It does not replace calling official emergency services.")
        Spacer(Modifier.height(24.dp))
        Button(onClick = onRegister, modifier = Modifier.fillMaxWidth().height(56.dp)) { Text("Create account") }
        Spacer(Modifier.height(12.dp))
        TextButton(onClick = onLogin, modifier = Modifier.fillMaxWidth()) { Text("I already have an account") }
    }
}

@Composable
fun RegisterScreen(onDone: () -> Unit, onBack: () -> Unit, viewModel: AuthViewModel = hiltViewModel()) {
    var name by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var consent by remember { mutableStateOf(false) }
    AuthForm(
        title = "Create account",
        error = viewModel.error,
        busy = viewModel.busy,
        onBack = onBack,
        onSubmit = {
            if (!consent) return@AuthForm
            viewModel.register(email, password, name, onDone)
        },
    ) {
        OutlinedTextField(name, { name = it }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Switch(checked = consent, onCheckedChange = { consent = it })
            Text("I understand SOS will share my location with the monitoring hub.", modifier = Modifier.padding(start = 8.dp))
        }
    }
}

@Composable
fun LoginScreen(onDone: () -> Unit, onBack: () -> Unit, viewModel: AuthViewModel = hiltViewModel()) {
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
        OutlinedTextField(password, { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth())
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
    onAllowLocation: () -> Unit,
    onAllowNotifications: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val health by viewModel.health.collectAsStateWithLifecycle()
    val message by viewModel.message.collectAsStateWithLifecycle()
    val activeIncident by viewModel.active.collectAsStateWithLifecycle()
    val practice by viewModel.practice.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    var paymentPin by remember { mutableStateOf("") }
    var paymentNote by remember { mutableStateOf<String?>(null) }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Scaffold(bottomBar = { BottomNav(onHome = {}, onHistory = onHistory, onSettings = onSettings, selected = "home") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            if (practice) Text("TEST MODE", color = Color(0xFF111111), modifier = Modifier.fillMaxWidth().padding(8.dp))
            Text(health.level.name.replace('_', ' '), fontSize = 34.sp, fontWeight = FontWeight.Bold)
            Text(if (health.level == ProtectionLevel.PROTECTED) "Guardian is ready." else "Manual SOS is available. Some protection is not ready.")
            if (viewModel.role == "RESPONDER") {
                Text("Assigned incidents", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                if (viewModel.assignments.isEmpty()) Text("No assigned incidents are on this phone yet.")
                viewModel.assignments.forEach { (id, label) ->
                    Text(label, modifier = Modifier.padding(top = 8.dp))
                    Button(onClick = { viewModel.reportLocated(id) }, modifier = Modifier.fillMaxWidth()) { Text("Report person located") }
                }
            }
            Spacer(Modifier.height(16.dp))
            health.checks.forEach { check ->
                val mark = when (check.status) {
                    CheckStatus.PASS -> "Ready"
                    CheckStatus.FAIL -> "Fix"
                    CheckStatus.UNAVAILABLE -> "Later"
                }
                Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    Column(Modifier.weight(1f)) {
                        Text(check.label, fontWeight = FontWeight.SemiBold)
                        Text(check.detail, color = Color(0xFFB7C0CC))
                    }
                    if (check.status == CheckStatus.FAIL && (check.id == "location" || check.id == "notifications")) {
                        TextButton(onClick = { if (check.id == "location") onAllowLocation() else onAllowNotifications() }) { Text(mark) }
                    } else {
                        Text(mark)
                    }
                }
            }
            if (activeIncident != null) {
                Text(
                    "Emergency is active on this phone. Settings can add a photo, a short video, or a PIN cancellation. Android still shows its location and microphone icons.",
                    modifier = Modifier.padding(top = 12.dp),
                )
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
            OutlinedTextField(paymentPin, { paymentPin = it }, label = { Text("Payment password") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = {
                paymentNote = viewModel.confirmPayment(paymentPin, context)
                paymentPin = ""
            }, modifier = Modifier.fillMaxWidth()) { Text("Confirm payment") }
            paymentNote?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
        }
    }
}

@Composable
fun HistoryScreen(onHome: () -> Unit, onSettings: () -> Unit, viewModel: HistoryViewModel = hiltViewModel()) {
    val items by viewModel.items.collectAsStateWithLifecycle()
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Scaffold(bottomBar = { BottomNav(onHome = onHome, onHistory = {}, onSettings = onSettings, selected = "history") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp)) {
            Text("History", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
            if (items.isEmpty()) Text("No SOS events on this phone yet.", modifier = Modifier.padding(top = 12.dp))
            items.forEach { Text(it, modifier = Modifier.padding(top = 12.dp), fontSize = 18.sp) }
        }
    }
}

@Composable
fun SettingsScreen(
    onHome: () -> Unit,
    onHistory: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var safeWord by remember { mutableStateOf("") }
    var guardian by remember { mutableStateOf("") }
    var guardianPhone by remember { mutableStateOf("") }
    var blood by remember { mutableStateOf("") }
    var allergies by remember { mutableStateOf("") }
    var medications by remember { mutableStateOf("") }
    var profileNotes by remember { mutableStateOf("") }
    var destination by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("30") }
    var cancelPin by remember { mutableStateOf("") }
    var duressPin by remember { mutableStateOf("") }
    var decoyPin by remember { mutableStateOf("") }
    var releasePin by remember { mutableStateOf("") }
    var showVolumeDisclosure by remember { mutableStateOf(false) }
    var pendingMic by remember { mutableStateOf<String?>(null) }
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
    val smsPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        viewModel.note(if (granted) "This phone can text the saved guardian number during a live SOS." else "SMS permission stays off. The hub can still text when SMS is configured.")
    }
    val audioPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        when (pendingMic) {
            "share" -> viewModel.updateShareAudio(granted)
            "sample" -> if (granted) viewModel.recordSafeWordSample()
            "listen" -> if (granted && viewModel.prepareSafeWord()) {
                androidx.core.content.ContextCompat.startForegroundService(
                    context,
                    android.content.Intent(context, za.co.guardian.service.SafeWordService::class.java),
                )
            }
        }
        pendingMic = null
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    if (showVolumeDisclosure) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showVolumeDisclosure = false },
            title = { Text("Volume button SOS") },
            text = {
                Text("Guardian needs an accessibility service to notice the volume pattern you choose. It does not read the screen, does not block the volume buttons, and is not an accessibility tool. Android will show that Guardian is on. Play policy requires this disclosure before you enable it.")
            },
            confirmButton = {
                TextButton(onClick = {
                    showVolumeDisclosure = false
                    context.startActivity(android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))
                }) { Text("Open settings") }
            },
            dismissButton = { TextButton(onClick = { showVolumeDisclosure = false }) { Text("Not now") } },
        )
    }
    Scaffold(bottomBar = { BottomNav(onHome = onHome, onHistory = onHistory, onSettings = {}, selected = "settings") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            Text("Settings", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
            Text(
                if (viewModel.testRemaining > 0) "Test session: ${(viewModel.testRemaining / 60000) + 1} min left"
                else "No test session. A test expires on its own.",
                modifier = Modifier.padding(vertical = 8.dp),
            )
            Button(onClick = viewModel::startTest, modifier = Modifier.fillMaxWidth()) { Text("Start 10 minute test") }
            Spacer(Modifier.height(12.dp))
            Button(onClick = { showVolumeDisclosure = true }, modifier = Modifier.fillMaxWidth()) { Text("Enable volume SOS") }
            Button(onClick = viewModel::cycleVolumePattern, modifier = Modifier.fillMaxWidth()) { Text("Change volume pattern") }
            Button(onClick = viewModel::cycleFreezePattern, modifier = Modifier.fillMaxWidth()) { Text("Change freeze volume pattern") }
            OutlinedTextField(decoyPin, { decoyPin = it }, label = { Text("Decoy payment PIN") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(releasePin, { releasePin = it }, label = { Text("Secret PIN to leave the freeze") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { viewModel.saveFreezePins(decoyPin, releasePin); decoyPin = ""; releasePin = "" }, modifier = Modifier.fillMaxWidth()) { Text("Save freeze PINs") }
            Text("A decoy PIN or the freeze volume pattern holds this app on one still screen. Hold the clock, then enter the secret PIN. A reboot clears the freeze. This does not block the power button.", modifier = Modifier.padding(vertical = 8.dp))
            Button(onClick = { smsPermission.launch(android.Manifest.permission.SEND_SMS) }, modifier = Modifier.fillMaxWidth()) { Text("Allow SMS to the saved guardian") }
            Button(onClick = viewModel::cycleVolumeWindow, modifier = Modifier.fillMaxWidth()) { Text("Change volume timing window") }
            Button(onClick = viewModel::toggleVolumeVibration, modifier = Modifier.fillMaxWidth()) { Text("Toggle volume vibration confirmation") }
            Button(onClick = viewModel::startVolumeTest, modifier = Modifier.fillMaxWidth()) { Text("Test volume button for 30 seconds") }
            OutlinedTextField(safeWord, { safeWord = it }, label = { Text("Safe word") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            Button(onClick = { viewModel.saveSafeWord(safeWord) }, modifier = Modifier.fillMaxWidth()) { Text("Save safe word on this phone") }
            Button(onClick = {
                pendingMic = "sample"
                audioPermission.launch(android.Manifest.permission.RECORD_AUDIO)
            }, modifier = Modifier.fillMaxWidth()) { Text("Record safe-word sample") }
            Button(onClick = {
                pendingMic = "listen"
                audioPermission.launch(android.Manifest.permission.RECORD_AUDIO)
            }, modifier = Modifier.fillMaxWidth()) { Text("Enable safe-word protection") }
            Text("Detection runs on this phone from samples you record. Guardian does not upload those samples. The microphone indicator stays on while listening.", modifier = Modifier.padding(vertical = 8.dp))
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
            OutlinedTextField(guardian, { guardian = it }, label = { Text("Guardian name") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            OutlinedTextField(guardianPhone, { guardianPhone = it }, label = { Text("Guardian phone for SMS") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { viewModel.addGuardian(guardian, guardianPhone) }, modifier = Modifier.fillMaxWidth()) { Text("Add guardian") }
            Button(onClick = viewModel::cycleProtectionMode, modifier = Modifier.fillMaxWidth()) { Text("Change protection mode") }
            Button(onClick = viewModel::toggleFallWatch, modifier = Modifier.fillMaxWidth()) { Text("Toggle impact detection") }
            Button(onClick = {
                cameraPermission.launch(android.Manifest.permission.CAMERA)
            }, modifier = Modifier.fillMaxWidth()) { Text("Take a photo for the open emergency") }
            Button(onClick = {
                val intent = android.content.Intent(android.provider.MediaStore.ACTION_VIDEO_CAPTURE)
                intent.putExtra(android.provider.MediaStore.EXTRA_DURATION_LIMIT, 8)
                intent.putExtra(android.provider.MediaStore.EXTRA_VIDEO_QUALITY, 0)
                videoCapture.launch(intent)
            }, modifier = Modifier.fillMaxWidth()) { Text("Record a short video for the open emergency") }
            OutlinedTextField(blood, { blood = it }, label = { Text("Blood type") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            OutlinedTextField(allergies, { allergies = it }, label = { Text("Allergies") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(medications, { medications = it }, label = { Text("Medications") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(profileNotes, { profileNotes = it }, label = { Text("Emergency notes") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { viewModel.saveProfile(blood, allergies, medications, profileNotes) }, modifier = Modifier.fillMaxWidth()) { Text("Save emergency profile") }
            OutlinedTextField(destination, { destination = it }, label = { Text("Journey destination") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(minutes, { minutes = it }, label = { Text("Minutes") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { viewModel.startJourney(destination, minutes) }, modifier = Modifier.fillMaxWidth()) { Text("Start journey, ride, meeting, or high-risk watch") }
            OutlinedTextField(cancelPin, { cancelPin = it }, label = { Text("Cancel PIN") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(duressPin, { duressPin = it }, label = { Text("Duress PIN") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { viewModel.savePins(cancelPin, duressPin); cancelPin = ""; duressPin = "" }, modifier = Modifier.fillMaxWidth()) { Text("Save PINs") }
            Text("The cancel screen always says the emergency is cancelled. A duress PIN keeps monitoring open. Android still shows location and microphone icons.", modifier = Modifier.padding(vertical = 8.dp))
            Button(onClick = { viewModel.cancel(cancelPin) }, modifier = Modifier.fillMaxWidth()) { Text("Cancel emergency with PIN") }
            Spacer(Modifier.height(12.dp))
            Button(onClick = viewModel::checkConnection, modifier = Modifier.fillMaxWidth()) { Text("Check connection") }
            viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
            Spacer(Modifier.height(20.dp))
            Button(onClick = { viewModel.signOut(onSignedOut) }, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
        }
    }
}

@Composable
private fun BottomNav(onHome: () -> Unit, onHistory: () -> Unit, onSettings: () -> Unit, selected: String) {
    NavigationBar {
        NavigationBarItem(selected = selected == "home", onClick = onHome, icon = { Text("Home") }, label = { Text("Home") })
        NavigationBarItem(selected = selected == "history", onClick = onHistory, icon = { Text("History") }, label = { Text("History") })
        NavigationBarItem(selected = selected == "settings", onClick = onSettings, icon = { Text("Settings") }, label = { Text("Settings") })
    }
}

@Composable
fun OnboardingScreen(onDone: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    var step by remember { mutableStateOf(0) }
    val steps = listOf(
        "Guardian sends a deliberate SOS immediately. Volume, safe word, and the SOS button do not wait for a risk score.",
        "Guardians are people you name. SMS and push are sent only when those providers are configured. A private room link is created for a live SOS.",
        "Photos and video are taken by you, with the camera app visible. They are not captured in the background.",
        "Impact detection shows a notification and waits 20 seconds. A watch signed with the same key can send SOS. This phone is not an iPhone app.",
    )
    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Setup ${step + 1} of ${steps.size}", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            Text(steps[step])
            Button(onClick = {
                if (step == steps.lastIndex) {
                    viewModel.finishOnboarding(onDone)
                } else {
                    step += 1
                }
            }, modifier = Modifier.fillMaxWidth()) { Text(if (step == steps.lastIndex) "Finish setup" else "Continue") }
        }
    }
}

@Composable
fun SurfacePreview() {
    Surface(color = Color(0xFF0E1116)) {}
}
