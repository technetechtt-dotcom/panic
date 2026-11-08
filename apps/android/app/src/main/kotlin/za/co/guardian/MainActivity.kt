package za.co.guardian

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dagger.hilt.android.AndroidEntryPoint
import za.co.guardian.data.EmergencyServiceController
import za.co.guardian.data.PhoneSignals
import za.co.guardian.data.SettingsStore
import za.co.guardian.data.TokenStore
import za.co.guardian.ui.AcceptGuardianInviteScreen
import za.co.guardian.ui.ActiveIncidentScreen
import za.co.guardian.ui.DevicesPage
import za.co.guardian.ui.DuressPage
import za.co.guardian.ui.EmergencyProfilePage
import za.co.guardian.ui.ForgotPasswordScreen
import za.co.guardian.ui.GuardianTheme
import za.co.guardian.ui.GuardianAccountScreen
import za.co.guardian.ui.GuardiansScreen
import za.co.guardian.ui.ProductionGuardianHomeScreen
import za.co.guardian.ui.HistoryScreen
import za.co.guardian.ui.HomeScreen
import za.co.guardian.ui.JourneyPage
import za.co.guardian.ui.LegalPage
import za.co.guardian.ui.LoginScreen
import za.co.guardian.ui.OnboardingScreen
import za.co.guardian.ui.PrivacyPage
import za.co.guardian.ui.ProfileScreen
import za.co.guardian.ui.RegisterScreen
import za.co.guardian.ui.ProductionResponderHomeScreen
import za.co.guardian.ui.ResponderAccountScreen
import za.co.guardian.ui.ResetPasswordScreen
import za.co.guardian.ui.SafeWordPage
import za.co.guardian.ui.SettingsScreen
import za.co.guardian.ui.VerifyEmailScreen
import za.co.guardian.ui.VolumeSosPage
import za.co.guardian.ui.WelcomeScreen
import za.co.guardian.ui.helpCopy
import za.co.guardian.ui.privacyCopy
import za.co.guardian.ui.safetyCopy
import za.co.guardian.ui.termsCopy
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var tokens: TokenStore
    @Inject lateinit var settings: SettingsStore
    @Inject lateinit var signals: PhoneSignals
    @Inject lateinit var controller: EmergencyServiceController

    private var signedIn by mutableStateOf(false)
    private var pendingDeepLink by mutableStateOf(parseGuardianDeepLink(intent))
    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openGuardianRoom(intent)
        pendingDeepLink = parseGuardianDeepLink(intent)
    }

    private fun openGuardianRoom(intent: Intent): Boolean {
        val roomUrl = intent.getStringExtra("roomUrl")?.takeIf { it.startsWith("https://") } ?: return false
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(roomUrl))) }
        return true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openGuardianRoom(intent)
        signedIn = tokens.accessToken() != null
        if (intent.getBooleanExtra("resume", false) && settings.incidentActive()) {
            controller.start(
                za.co.guardian.core.monitoringStart(
                    za.co.guardian.core.MonitoringOrigin.USER_VISIBLE,
                    signals.hasFineLocation(),
                    microphoneGranted = false,
                    microphoneRequested = false,
                ),
            )
        }
        if (signedIn && (settings.journeyId() != null || settings.responderIncidentId() != null)) {
            za.co.guardian.service.ProtectionTrackingService.ensureRunning(this)
        }
        setContent {
            GuardianTheme {
                val nav = rememberNavController()
                fun roleHome(): String = when (tokens.userRole()) {
                    "GUARDIAN" -> "guardian-home"
                    "RESPONDER" -> "responder-home"
                    else -> "home"
                }
                fun signedInDestination(): String = if (tokens.userRole() == "USER" && !settings.onboarded()) "onboarding" else roleHome()
                val start = when {
                    !signedIn -> "welcome"
                    tokens.userRole() == "USER" && !settings.onboarded() -> "onboarding"
                    tokens.userRole() == "USER" && settings.incidentActive() -> "active"
                    else -> roleHome()
                }
                fun afterAuth() {
                    signedIn = true
                    nav.navigate(signedInDestination()) { popUpTo("welcome") { inclusive = true } }
                }
                fun signOut() {
                    signedIn = false
                    nav.navigate("welcome") { popUpTo(0) { inclusive = true } }
                }
                androidx.compose.runtime.LaunchedEffect(pendingDeepLink, signedIn) {
                    val link = pendingDeepLink ?: return@LaunchedEffect
                    when (link.destination) {
                        "verify" -> {
                            nav.navigate("verify/${android.net.Uri.encode(link.token)}")
                            pendingDeepLink = null
                        }
                        "reset" -> {
                            nav.navigate("reset/${android.net.Uri.encode(link.token)}")
                            pendingDeepLink = null
                        }
                        "invite" -> {
                            if (signedIn) {
                                nav.navigate("invite/${android.net.Uri.encode(link.token)}")
                                pendingDeepLink = null
                            } else {
                                nav.navigate("login")
                            }
                        }
                    }
                }
                val currentEntry by nav.currentBackStackEntryAsState()
                androidx.compose.runtime.LaunchedEffect(currentEntry, signedIn) {
                    val route = currentEntry?.destination?.route ?: return@LaunchedEffect
                    val role = tokens.userRole()
                    if (signedIn && role in setOf("GUARDIAN", "RESPONDER")) {
                        val common = route == "profile" || route == "privacy" || route == "devices" || route.startsWith("legal/") || route.startsWith("invite/") || route.startsWith("verify") || route.startsWith("reset")
                        if (!common && route != roleHome()) nav.navigate(roleHome()) { popUpTo(0) { inclusive = true } }
                    }
                }
                NavHost(nav, startDestination = start) {
                    composable("welcome") {
                        WelcomeScreen(
                            onRegister = { nav.navigate("register") },
                            onLogin = { nav.navigate("login") },
                            onPrivacy = { nav.navigate("legal/privacy") },
                            onTerms = { nav.navigate("legal/terms") },
                            onHelp = { nav.navigate("legal/help") },
                            onSafety = { nav.navigate("legal/safety") },
                        )
                    }
                    composable("legal/privacy") { LegalPage("Privacy Policy", privacyCopy()) { nav.popBackStack() } }
                    composable("legal/terms") { LegalPage("Terms of Use", termsCopy()) { nav.popBackStack() } }
                    composable("legal/help") { LegalPage("How Guardian Works", helpCopy()) { nav.popBackStack() } }
                    composable("legal/safety") { LegalPage("Safety Disclaimer", safetyCopy()) { nav.popBackStack() } }
                    composable("register") {
                        RegisterScreen(
                            onDone = { afterAuth() },
                            onBack = { nav.popBackStack() },
                            onTerms = { nav.navigate("legal/terms") },
                            onPrivacy = { nav.navigate("legal/privacy") },
                        )
                    }
                    composable("login") {
                        LoginScreen(
                            onDone = { afterAuth() },
                            onBack = { nav.popBackStack() },
                            onForgot = { nav.navigate("forgot") },
                            onReset = { nav.navigate("reset") },
                            onVerify = { nav.navigate("verify") },
                        )
                    }
                    composable("forgot") { ForgotPasswordScreen(onBack = { nav.popBackStack() }) }
                    composable("reset") { ResetPasswordScreen(onDone = { nav.navigate("login") }, onBack = { nav.popBackStack() }) }
                    composable(
                        "reset/{token}",
                        arguments = listOf(navArgument("token") { type = NavType.StringType }),
                    ) { entry ->
                        ResetPasswordScreen(
                            initialToken = android.net.Uri.decode(entry.arguments?.getString("token").orEmpty()),
                            onDone = { nav.navigate("login") },
                            onBack = { nav.popBackStack() },
                        )
                    }
                    composable("verify") { VerifyEmailScreen(onBack = { nav.popBackStack() }) }
                    composable(
                        "verify/{token}",
                        arguments = listOf(navArgument("token") { type = NavType.StringType }),
                    ) { entry ->
                        VerifyEmailScreen(
                            initialToken = android.net.Uri.decode(entry.arguments?.getString("token").orEmpty()),
                            onBack = { nav.popBackStack() },
                        )
                    }
                    composable(
                        "invite/{token}",
                        arguments = listOf(navArgument("token") { type = NavType.StringType }),
                    ) { entry ->
                        AcceptGuardianInviteScreen(
                            token = android.net.Uri.decode(entry.arguments?.getString("token").orEmpty()),
                            onAccepted = {
                                nav.navigate("guardian-home") {
                                    popUpTo("invite/{token}") { inclusive = true }
                                }
                            },
                            onCancel = { nav.navigate(roleHome()) },
                        )
                    }
                    composable("onboarding") {
                        OnboardingScreen(onDone = { nav.navigate("home") { popUpTo("onboarding") { inclusive = true } } })
                    }
                    composable("guardian-home") {
                        ProductionGuardianHomeScreen(
                            onProfile = { nav.navigate("profile") },
                            onSignedOut = { signOut() },
                        )
                    }
                    composable("responder-home") {
                        ProductionResponderHomeScreen(
                            onProfile = { nav.navigate("profile") },
                        )
                    }
                    composable("home") {
                        HomeScreen(
                            onHistory = { nav.navigate("activity") },
                            onSettings = { nav.navigate("protect") },
                            onProtect = { nav.navigate("protect") },
                            onGuardians = { nav.navigate("guardians") },
                            onProfile = { nav.navigate("profile") },
                            onActiveIncident = { nav.navigate("active") },
                            onAllowLocation = { locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION) },
                            onAllowNotifications = {
                                if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                            },
                            onFixVolume = { nav.navigate("volume") },
                            onFixSafeWord = { nav.navigate("safeword") },
                            onFixGuardian = { nav.navigate("guardians") },
                            onFixDevice = { nav.navigate("devices") },
                        )
                    }
                    composable("activity") {
                        HistoryScreen(
                            onHome = { nav.popBackStack("home", false) },
                            onSettings = { nav.navigate("protect") },
                            onProtect = { nav.navigate("protect") },
                            onGuardians = { nav.navigate("guardians") },
                            onProfile = { nav.navigate("profile") },
                        )
                    }
                    composable("protect") {
                        SettingsScreen(
                            onHome = { nav.popBackStack("home", false) },
                            onHistory = { nav.navigate("activity") },
                            onGuardians = { nav.navigate("guardians") },
                            onProfile = { nav.navigate("profile") },
                            onSignedOut = { signOut() },
                            onVolume = { nav.navigate("volume") },
                            onSafeWord = { nav.navigate("safeword") },
                            onJourney = { nav.navigate("journey") },
                            onDuress = { nav.navigate("duress") },
                        )
                    }
                    composable("volume") { VolumeSosPage(onBack = { nav.popBackStack() }) }
                    composable("safeword") { SafeWordPage(onBack = { nav.popBackStack() }) }
                    composable("journey") { JourneyPage(onBack = { nav.popBackStack() }) }
                    composable("duress") { DuressPage(onBack = { nav.popBackStack() }) }
                    composable("emergency-profile") { EmergencyProfilePage(onBack = { nav.popBackStack() }) }
                    composable("devices") { DevicesPage(onBack = { nav.popBackStack() }) }
                    composable("privacy") { PrivacyPage(onBack = { nav.popBackStack() }, onSignedOut = { signOut() }) }
                    composable("guardians") {
                        GuardiansScreen(
                            onHome = { nav.popBackStack("home", false) },
                            onProtect = { nav.navigate("protect") },
                            onActivity = { nav.navigate("activity") },
                            onProfile = { nav.navigate("profile") },
                        )
                    }
                    composable("profile") {
                        when (tokens.userRole()) {
                            "GUARDIAN" -> GuardianAccountScreen(
                                onHome = { nav.navigate("guardian-home") { popUpTo("guardian-home") { inclusive = false } } },
                                onPrivacy = { nav.navigate("privacy") },
                                onHelp = { nav.navigate("legal/help") },
                                onSignedOut = { signOut() },
                            )
                            "RESPONDER" -> ResponderAccountScreen(
                                onHome = { nav.navigate("responder-home") { popUpTo("responder-home") { inclusive = false } } },
                                onPrivacy = { nav.navigate("privacy") },
                                onHelp = { nav.navigate("legal/help") },
                                onSignedOut = { signOut() },
                            )
                            else -> ProfileScreen(
                                onHome = { nav.popBackStack("home", false) },
                                onProtect = { nav.navigate("protect") },
                                onGuardians = { nav.navigate("guardians") },
                                onActivity = { nav.navigate("activity") },
                                onSignedOut = { signOut() },
                                onEmergencyProfile = { nav.navigate("emergency-profile") },
                                onDevices = { nav.navigate("devices") },
                                onPrivacy = { nav.navigate("privacy") },
                                onHelp = { nav.navigate("legal/help") },
                            )
                        }
                    }
                    composable("active") {
                        ActiveIncidentScreen(onBack = { nav.popBackStack() })
                    }
                }
            }
        }
    }
}
