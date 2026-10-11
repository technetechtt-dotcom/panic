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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun LegalPage(title: String, body: String, onBack: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text(title, fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(12.dp))
        Text(body)
    }
}

fun formatVolume(name: String): String = when (name) {
    "DOWN_2" -> "Down ×2"
    "DOWN_3" -> "Down ×3"
    "UP_2" -> "Up ×2"
    "UP_3" -> "Up ×3"
    else -> name
}

fun privacyCopy(): String = "Guardian collects account, device, location, and incident data only to deliver SOS and monitoring. Location is last-confirmed device reports, not a live track unless the age is a few seconds. Evidence is encrypted on the server. This page is the in-app notice, not a legal filing."

fun termsCopy(): String = "You start a deliberate SOS yourself. Guardian does not replace official emergency services. Volume SOS and freeze use different volume keys. Test incidents stay out of live metrics. You can export or erase your profile. Incident rows stay after erase so an open emergency is not deleted."

fun helpCopy(): String = "Send SOS from Home. Protect sets volume, safe word, journey, and impact. Guardians are people you invite. Activity is history. Profile is medical notes, devices, and privacy. During SOS, use Active Incident for photo, video, and PIN cancel."

fun safetyCopy(): String = "Guardian cannot place the 112 call. It opens the dialer. Contact loss is a signal, not a conclusion. Quiet or duress cancel does not restart the microphone. Android still shows location and microphone indicators."

@Composable
fun PasswordField(value: String, onChange: (String) -> Unit, label: String, numeric: Boolean = false) {
    var visible by remember { mutableStateOf(false) }
    OutlinedTextField(
        value,
        onChange,
        label = { Text(label) },
        modifier = Modifier.fillMaxWidth(),
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = if (numeric) KeyboardType.NumberPassword else KeyboardType.Password),
        trailingIcon = { TextButton(onClick = { visible = !visible }) { Text(if (visible) "Hide" else "Show") } },
    )
}

@Composable
fun ForgotPasswordScreen(onBack: () -> Unit, viewModel: AuthViewModel = hiltViewModel()) {
    var email by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Forgot password", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text("If that email exists, Guardian records a reset. Email is sent only when SMTP is configured.", modifier = Modifier.padding(vertical = 8.dp))
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
        viewModel.error?.let { Text(it, color = androidx.compose.ui.graphics.Color(0xFFE23B3B)) }
        message?.let { Text(it) }
        Button(onClick = { viewModel.forgot(email) { message = it } }, enabled = !viewModel.busy, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
            Text("Request reset")
        }
    }
}

@Composable
fun ResetPasswordScreen(onDone: () -> Unit, onBack: () -> Unit, viewModel: AuthViewModel = hiltViewModel()) {
    var token by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Reset password", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(token, { token = it }, label = { Text("Reset token") }, modifier = Modifier.fillMaxWidth())
        PasswordField(password, { password = it }, "New password (12+ characters)")
        PasswordField(confirm, { confirm = it }, "Confirm password")
        viewModel.error?.let { Text(it, color = androidx.compose.ui.graphics.Color(0xFFE23B3B)) }
        Button(
            onClick = { if (password == confirm && password.length >= 12) viewModel.reset(token, password, onDone) },
            enabled = !viewModel.busy,
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
        ) { Text("Save new password") }
    }
}

@Composable
fun VerifyEmailScreen(onBack: () -> Unit, viewModel: AuthViewModel = hiltViewModel()) {
    var token by remember { mutableStateOf("") }
    var done by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Verify email", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(token, { token = it }, label = { Text("Verification token") }, modifier = Modifier.fillMaxWidth())
        viewModel.error?.let { Text(it, color = androidx.compose.ui.graphics.Color(0xFFE23B3B)) }
        if (done) Text("Email marked verified on this account.")
        Button(onClick = { viewModel.verify(token) { done = true } }, enabled = !viewModel.busy, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
            Text("Verify")
        }
    }
}

@Composable
fun SafeWordPage(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var phrase by remember { mutableStateOf(viewModel.phrase) }
    var pendingMic by remember { mutableStateOf<String?>(null) }
    val audio = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted && pendingMic == "sample") viewModel.recordSafeWordSample()
        if (granted && pendingMic == "listen" && viewModel.prepareSafeWord()) {
            androidx.core.content.ContextCompat.startForegroundService(
                context,
                android.content.Intent(context, za.co.guardian.service.SafeWordService::class.java),
            )
        }
        pendingMic = null
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Safe word", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text("Current phrase: ${viewModel.phrase.ifBlank { "not set" }}")
        Text("Samples: ${viewModel.sampleCount}. Listening: ${if (viewModel.listening) "on" else "off"}.")
        Text("Changing the phrase deletes old recordings and turns listening off.", modifier = Modifier.padding(vertical = 8.dp))
        OutlinedTextField(phrase, { phrase = it }, label = { Text("Safe word phrase") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = { viewModel.saveSafeWord(phrase) }, modifier = Modifier.fillMaxWidth()) { Text("Save phrase") }
        Button(onClick = { pendingMic = "sample"; audio.launch(android.Manifest.permission.RECORD_AUDIO) }, modifier = Modifier.fillMaxWidth()) { Text("Record sample") }
        Button(onClick = { pendingMic = "listen"; audio.launch(android.Manifest.permission.RECORD_AUDIO) }, modifier = Modifier.fillMaxWidth()) { Text("Enable listening") }
        Button(onClick = viewModel::disableListening, modifier = Modifier.fillMaxWidth()) { Text("Disable listening") }
        Button(onClick = viewModel::clearSamples, modifier = Modifier.fillMaxWidth()) { Text("Delete samples") }
        Text("Sensitivity ${viewModel.sensitivity}", modifier = Modifier.padding(top = 12.dp))
        Slider(value = viewModel.sensitivity.toFloat(), onValueChange = { viewModel.updateSensitivity(it.toInt()) }, valueRange = 0f..100f)
        viewModel.status?.let { Text(it) }
    }
}

@Composable
fun VolumeSosPage(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    var show by remember { mutableStateOf(false) }
    val context = androidx.compose.ui.platform.LocalContext.current
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    if (show) {
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { show = false },
            title = { Text("Volume button SOS") },
            text = { Text("Guardian needs an accessibility service to notice the volume pattern. It does not read the screen. Android will show that Guardian is on.") },
            confirmButton = {
                TextButton(onClick = {
                    show = false
                    context.startActivity(android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))
                }) { Text("Open settings") }
            },
            dismissButton = { TextButton(onClick = { show = false }) { Text("Not now") } },
        )
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Volume SOS", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text("Status ${if (viewModel.volumeConnected) "ON" else "OFF"}")
        Text("Pattern ${formatVolume(viewModel.volumePattern)}")
        Text("Window ${viewModel.volumeWindow / 1000.0} sec")
        Text("Vibration ${if (viewModel.volumeVibrate) "ON" else "OFF"}")
        Text("Accessibility ${if (viewModel.volumeConnected) "Connected" else "Not connected"}", modifier = Modifier.padding(bottom = 12.dp))
        Button(onClick = { show = true }, modifier = Modifier.fillMaxWidth()) { Text("Enable accessibility") }
        Button(onClick = viewModel::cycleVolumePattern, modifier = Modifier.fillMaxWidth()) { Text("Change pattern") }
        Button(onClick = viewModel::cycleVolumeWindow, modifier = Modifier.fillMaxWidth()) { Text("Change window") }
        Button(onClick = viewModel::toggleVolumeVibration, modifier = Modifier.fillMaxWidth()) { Text("Toggle vibration") }
        Button(onClick = viewModel::startVolumeTest, modifier = Modifier.fillMaxWidth()) { Text("Test trigger for 30 seconds") }
        viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
    }
}

@Composable
fun JourneyPage(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    var destination by remember { mutableStateOf("") }
    var minutes by remember { mutableStateOf("30") }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    val active = viewModel.journeys.firstOrNull { it.status == "ACTIVE" || it.status == "CONCERN" }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Active journey", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        if (active != null) {
            Text("Destination ${active.destinationLabel.ifBlank { destination.ifBlank { "saved journey" } }}")
            Text("Status ${active.status}")
            Text("Expected ${active.expectedArrivalAt ?: "not set"}")
            Button(onClick = viewModel::checkIn, modifier = Modifier.fillMaxWidth()) { Text("I'm safe / check in") }
            Button(onClick = { viewModel.extendJourney("15") }, modifier = Modifier.fillMaxWidth()) { Text("Extend 15 minutes") }
            Button(onClick = viewModel::completeJourney, modifier = Modifier.fillMaxWidth()) { Text("Arrived") }
        } else {
            Text("No active journey. Start one before a walk, ride, or meeting.")
            OutlinedTextField(destination, { destination = it }, label = { Text("Destination") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(minutes, { minutes = it }, label = { Text("Minutes") }, modifier = Modifier.fillMaxWidth())
            Button(onClick = { viewModel.previewJourney(destination) }, modifier = Modifier.fillMaxWidth()) { Text("Look up destination") }
            viewModel.journeyPreview?.let { preview ->
                Text("Confirm ${preview.label}")
                Text("${"%.5f".format(preview.latitude)}, ${"%.5f".format(preview.longitude)}")
                androidx.compose.ui.viewinterop.AndroidView(
                    factory = { context ->
                        android.webkit.WebView(context).apply {
                            settings.javaScriptEnabled = false
                            loadUrl("https://www.openstreetmap.org/?mlat=${preview.latitude}&mlon=${preview.longitude}#map=16/${preview.latitude}/${preview.longitude}")
                        }
                    },
                    update = { web ->
                        web.loadUrl("https://www.openstreetmap.org/?mlat=${preview.latitude}&mlon=${preview.longitude}#map=16/${preview.latitude}/${preview.longitude}")
                    },
                    modifier = Modifier.fillMaxWidth().height(220.dp),
                )
                Button(onClick = { viewModel.startJourney(destination, minutes) }, modifier = Modifier.fillMaxWidth()) { Text("Confirm destination and start") }
            }
        }
        viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
    }
}

@Composable
fun DuressPage(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    var decoy by remember { mutableStateOf("") }
    var release by remember { mutableStateOf("") }
    var cancel by remember { mutableStateOf("") }
    var duress by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Duress & coercion", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text("The decoy PIN opens the freeze screen. It is not a payment password. The freeze volume pattern uses the other volume key from SOS.", modifier = Modifier.padding(vertical = 8.dp))
        Button(onClick = viewModel::cycleFreezePattern, modifier = Modifier.fillMaxWidth()) { Text("Change freeze volume pattern") }
        PasswordField(decoy, { decoy = it }, "Decoy PIN", numeric = true)
        PasswordField(release, { release = it }, "Secret PIN to leave freeze", numeric = true)
        Button(onClick = { viewModel.saveFreezePins(decoy, release); decoy = ""; release = "" }, modifier = Modifier.fillMaxWidth()) { Text("Save freeze PINs") }
        PasswordField(cancel, { cancel = it }, "Cancel PIN", numeric = true)
        PasswordField(duress, { duress = it }, "Duress PIN", numeric = true)
        Button(onClick = { viewModel.savePins(cancel, duress); cancel = ""; duress = "" }, modifier = Modifier.fillMaxWidth()) { Text("Save cancel and duress PINs") }
        viewModel.status?.let { Text(it) }
    }
}

@Composable
fun EmergencyProfilePage(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    var blood by remember { mutableStateOf("") }
    var allergies by remember { mutableStateOf("") }
    var medications by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    androidx.compose.runtime.LaunchedEffect(viewModel.profile) {
        viewModel.profile?.let {
            blood = it.bloodType.orEmpty()
            allergies = it.allergies.orEmpty()
            medications = it.medications.orEmpty()
            notes = it.notes.orEmpty()
        }
    }
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Emergency profile", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text("Existing values load from the server so you do not overwrite them by accident.", modifier = Modifier.padding(vertical = 8.dp))
        OutlinedTextField(blood, { blood = it }, label = { Text("Blood type") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(allergies, { allergies = it }, label = { Text("Allergies") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(medications, { medications = it }, label = { Text("Medications") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(notes, { notes = it }, label = { Text("Emergency notes") }, modifier = Modifier.fillMaxWidth())
        Button(onClick = { viewModel.saveProfile(blood, allergies, medications, notes) }, modifier = Modifier.fillMaxWidth()) { Text("Save") }
        viewModel.status?.let { Text(it) }
    }
}

@Composable
fun PrivacyPage(onBack: () -> Unit, onSignedOut: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    var password by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("Account & privacy", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text(privacyCopy(), modifier = Modifier.padding(vertical = 8.dp))
        Button(onClick = viewModel::exportAccount, modifier = Modifier.fillMaxWidth()) { Text("Export my data") }
        PasswordField(password, { password = it }, "Password to erase profile")
        Button(onClick = { viewModel.eraseAccount(password) }, modifier = Modifier.fillMaxWidth()) { Text("Erase my profile") }
        Button(onClick = { viewModel.signOut(onSignedOut) }, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
        viewModel.status?.let { Text(it) }
    }
}

@Composable
fun ModeCards(current: String, onSelect: (String) -> Unit) {
    val modes = listOf(
        "WALK" to "Walk. Tight corridor and regular check-ins.",
        "RIDE" to "Ride. Wider corridor for a passenger.",
        "DRIVE" to "Drive. Wider corridor for a vehicle.",
        "MEETING" to "Meeting. Faster check-ins.",
        "HIGH_RISK" to "High risk. Fastest check-ins. Still not an SOS until you trigger one.",
    )
    modes.forEach { (mode, detail) ->
        Button(onClick = { onSelect(mode) }, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Text(if (current == mode) "Selected · $detail" else detail)
        }
    }
}

@Composable
fun SetupOnboardingScreen(onDone: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    var step by remember { mutableStateOf(0) }
    var guardian by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var phrase by remember { mutableStateOf("") }
    var blood by remember { mutableStateOf("") }
    var cancel by remember { mutableStateOf("") }
    var duress by remember { mutableStateOf("") }
    val context = androidx.compose.ui.platform.LocalContext.current
    val location = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { }
    val notify = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission(),
    ) { }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Setup ${step + 1} of 8", fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
        when (step) {
            0 -> {
                Text("Allow notifications so Guardian can ask you to reopen the app after a background SOS.")
                Button(onClick = {
                    if (android.os.Build.VERSION.SDK_INT >= 33) notify.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    step += 1
                }, modifier = Modifier.fillMaxWidth()) { Text("Allow notifications") }
            }
            1 -> {
                Text("Allow location for an on-screen SOS. Android will show the location indicator.")
                Button(onClick = {
                    location.launch(android.Manifest.permission.ACCESS_FINE_LOCATION)
                    step += 1
                }, modifier = Modifier.fillMaxWidth()) { Text("Allow location") }
            }
            2 -> {
                Text("Add one trusted guardian. Email starts an invitation.")
                OutlinedTextField(guardian, { guardian = it }, label = { Text("Name") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(phone, { phone = it }, label = { Text("Phone") }, modifier = Modifier.fillMaxWidth())
                Button(onClick = { viewModel.addGuardian(guardian, phone); step += 1 }, modifier = Modifier.fillMaxWidth()) { Text("Save guardian") }
            }
            3 -> {
                Text("Volume SOS uses an accessibility service. Freeze uses the other volume key.")
                Button(onClick = {
                    context.startActivity(android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    step += 1
                }, modifier = Modifier.fillMaxWidth()) { Text("Open accessibility settings") }
            }
            4 -> {
                Text("Save a safe word. Record samples later on the Safe Word page.")
                OutlinedTextField(phrase, { phrase = it }, label = { Text("Phrase") }, modifier = Modifier.fillMaxWidth())
                Button(onClick = { viewModel.saveSafeWord(phrase); step += 1 }, modifier = Modifier.fillMaxWidth()) { Text("Save phrase") }
            }
            5 -> {
                Text("Emergency profile is shared with the hub during an incident export.")
                OutlinedTextField(blood, { blood = it }, label = { Text("Blood type") }, modifier = Modifier.fillMaxWidth())
                Button(onClick = { viewModel.saveProfile(blood, "", "", ""); step += 1 }, modifier = Modifier.fillMaxWidth()) { Text("Save profile") }
            }
            6 -> {
                Text("Cancel PIN ends the incident. Duress PIN looks cancelled and keeps monitoring.")
                PasswordField(cancel, { cancel = it }, "Cancel PIN", numeric = true)
                PasswordField(duress, { duress = it }, "Duress PIN", numeric = true)
                Button(onClick = { viewModel.savePins(cancel, duress); step += 1 }, modifier = Modifier.fillMaxWidth()) { Text("Save PINs") }
            }
            else -> {
                Text("Start a 10 minute test if you want to practise. Then Guardian is ready for a real SOS.")
                Button(onClick = viewModel::startTest, modifier = Modifier.fillMaxWidth()) { Text("Start test session") }
                Button(onClick = { viewModel.finishOnboarding(onDone) }, modifier = Modifier.fillMaxWidth()) { Text("Finish setup") }
            }
        }
        TextButton(onClick = { if (step < 7) step += 1 else viewModel.finishOnboarding(onDone) }) { Text("Skip this step") }
        viewModel.status?.let { Text(it) }
    }
}

@Composable
fun DevicesPage(onBack: () -> Unit, viewModel: SettingsViewModel = hiltViewModel()) {
    androidx.compose.runtime.LaunchedEffect(Unit) { viewModel.refresh() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp)) {
        TextButton(onClick = onBack) { Text("Back") }
        Text("My devices", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text("Revoke a lost or replaced phone. That device cannot send SOS until it signs in again.", modifier = Modifier.padding(vertical = 8.dp))
        viewModel.devices.forEach { device ->
            val state = if (device.revokedAt != null) "revoked" else if (device.fcmToken != null) "push ready" else "no push token"
            Text("${device.nickname ?: device.model ?: "Phone"}", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
            Text("${device.osVersion} · $state")
            Text("Last seen ${device.lastSeenAt ?: "unknown"}")
            if (device.revokedAt == null) {
                Button(onClick = { viewModel.revokeDevice(device.id) }, modifier = Modifier.fillMaxWidth()) { Text("Revoke this device") }
            }
        }
        if (viewModel.devices.isEmpty()) Text("No devices on this account yet.")
        viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
    }
}
