package za.co.guardian.data

import android.os.Build
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path
import za.co.guardian.BuildConfig
import za.co.guardian.core.DistressCapsule
import za.co.guardian.core.IncidentRemoteApi
import za.co.guardian.core.LocalIncident
import za.co.guardian.core.OfflineIncidentRepository
import za.co.guardian.core.RemoteCreateResult
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Serializable
data class RegisterBody(
    val email: String,
    val password: String,
    val displayName: String,
    val acceptedSafetyConsent: Boolean,
)

@Serializable
data class LoginBody(val email: String, val password: String)

@Serializable
data class RefreshBody(val refreshToken: String)

@Serializable
data class UserWire(val id: String, val email: String, val displayName: String, val role: String)

@Serializable
data class AuthWire(
    val accessToken: String,
    val refreshToken: String,
    val user: UserWire,
)

@Serializable
data class AuthEnvelope(val data: AuthWire)

@Serializable
data class DeviceBody(
    val devicePublicId: String,
    val platform: String,
    val manufacturer: String,
    val model: String,
    val osVersion: String,
    val appVersion: String,
    @OptIn(ExperimentalSerializationApi::class) @EncodeDefault(EncodeDefault.Mode.NEVER) val publicKey: String? = null,
)

@Serializable
data class DeviceWire(val id: String)

@Serializable
data class DeviceEnvelope(val data: DeviceWire)

@Serializable
data class EmergencyCredentialBody(val deviceId: String)

@Serializable
data class EmergencyCredentialWire(val credential: String)

@Serializable
data class EmergencyCredentialEnvelope(val data: EmergencyCredentialWire)

@Serializable
data class DeviceProofBody(val algorithm: String, val signature: String, val signedAt: String)

@Serializable
data class CreateIncidentBody(
    val triggerId: String,
    val correlationId: String,
    val triggerType: String,
    val deviceId: String,
    val isTest: Boolean,
    val distressCapsule: DistressCapsule,
    @OptIn(ExperimentalSerializationApi::class) @EncodeDefault(EncodeDefault.Mode.NEVER) val deviceProof: DeviceProofBody? = null,
    @OptIn(ExperimentalSerializationApi::class) @EncodeDefault(EncodeDefault.Mode.NEVER) val metadata: Map<String, String>? = null,
)

@Serializable
data class IncidentWire(
    val id: String,
    val state: String,
    val isTest: Boolean,
    val duress: Boolean = false,
    val userDisplayName: String = "",
)

@Serializable
data class IncidentListEnvelope(val data: List<IncidentWire>)

@Serializable
data class ResponderStatusBody(val status: String)

@Serializable
data class IncidentEnvelope(val data: IncidentWire, val replayed: Boolean = false, val escalated: Boolean = false)

@Serializable
data class LocationPointBody(
    val clientPointId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Double?,
    val speed: Double?,
    val bearing: Double?,
    val altitude: Double?,
    val recordedAt: String,
    val source: String,
)

@Serializable
data class LocationBatchBody(val points: List<LocationPointBody>)

@Serializable
data class HeartbeatBody(
    val clientHeartbeatId: String,
    val recordedAt: String,
    val latitude: Double?,
    val longitude: Double?,
    val accuracy: Double?,
    val speed: Double?,
    val heading: Double?,
    val batteryLevel: Int?,
    val charging: Boolean,
    val networkType: String,
    val deviceOnline: Boolean,
    val evidenceStatus: String,
    val permissionsStatus: String,
    val batteryMode: String,
)

@Serializable
data class HealthWire(val status: String)

@Serializable
data class HealthEnvelope(val data: HealthWire)

interface GuardianApi {
    @POST("auth/register")
    suspend fun register(@Body body: RegisterBody): AuthEnvelope

    @POST("auth/login")
    suspend fun login(@Body body: LoginBody): AuthEnvelope

    @POST("auth/refresh")
    suspend fun refresh(@Body body: RefreshBody): AuthEnvelope

    @POST("auth/logout")
    suspend fun logout(@Body body: RefreshBody)

    @POST("devices")
    suspend fun registerDevice(@Body body: DeviceBody): DeviceEnvelope

    @POST("devices/emergency-credential")
    suspend fun emergencyCredential(@Body body: EmergencyCredentialBody): EmergencyCredentialEnvelope

    @POST("incidents")
    suspend fun createIncident(@Body body: CreateIncidentBody): IncidentEnvelope

    @GET("incidents/{id}")
    suspend fun incident(@Path("id") id: String): IncidentEnvelope

    @GET("incidents")
    suspend fun incidents(): IncidentListEnvelope

    @POST("incidents/{id}/responder-status")
    suspend fun responderStatus(@Path("id") id: String, @Body body: ResponderStatusBody)

    @POST("incidents/{id}/locations")
    suspend fun locations(@Path("id") id: String, @Body body: LocationBatchBody)

    @POST("incidents/{id}/heartbeats")
    suspend fun heartbeat(@Path("id") id: String, @Body body: HeartbeatBody)

    @GET("health")
    suspend fun health(): HealthEnvelope

    @POST("guardians")
    suspend fun addGuardian(@Body body: GuardianBody): GuardianEnvelope

    @POST("journeys")
    suspend fun startJourney(@Body body: JourneyBody): JourneyEnvelope

    @POST("users/me/profile")
    suspend fun saveProfile(@Body body: ProfileBody)

    @POST("protection/signals")
    suspend fun signals(@Body body: SignalBody)

    @POST("journeys/{id}/check-in")
    suspend fun checkIn(@Path("id") id: String): JourneyEnvelope

    @POST("safety-pins")
    suspend fun setPins(@Body body: PinBody)

    @POST("incidents/{id}/cancel")
    suspend fun cancel(@Path("id") id: String, @Body body: CancelBody): CancelEnvelope

    @POST("incidents/{id}/evidence")
    suspend fun evidence(@Path("id") id: String, @Body body: EvidenceBody)
}

@Serializable
data class GuardianBody(
    val displayName: String,
    val canViewLocation: Boolean = false,
    val canViewEvidence: Boolean = false,
    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
    @EncodeDefault(EncodeDefault.Mode.NEVER) val phone: String? = null,
)

@Serializable
data class GuardianWire(val id: String, val displayName: String)

@Serializable
data class GuardianEnvelope(val data: GuardianWire)

@Serializable
data class JourneyBody(
    val destinationLabel: String,
    val expectedArrivalAt: String,
    val checkInIntervalSeconds: Int,
    val mode: String = "WALK",
)

@Serializable
data class ProfileBody(
    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class) @EncodeDefault(EncodeDefault.Mode.NEVER) val bloodType: String? = null,
    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class) @EncodeDefault(EncodeDefault.Mode.NEVER) val allergies: String? = null,
    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class) @EncodeDefault(EncodeDefault.Mode.NEVER) val medications: String? = null,
    @OptIn(kotlinx.serialization.ExperimentalSerializationApi::class) @EncodeDefault(EncodeDefault.Mode.NEVER) val notes: String? = null,
)

@Serializable
data class SignalBody(val signals: List<String>)

@Serializable
data class JourneyWire(val id: String, val status: String)

@Serializable
data class JourneyEnvelope(val data: JourneyWire)

@Serializable
data class PinBody(val cancelPin: String, val duressPin: String)

@Serializable
data class CancelBody(val pin: String)

@Serializable
data class CancelEnvelope(val data: CancelWire)

@Serializable
data class CancelWire(val appearance: String)

@Serializable
data class EvidenceBody(
    val clientChunkId: String,
    val sequence: Int,
    val sha256: String,
    val contentType: String,
    val bytesBase64: String,
)

class RetrofitIncidentApi constructor(
    private val api: GuardianApi,
    private val signer: DeviceSigner,
    private val tokens: TokenStore,
    private val settings: SettingsStore,
) : IncidentRemoteApi {
    override suspend fun create(incident: LocalIncident): RemoteCreateResult = post(incident, incident.triggerId, incident.triggerType.name)

    override suspend fun escalate(incident: LocalIncident, triggerId: String, type: za.co.guardian.core.TriggerType): RemoteCreateResult {
        return post(incident, triggerId, type.name)
    }

    private suspend fun post(incident: LocalIncident, triggerId: String, type: String): RemoteCreateResult {
        val response = api.createIncident(
            CreateIncidentBody(
                triggerId = triggerId,
                correlationId = incident.correlationId,
                triggerType = type,
                deviceId = incident.deviceId,
                isTest = incident.isTest,
                distressCapsule = incident.capsule,
                deviceProof = proof(triggerId),
                metadata = mapOf("stage" to settings.triggerStage()),
            ),
        )
        return RemoteCreateResult(response.data.id, response.replayed, response.escalated)
    }

    private fun proof(triggerId: String): DeviceProofBody? {
        if (signer.publicKeySpki() == null) return null
        val signedAt = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC).format(java.time.Instant.now())
        val signature = signer.sign(za.co.guardian.core.deviceProofMessage(triggerId, tokens.publicDeviceId(), signedAt)) ?: return null
        return DeviceProofBody("SHA256withECDSA", signature, signedAt)
    }
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun json(): Json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true }

    @Provides
    @Singleton
    fun client(tokens: TokenStore, apiHolder: RefreshApiHolder): OkHttpClient {
        val refreshClient = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
        return OkHttpClient.Builder()
            .callTimeout(20, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val token = tokens.accessToken()
                val emergency = tokens.emergencyCredential()
                val request = when {
                    !token.isNullOrBlank() -> chain.request().newBuilder().header("Authorization", "Bearer $token").build()
                    !emergency.isNullOrBlank() -> chain.request().newBuilder().header("Authorization", "Emergency $emergency").build()
                    else -> chain.request()
                }
                chain.proceed(request)
            }
            .authenticator { _, response ->
                if (response.request.header("X-Guardian-Auth-Tried") != null) return@authenticator null
                if (responseCount(response) < 2) {
                    val failed = response.request.header("Authorization")?.removePrefix("Bearer ")?.trim()
                    val renewed = if (failed.isNullOrBlank()) null else apiHolder.refresh(refreshClient, failed)
                    if (!renewed.isNullOrBlank()) {
                        return@authenticator response.request.newBuilder().header("Authorization", "Bearer $renewed").build()
                    }
                }
                val emergency = tokens.emergencyCredential() ?: return@authenticator null
                response.request.newBuilder()
                    .header("Authorization", "Emergency $emergency")
                    .header("X-Guardian-Auth-Tried", "1")
                    .build()
            }
            .build()
    }

    @Provides
    @Singleton
    fun api(client: OkHttpClient, json: Json): GuardianApi {
        return Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(GuardianApi::class.java)
    }

    @Provides
    @Singleton
    fun remote(api: GuardianApi, signer: DeviceSigner, tokens: TokenStore, settings: SettingsStore): IncidentRemoteApi =
        RetrofitIncidentApi(api, signer, tokens, settings)

    @Provides
    @Singleton
    fun repository(database: GuardianDatabase, remote: IncidentRemoteApi, json: Json): OfflineIncidentRepository {
        return OfflineIncidentRepository(
            local = RoomIncidentStore(database.incidents(), json),
            remote = remote,
            newId = { UUID.randomUUID().toString() },
            now = { System.currentTimeMillis() },
            timestamp = { epoch -> ISO.format(Instant.ofEpochMilli(epoch)) },
            escalations = RoomEscalationStore(database.escalations()),
        )
    }

    private fun responseCount(response: okhttp3.Response): Int {
        var current: okhttp3.Response? = response
        var count = 1
        while (current?.priorResponse != null) {
            count += 1
            current = current.priorResponse
        }
        return count
    }

    private val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
        .withZone(ZoneOffset.UTC)
}

@Singleton
class RefreshApiHolder @javax.inject.Inject constructor(private val json: Json, private val tokens: TokenStore) {
    private val gate = Any()

    fun refresh(client: OkHttpClient, failedAccess: String?): String? {
        synchronized(gate) {
            val current = tokens.accessToken()
            if (!current.isNullOrBlank() && current != failedAccess) return current
            val refreshToken = tokens.refreshToken() ?: return null
            return try {
                val retrofit = Retrofit.Builder()
                    .baseUrl(BuildConfig.API_BASE_URL)
                    .client(client)
                    .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                    .build()
                val api = retrofit.create(GuardianApi::class.java)
                val body = kotlinx.coroutines.runBlocking { api.refresh(RefreshBody(refreshToken)).data }
                tokens.saveSession(body.accessToken, body.refreshToken, body.user.id)
                tokens.setUserRole(body.user.role)
                body.accessToken
            } catch (_: Exception) {
                null
            }
        }
    }
}
