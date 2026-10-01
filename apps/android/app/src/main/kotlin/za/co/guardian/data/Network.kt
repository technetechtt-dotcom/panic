package za.co.guardian.data

import android.os.Build
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
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
)

@Serializable
data class DeviceWire(val id: String)

@Serializable
data class DeviceEnvelope(val data: DeviceWire)

@Serializable
data class CreateIncidentBody(
    val triggerId: String,
    val correlationId: String,
    val triggerType: String,
    val deviceId: String,
    val isTest: Boolean,
    val distressCapsule: DistressCapsule,
)

@Serializable
data class IncidentWire(val id: String, val state: String, val isTest: Boolean)

@Serializable
data class IncidentEnvelope(val data: IncidentWire, val replayed: Boolean = false)

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

    @POST("incidents")
    suspend fun createIncident(@Body body: CreateIncidentBody): IncidentEnvelope

    @GET("incidents/{id}")
    suspend fun incident(@Path("id") id: String): IncidentEnvelope

    @POST("incidents/{id}/locations")
    suspend fun locations(@Path("id") id: String, @Body body: LocationBatchBody)

    @POST("incidents/{id}/heartbeats")
    suspend fun heartbeat(@Path("id") id: String, @Body body: HeartbeatBody)

    @GET("health")
    suspend fun health(): HealthEnvelope
}

class RetrofitIncidentApi constructor(
    private val api: GuardianApi,
) : IncidentRemoteApi {
    override suspend fun create(incident: LocalIncident): RemoteCreateResult {
        val response = api.createIncident(
            CreateIncidentBody(
                triggerId = incident.triggerId,
                correlationId = incident.correlationId,
                triggerType = "MANUAL_SOS",
                deviceId = incident.deviceId,
                isTest = incident.isTest,
                distressCapsule = incident.capsule,
            ),
        )
        return RemoteCreateResult(response.data.id, response.replayed)
    }
}

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun json(): Json = Json { ignoreUnknownKeys = true }

    @Provides
    @Singleton
    fun client(tokens: TokenStore, apiHolder: RefreshApiHolder): OkHttpClient {
        val refreshClient = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build()
        return OkHttpClient.Builder()
            .callTimeout(20, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                val token = tokens.accessToken()
                val request = if (token.isNullOrBlank()) {
                    chain.request()
                } else {
                    chain.request().newBuilder().header("Authorization", "Bearer $token").build()
                }
                chain.proceed(request)
            }
            .authenticator { _, response ->
                if (responseCount(response) >= 2) return@authenticator null
                val refresh = tokens.refreshToken() ?: return@authenticator null
                val renewed = apiHolder.refresh(refreshClient, refresh) ?: return@authenticator null
                response.request.newBuilder().header("Authorization", "Bearer $renewed").build()
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
    fun remote(api: GuardianApi): IncidentRemoteApi = RetrofitIncidentApi(api)

    @Provides
    @Singleton
    fun repository(database: GuardianDatabase, remote: IncidentRemoteApi, json: Json): OfflineIncidentRepository {
        return OfflineIncidentRepository(
            local = RoomIncidentStore(database.incidents(), json),
            remote = remote,
            newId = { UUID.randomUUID().toString() },
            now = { System.currentTimeMillis() },
            timestamp = { epoch -> ISO.format(Instant.ofEpochMilli(epoch)) },
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
    fun refresh(client: OkHttpClient, refreshToken: String): String? {
        return try {
            val retrofit = Retrofit.Builder()
                .baseUrl(BuildConfig.API_BASE_URL)
                .client(client)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
            val api = retrofit.create(GuardianApi::class.java)
            val body = kotlinx.coroutines.runBlocking { api.refresh(RefreshBody(refreshToken)).data }
            tokens.saveSession(body.accessToken, body.refreshToken, body.user.id)
            body.accessToken
        } catch (_: Exception) {
            null
        }
    }
}
