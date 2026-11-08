package za.co.guardian.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable
fun AcceptGuardianInviteScreen(
    token: String,
    onAccepted: () -> Unit,
    onCancel: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Guardian invitation", fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text("Accept this invitation to protect the person who invited this Guardian account. No USER protection controls are shown on this screen.")
        Button(
            onClick = { viewModel.acceptInvitation(token, onAccepted) },
            enabled = token.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Accept invitation") }
        TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) { Text("Not now") }
        viewModel.status?.let { Text(it) }
    }
}

@Composable
fun ProductionGuardianHomeScreen(
    onProfile: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val message by viewModel.message.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(Unit) { viewModel.refresh() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Guardian", fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text("People I protect", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 16.dp))
        if (viewModel.protectedPeople.isEmpty()) Text("No accepted protection invitations yet.", modifier = Modifier.padding(top = 8.dp))
        viewModel.protectedPeople.forEach { person ->
            Surface(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), color = Color(0xFF171C24)) {
                Column(Modifier.padding(14.dp)) {
                    Text(person.displayName, fontWeight = FontWeight.SemiBold, fontSize = 19.sp)
                    Text("${person.relationship} · priority ${person.priority}", color = Color(0xFFB7C0CC))
                    if (person.activeIncidents.isEmpty()) {
                        Text("SAFE · no active Guardian incident", color = Color(0xFF8BD3A8), modifier = Modifier.padding(top = 6.dp))
                    } else {
                        person.activeIncidents.forEach { incident ->
                            Text(
                                "${incident.state} · ${incident.triggerType} · ${incident.contactStatus.ifBlank { "contact unknown" }}",
                                color = Color(0xFFE23B3B),
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                            Button(
                                onClick = { viewModel.openGuardianIncident(incident.id, context) },
                                modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                            ) { Text("Open active incident") }
                        }
                    }
                    person.lastAcknowledgedAt?.let { Text("Last acknowledgement $it", color = Color(0xFFB7C0CC)) }
                }
            }
        }
        message?.let { Text(it, modifier = Modifier.padding(top = 12.dp)) }
        Button(onClick = viewModel::refresh, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) { Text("Refresh alerts") }
        Button(onClick = onProfile, modifier = Modifier.fillMaxWidth()) { Text("Guardian account") }
        TextButton(onClick = onSignedOut, modifier = Modifier.fillMaxWidth()) { Text("Sign out") }
    }
}

@Composable
fun ProductionResponderHomeScreen(
    onProfile: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val message by viewModel.message.collectAsStateWithLifecycle()
    val context = androidx.compose.ui.platform.LocalContext.current
    LaunchedEffect(Unit) { viewModel.refresh() }
    val profile = viewModel.responderProfile
    var availability by remember(profile?.availability) { mutableStateOf(profile?.availability ?: "AVAILABLE") }
    var team by remember(profile?.team) { mutableStateOf(profile?.team.orEmpty()) }
    var region by remember(profile?.region) { mutableStateOf(profile?.region.orEmpty()) }
    var capabilities by remember(profile?.capabilities) { mutableStateOf(profile?.capabilities.orEmpty()) }
    var vehicle by remember(profile?.vehicle) { mutableStateOf(profile?.vehicle.orEmpty()) }
    var phone by remember(profile?.phone) { mutableStateOf(profile?.phone.orEmpty()) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text("Responder", fontSize = 34.sp, fontWeight = FontWeight.Bold)
        Text("Availability & capability", fontSize = 20.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
            listOf("AVAILABLE", "BUSY", "OFF_DUTY", "UNAVAILABLE").forEach { state ->
                TextButton(onClick = { availability = state }) { Text(if (availability == state) "✓ $state" else state) }
            }
        }
        OutlinedTextField(team, { team = it }, label = { Text("Team") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(region, { region = it }, label = { Text("Region") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(capabilities, { capabilities = it }, label = { Text("Capabilities") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(vehicle, { vehicle = it }, label = { Text("Vehicle") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(phone, { phone = it }, label = { Text("Response phone") }, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = { viewModel.updateResponderProfile(availability, team, region, capabilities, vehicle, phone) },
            modifier = Modifier.fillMaxWidth(),
        ) { Text("Save responder status") }

        Text("Assignments", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 18.dp))
        if (viewModel.assignments.isEmpty()) Text("No active assignments.", modifier = Modifier.padding(top = 8.dp))
        viewModel.assignments.forEach { incident ->
            Surface(modifier = Modifier.fillMaxWidth().padding(top = 10.dp), color = Color(0xFF171C24)) {
                Column(Modifier.padding(14.dp)) {
                    Text("${incident.userDisplayName.ifBlank { "Person" }} · ${incident.state}", fontWeight = FontWeight.SemiBold)
                    Text("${incident.triggerType} · contact ${incident.contactStatus.ifBlank { "unknown" }}", color = Color(0xFFB7C0CC))
                    Text("Assignment · ${incident.assignment ?: "ASSIGNED"}", color = Color(0xFFB7C0CC))
                    incident.emergencyProfile?.let { p ->
                        if (!p.bloodType.isNullOrBlank() || !p.allergies.isNullOrBlank() || !p.medications.isNullOrBlank() || !p.notes.isNullOrBlank()) {
                            Text("Emergency profile", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
                            p.bloodType?.takeIf(String::isNotBlank)?.let { Text("Blood type: $it") }
                            p.allergies?.takeIf(String::isNotBlank)?.let { Text("Allergies: $it") }
                            p.medications?.takeIf(String::isNotBlank)?.let { Text("Medication: $it") }
                            p.notes?.takeIf(String::isNotBlank)?.let { Text("Notes: $it") }
                        }
                    }
                    if (incident.lastLatitude != null && incident.lastLongitude != null) {
                        Text("Last confirmed ${"%.5f".format(incident.lastLatitude)}, ${"%.5f".format(incident.lastLongitude)}", modifier = Modifier.padding(top = 6.dp))
                        Button(
                            onClick = {
                                val uri = Uri.parse("geo:${incident.lastLatitude},${incident.lastLongitude}?q=${incident.lastLatitude},${incident.lastLongitude}(Guardian incident)")
                                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Open last confirmed location") }
                    }
                    responderActions(incident.assignment ?: "ASSIGNED").forEach { (status, label) ->
                        val destructive = status == "DECLINED"
                        if (destructive) {
                            TextButton(
                                onClick = { viewModel.updateAssignment(incident.id, status, "Assignment declined. Live location sharing stopped.") },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(label) }
                        } else {
                            Button(
                                onClick = {
                                    if (status == "USER_LOCATED") viewModel.reportLocated(incident.id)
                                    else viewModel.updateAssignment(incident.id, status, responderSuccess(status))
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text(label) }
                        }
                    }
                }
            }
        }
        message?.let { Text(it, modifier = Modifier.padding(top = 12.dp)) }
        Button(onClick = viewModel::refresh, modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) { Text("Refresh assignments") }
        Button(onClick = onProfile, modifier = Modifier.fillMaxWidth()) { Text("Responder account") }
        Text("Only valid next assignment states are shown. Guardian keeps responder location sharing visible while the assignment is active.", modifier = Modifier.padding(top = 12.dp))
    }
}

private fun responderActions(status: String): List<Pair<String, String>> = when (status) {
    "ASSIGNED" -> listOf("ACCEPTED" to "Accept assignment", "DECLINED" to "Decline assignment")
    "ACCEPTED" -> listOf("EN_ROUTE" to "En route", "DECLINED" to "Decline assignment")
    "EN_ROUTE", "RESPONDING" -> listOf("ON_SCENE" to "On scene", "DECLINED" to "Decline assignment")
    "ON_SCENE" -> listOf("USER_LOCATED" to "Report person located", "COMPLETED" to "Complete assignment")
    "USER_LOCATED" -> listOf("COMPLETED" to "Complete assignment")
    else -> emptyList()
}

private fun responderSuccess(status: String): String = when (status) {
    "ACCEPTED" -> "Assignment accepted. Live location sharing started."
    "EN_ROUTE" -> "Marked en route. Live location sharing continues."
    "ON_SCENE" -> "Marked on scene."
    "COMPLETED" -> "Assignment completed. Live location sharing stopped."
    else -> "Responder status updated."
}

@Composable
fun GuardianAccountScreen(
    onHome: () -> Unit,
    onPrivacy: () -> Unit,
    onHelp: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) = RoleAccountScreen("Guardian account", onHome, onPrivacy, onHelp, onSignedOut, viewModel)

@Composable
fun ResponderAccountScreen(
    onHome: () -> Unit,
    onPrivacy: () -> Unit,
    onHelp: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
) = RoleAccountScreen("Responder account", onHome, onPrivacy, onHelp, onSignedOut, viewModel)

@Composable
private fun RoleAccountScreen(
    title: String,
    onHome: () -> Unit,
    onPrivacy: () -> Unit,
    onHelp: () -> Unit,
    onSignedOut: () -> Unit,
    viewModel: SettingsViewModel,
) {
    LaunchedEffect(Unit) { viewModel.refresh() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        TextButton(onClick = onHome) { Text("Back to role home") }
        Text(title, fontSize = 32.sp, fontWeight = FontWeight.SemiBold)
        Text("This role does not expose USER protection, Guardian-management, or Activity navigation.", modifier = Modifier.padding(vertical = 12.dp))
        Button(onClick = onPrivacy, modifier = Modifier.fillMaxWidth()) { Text("Account & privacy") }
        Button(onClick = onHelp, modifier = Modifier.fillMaxWidth()) { Text("Help & support") }
        Button(onClick = viewModel::checkConnection, modifier = Modifier.fillMaxWidth()) { Text("Check connection") }
        viewModel.status?.let { Text(it, modifier = Modifier.padding(top = 8.dp)) }
        TextButton(onClick = { viewModel.signOut(onSignedOut) }, modifier = Modifier.fillMaxWidth().padding(top = 18.dp)) { Text("Sign out") }
    }
}
