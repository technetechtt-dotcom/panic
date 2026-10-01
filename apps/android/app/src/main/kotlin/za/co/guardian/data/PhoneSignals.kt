package za.co.guardian.data

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import za.co.guardian.core.DeviceState
import za.co.guardian.core.GeoPoint
import za.co.guardian.core.NetworkClass
import za.co.guardian.core.batteryMode
import za.co.guardian.core.classifyNetwork
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PhoneSignals @Inject constructor(@ApplicationContext private val context: Context) {
    fun hasFineLocation(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    fun hasNotifications(): Boolean {
        if (android.os.Build.VERSION.SDK_INT < 33) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    fun locationManager(): LocationManager = context.getSystemService(LocationManager::class.java)

    fun deviceState(): DeviceState {
        val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
        val percent = if (level >= 0 && scale > 0) (level * 100) / scale else null
        val charging = battery?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) == BatteryManager.BATTERY_STATUS_CHARGING
        val network = networkClass()
        return DeviceState(
            batteryLevel = percent,
            charging = charging,
            networkType = network.name,
            batteryMode = percent?.let { batteryMode(it).name } ?: "NORMAL",
        )
    }

    fun freshAndLastKnown(): Pair<GeoPoint?, GeoPoint?> {
        val location = newestLocation() ?: return null to null
        val point = toPoint(location)
        val age = System.currentTimeMillis() - location.time
        return if (age <= 120_000) point to null else null to point
    }

    fun toPoint(location: Location): GeoPoint {
        val source = if (location.provider == LocationManager.GPS_PROVIDER) "GPS" else "NETWORK"
        return GeoPoint(
            latitude = location.latitude,
            longitude = location.longitude,
            accuracy = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
            speed = if (location.hasSpeed()) location.speed.toDouble() else null,
            heading = if (location.hasBearing()) location.bearing.toDouble() else null,
            altitude = if (location.hasAltitude()) location.altitude else null,
            recordedAt = timestamp(location.time),
            source = source,
        )
    }

    fun timestamp(epochMs: Long = System.currentTimeMillis()): String = ISO.format(Instant.ofEpochMilli(epochMs))

    private fun newestLocation(): Location? {
        if (!hasFineLocation()) return null
        val manager = locationManager()
        return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).mapNotNull { provider ->
            try {
                manager.getLastKnownLocation(provider)
            } catch (_: SecurityException) {
                null
            }
        }.maxByOrNull { it.time }
    }

    private fun networkClass(): NetworkClass {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val network = manager.activeNetwork
        val capabilities = manager.getNetworkCapabilities(network)
        return classifyNetwork(
            connected = network != null,
            validated = capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true,
            wifi = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true,
            cellular = capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true,
        )
    }

    private companion object {
        val ISO: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)
    }
}
