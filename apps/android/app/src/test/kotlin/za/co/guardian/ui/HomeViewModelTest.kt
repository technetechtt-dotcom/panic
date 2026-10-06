package za.co.guardian.ui

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import za.co.guardian.core.DistressCapsule
import za.co.guardian.core.IncidentState
import za.co.guardian.core.LocalIncident
import za.co.guardian.core.ProtectionHealth
import za.co.guardian.core.ProtectionLevel
import za.co.guardian.core.SyncState
import za.co.guardian.data.PracticeModeReader
import za.co.guardian.data.ProtectionStatusSource
import za.co.guardian.core.TriggerType
import za.co.guardian.data.SosActions
import za.co.guardian.data.SosOutcome

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {
    private val dispatcher = UnconfinedTestDispatcher()

    @Before fun setUp() = Dispatchers.setMain(dispatcher)
    @After fun tearDown() = Dispatchers.resetMain()

    @Test fun practiceSosIsStoredForLaterUpload() {
        val actions = FakeSos(isTest = true, tracking = false, sync = SyncState.PENDING)
        val viewModel = HomeViewModel(actions, FakeHealth(), FakePractice())
        viewModel.sendSos()
        assertTrue(actions.called)
        assertEquals(true, viewModel.active.value?.isTest)
        assertTrue(viewModel.message.value!!.contains("saved on this phone"))
    }

    @Test fun signedOutSosDoesNotCreateAnIncident() {
        val actions = FakeSos(outcome = SosOutcome.NeedSignIn)
        val viewModel = HomeViewModel(actions, FakeHealth(), FakePractice())
        viewModel.sendSos()
        assertEquals("Sign in before sending SOS.", viewModel.message.value)
        assertEquals(null, viewModel.active.value)
    }
}

private class FakeSos(
    private val isTest: Boolean = false,
    private val tracking: Boolean = true,
    private val sync: SyncState = SyncState.SYNCED,
    private val outcome: SosOutcome? = null,
) : SosActions {
    var called = false
    override suspend fun send(type: TriggerType, origin: za.co.guardian.core.MonitoringOrigin): SosOutcome {
        called = true
        outcome?.let { return it }
        return SosOutcome.Started(
            LocalIncident(
                triggerId = "t",
                correlationId = "c",
                serverId = null,
                userId = "u",
                deviceId = "d",
                state = IncidentState.SOS,
                isTest = isTest,
                syncState = sync,
                createdAtEpochMs = 0,
                capsule = DistressCapsule(
                    timestamp = "2026-10-01T09:00:00.000Z",
                    latitude = null,
                    longitude = null,
                    locationAccuracy = null,
                    speed = null,
                    heading = null,
                    batteryLevel = 80,
                    chargingStatus = false,
                    networkType = "CELLULAR",
                    protectionMode = "NORMAL",
                    duress = false,
                    lastKnownLocation = null,
                    appProtectionStatus = "LIMITED_PROTECTION",
                ),
                lastError = null,
            ),
            tracking,
        )
    }
}

private class FakeHealth : ProtectionStatusSource {
    override fun current() = ProtectionHealth(ProtectionLevel.LIMITED_PROTECTION, emptyList())
}

private class FakePractice : PracticeModeReader {
    override fun enabled() = true
}
