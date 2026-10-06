package za.co.guardian

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.AndroidEntryPoint
import za.co.guardian.data.EmergencyServiceController
import za.co.guardian.data.PhoneSignals
import za.co.guardian.data.SettingsStore
import za.co.guardian.data.TokenStore
import za.co.guardian.ui.GuardianTheme
import za.co.guardian.ui.OnboardingScreen
import za.co.guardian.ui.HistoryScreen
import za.co.guardian.ui.HomeScreen
import za.co.guardian.ui.LoginScreen
import za.co.guardian.ui.RegisterScreen
import za.co.guardian.ui.SettingsScreen
import za.co.guardian.ui.WelcomeScreen
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    @Inject lateinit var tokens: TokenStore
    @Inject lateinit var settings: SettingsStore
    @Inject lateinit var signals: PhoneSignals
    @Inject lateinit var controller: EmergencyServiceController

    private var signedIn by mutableStateOf(false)
    private val locationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        signedIn = tokens.accessToken() != null
        if (intent.getBooleanExtra("resume", false) && settings.incidentActive() && signals.hasFineLocation()) {
            controller.start()
        }
        setContent {
            GuardianTheme {
                val nav = rememberNavController()
                NavHost(nav, startDestination = if (signedIn) "home" else "welcome") {
                    composable("welcome") {
                        WelcomeScreen(onRegister = { nav.navigate("register") }, onLogin = { nav.navigate("login") })
                    }
                    composable("register") {
                        RegisterScreen(onDone = { signedIn = true; nav.navigate("onboarding") { popUpTo("welcome") { inclusive = true } } }, onBack = { nav.popBackStack() })
                    }
                    composable("login") {
                        LoginScreen(onDone = { signedIn = true; nav.navigate("home") { popUpTo("welcome") { inclusive = true } } }, onBack = { nav.popBackStack() })
                    }
                    composable("onboarding") {
                        OnboardingScreen(onDone = { nav.navigate("home") { popUpTo("onboarding") { inclusive = true } } })
                    }
                    composable("home") {
                        HomeScreen(
                            onHistory = { nav.navigate("history") },
                            onSettings = { nav.navigate("settings") },
                            onAllowLocation = { locationPermission.launch(Manifest.permission.ACCESS_FINE_LOCATION) },
                            onAllowNotifications = {
                                if (Build.VERSION.SDK_INT >= 33) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                            },
                        )
                    }
                    composable("history") {
                        HistoryScreen(onHome = { nav.popBackStack("home", false) }, onSettings = { nav.navigate("settings") })
                    }
                    composable("settings") {
                        SettingsScreen(
                            onHome = { nav.popBackStack("home", false) },
                            onHistory = { nav.navigate("history") },
                            onSignedOut = {
                                signedIn = false
                                nav.navigate("welcome") { popUpTo(0) { inclusive = true } }
                            },
                        )
                    }
                }
            }
        }
    }
}
