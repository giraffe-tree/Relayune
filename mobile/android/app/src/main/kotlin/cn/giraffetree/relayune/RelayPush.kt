package cn.giraffetree.relayune

import android.app.Activity
import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationManagerCompat
import cn.jpush.android.api.JPushInterface
import cn.jpush.android.api.NotificationMessage
import cn.jpush.android.data.JPushCollectControl
import cn.jpush.android.service.JPushMessageReceiver
import cn.jpush.android.service.JCommonService
import io.flutter.plugin.common.MethodChannel

/** No SDK initialization until the user enabled task notifications after pairing. */
class RelayuneApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (RelayPush.enabled(this)) RelayPush.start(this)
    }
}

object RelayPush {
    private const val PREFS = "relayune_push_settings"
    private var started = false
    private var active = false
    var foreground = false
    var channel: MethodChannel? = null

    fun enabled(context: Context): Boolean = BuildConfig.JPUSH_CONFIGURED &&
        consented(context) &&
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("enabled", false) &&
        NotificationManagerCompat.from(context).areNotificationsEnabled()

    fun consented(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getBoolean("consented", false)

    fun consent(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("consented", true).apply()
    }

    fun configure(context: Context, enable: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putBoolean("enabled", enable).apply()
        if (enable && enabled(context)) start(context)
        else if (started) {
            active = false
            JPushInterface.stopPush(context)
            JPushInterface.clearAllNotifications(context)
        }
    }

    fun start(context: Context) {
        if (!enabled(context) || active) return
        if (Build.VERSION.SDK_INT >= 26) {
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(NotificationChannel("relayune_remote_activity",
                    "Relayune · Task activity", NotificationManager.IMPORTANCE_DEFAULT))
        }
        if (!started) {
            JPushInterface.setDebugMode(false)
            JPushInterface.setStatisticsEnable(false)
            JPushInterface.setDataInsightsEnable(context, false)
            JPushInterface.setGeofenceEnable(context, false)
            JPushInterface.setSmartPushEnable(context, false)
            JPushInterface.setLinkMergeEnable(context, false)
            JPushInterface.setCollectControl(context, JPushCollectControl.Builder()
                .imei(false).mac(false).ssid(false).bssid(false).cell(false).imsi(false).wifi(false).build())
            JPushInterface.init(context)
            started = true
        }
        active = true
        JPushInterface.resumePush(context)
    }

    fun registration(context: Context): String? = if (enabled(context) && started)
        JPushInterface.getRegistrationID(context)?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{8,128}")) }
        else null

    fun notifyRegistration() {
        Handler(Looper.getMainLooper()).post { channel?.invokeMethod("registrationChanged", null) }
    }

    fun open(context: Context) {
        // Push-provided URLs, session ids and actions are never executed. The
        // authenticated app refreshes its own encrypted inbox after opening.
        context.startActivity(Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        })
    }
}

class RelayPushReceiver : JPushMessageReceiver() {
    override fun onRegister(context: Context, registrationId: String) { RelayPush.notifyRegistration() }
    override fun onConnected(context: Context, isConnected: Boolean) {
        if (isConnected) RelayPush.notifyRegistration()
    }
    override fun isNeedShowNotification(context: Context, message: NotificationMessage, source: String): Boolean =
        RelayPush.enabled(context) && !RelayPush.foreground
    override fun onNotifyMessageOpened(context: Context, message: NotificationMessage) { RelayPush.open(context) }
}

/** Explicit landing activity for manufacturer notifications; never trust extras. */
class PushOpenActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        RelayPush.open(this)
        finish()
    }
}

/** Required JCore service; SDK initialization is still gated by consent. */
class RelayPushService : JCommonService()
