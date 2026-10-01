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
) : ViewModel() {
    private val healthState = MutableStateFlow(healthSource.current())
    val health: StateFlow<ProtectionHealth> = healthState
    private val messageState = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = messageState
    private val activeState = MutableStateFlow<LocalIncident?>(null)
    val active: StateFlow<LocalIncident?> = activeState
    private val practiceState = MutableStateFlow(practiceMode.enabled())
    val practice: StateFlow<Boolean> = practiceState

    fun refresh() {
        healthState.value = healthSource.current()
        practiceState.value = practiceMode.enabled()
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
    private val protection: za.co.guardian.data.ProtectionActions,
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

    fun startTest() {
        settings.startTestSession()
        testRemaining = settings.remainingMs()
        status = "Test session ends in 10 minutes. SOS during it is marked as a test."
    }

    fun startVolumeTest() {
        settings.startVolumeTest()
        status = "Press volume down three times in the next 30 seconds. Guardian will not send SOS."
    }

    fun updateShareAudio(enabled: Boolean) {
        settings.setShareAudio(enabled)
        shareAudio = enabled
    }

    fun saveSafeWord(phrase: String) {
        settings.setSafeWord(phrase)
        status = if (phrase.trim().length < 4) "Use a phrase of at least 4 letters." else "Safe word saved on this phone. It is not uploaded."
    }

    fun checkConnection() = run { "Backend ${auth.checkConnection()}" }
    fun addGuardian(name: String) = run { protection.addGuardian(name) }
    fun startJourney(label: String, minutes: String) = run { protection.startJourney(label, minutes.toIntOrNull() ?: 30) }
    fun savePins(cancelPin: String, duressPin: String) = run { protection.setPins(cancelPin, duressPin) }
    fun cancel(pin: String) = run { protection.cancel(pin) }

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
    val practice by viewModel.practice.collectAsStateWithLifecycle()
    Scaffold(bottomBar = { BottomNav(onHome = {}, onHistory = onHistory, onSettings = onSettings, selected = "home") }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(rememberScrollState())) {
            if (practice) Text("TEST MODE", color = Color(0xFF111111), modifier = Modifier.fillMaxWidth().padding(8.dp))
            Text(health.level.name.replace('_', ' '), fontSize = 34.sp, fontWeight = FontWeight.Bold)
            Text(if (health.level == ProtectionLevel.PROTECTED) "Guardian is ready." else "Manual SOS is available. Some protection is not ready.")
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
            message?.let { Text(it, modifier = Modifier.padding(top = 12.dp)) }
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = viewModel::sendSos,
                modifier = Modifier.fillMaxWidth().height(120.dp).semantics { contentDescription = "Send emergency SOS now" },
            ) { Text("SOS", fontSize = 40.sp, fontWeight = FontWeight.Bold) }
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
    var destination by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("30") }
    var cancelPin by remember { mutableStateOf("") }
    var duressPin by remember { mutableStateOf("") }
    var showVolumeDisclosure by remember { mutableStateOf(false) }
    val audioPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            androidx.core.content.ContextCompat.startForegroundService(context, android.content.Intent(context, za.co.guardian.service.SafeWordService::class.java))
        }
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    if (showVolumeDisclosure) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { showVolumeDisclosure = false },
            title = { Text("Volume button SOS") },
            text = {
                Text("Guardian needs an accessibility service to notice three volume-down presses. It does not read the screen, does not block the volume buttons, and is not an accessibility tool. Android will show that Guardian is on. Play policy requires this disclosure before you enable it.")
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
            Button(onClick = viewModel::startVolumeTest, modifier = Modifier.fillMaxWidth()) { Text("Test volume button for 30 seconds") }
            OutlinedTextField(safeWord, { safeWord = it }, label = { Text("Safe word") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            Button(onClick = { viewModel.saveSafeWord(safeWord) }, modifier = Modifier.fillMaxWidth()) { Text("Save safe word on this phone") }
            Button(onClick = { audioPermission.launch(android.Manifest.permission.RECORD_AUDIO) }, modifier = Modifier.fillMaxWidth()) { Text("Listen for safe word") }
            Text("Listening uses the phone's speech recognizer and prefers an on-device model. Guardian does not upload the audio. The microphone indicator stays on.", modifier = Modifier.padding(vertical = 8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Share short audio during an on-screen SOS")
                Switch(checked = viewModel.shareAudio, onCheckedChange = {
                    if (it) audioPermission.launch(android.Manifest.permission.RECORD_AUDIO)
                    viewModel.updateShareAudio(it)
                })
            }
            OutlinedTextField(guardian, { guardian = it }, label = { Text("Guardian name") }, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
            Button(onClick = { viewModel.addGuardian(guardian) }, modifier = Modifier.fillMaxWidth()) { Text("Add guardian") }
            OutlinedTextField(destination, { destination = it }, label = { Text("Journey destination") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(minutes, { minutes = it }, label = { Text("Minutes") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { viewModel.startJourney(destination, minutes) }, modifier = Modifier.fillMaxWidth()) { Text("Start journey watch") }
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
fun SurfacePreview() {
    Surface(color = Color(0xFF0E1116)) {}
}
