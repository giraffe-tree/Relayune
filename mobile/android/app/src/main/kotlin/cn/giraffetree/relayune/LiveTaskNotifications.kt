package cn.giraffetree.relayune

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.security.MessageDigest
import java.text.DateFormat
import java.util.Date

/** System templates preserve accessibility, OEM compatibility and user control.
 * No foreground service or exact alarm is used to keep a remote task alive.
 */
class LiveTaskNotifications(private val context: Context) {
    companion object {
        private const val CHANNEL = "relayune_live_tasks"
        private const val GROUP = "cn.giraffetree.relayune.live"
        private const val PREFS = "relayune_live_task_dismissals"
        private const val KEY = "liveTaskKey"
        private const val SESSION = "liveTaskSession"
        private val MINT = Color.rgb(105, 225, 210)
        private val AMBER = Color.rgb(247, 201, 130)
        private val MUTED = Color.rgb(166, 181, 189)

        private fun hash(value: String): String = MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray()).joinToString("") { "%02x".format(it.toInt() and 0xff) }

        fun rememberDismissal(context: Context, intent: Intent) {
            val key = intent.getStringExtra(KEY) ?: return
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val keys = (prefs.getStringSet("keys", emptySet()) ?: emptySet()).toMutableSet()
            keys.add(key)
            prefs.edit().putStringSet("keys", keys.toList().takeLast(256).toSet()).apply()
        }
    }

    fun update(data: Map<*, *>) {
        fun text(key: String) = (data[key] as? String ?: "").take(100)
        fun time(key: String) = (data[key] as? Number)?.toLong()
        val session = data["sessionId"] as? String ?: return
        val turn = data["turnId"] as? String ?: return
        val key = hash("$session\u0000$turn")
        val sessionKey = hash(session)
        val id = sessionKey.take(7).toInt(16)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val state = text("state")
        val waiting = state == "approval" || state == "question"
        // Normal running/terminal events already have their own notification
        // policy. Keep this surface only for a pending action, and cancel its
        // previous card when work resumes, finishes, or loses freshness.
        if (!waiting) {
            manager.cancel(id)
            manager.cancel(VivoAtomicNotification.TAG, id)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val ids = (prefs.getStringSet("ids", emptySet()) ?: emptySet()).toMutableSet()
            ids.remove(id.toString())
            prefs.edit().putStringSet("ids", ids).remove("atomic.$id").remove("revision.$id").apply()
            return
        }
        val compat = NotificationManagerCompat.from(context)
        if (!compat.areNotificationsEnabled()) return
        val dismissed = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet("keys", emptySet()) ?: emptySet()
        if (key in dismissed) return
        val finished = time("finishedAt")
        val live = data["foreground"] == true && data["connected"] == true && state != "stale"
        val updated = time("updatedAt") ?: System.currentTimeMillis()
        val stamp = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(updated))
        // The sync timestamp remains visible even if Android freezes/kills Dart.
        // A background card shows a snapshot, never an unverified live spinner.
        val subtitle = "${text("provider")} · ${text("updatedLabel")} $stamp"
        val color = when {
            state == "stale" || state == "stopped" -> MUTED
            waiting || state == "failed" -> AMBER
            else -> MINT
        }
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL,
                "Relayune · Live tasks", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Ongoing task status"
                setShowBadge(false)
            })
        }
        val uri = Uri.Builder().scheme("relayune").authority("task")
            .appendQueryParameter("session", session).build()
        val open = PendingIntent.getActivity(context, id,
            Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val dismiss = PendingIntent.getBroadcast(context, id,
            Intent(context, LiveTaskDismissReceiver::class.java).apply {
                action = "$GROUP.dismiss.$sessionKey"
                putExtra(KEY, key)
            }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val title = text("statusLabel")
        val body = text("title")
        val extras = Bundle().apply {
            putString("liveTaskState", state)
            putString(KEY, key)
            putString(SESSION, sessionKey)
        }
        val builder = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(color)
            .setContentTitle(title)
            .setContentText(body)
            .setSubText(subtitle)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body).setSummaryText(subtitle))
            .setOngoing(finished == null)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setAutoCancel(finished != null)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setCategory(if (finished == null) NotificationCompat.CATEGORY_PROGRESS else NotificationCompat.CATEGORY_STATUS)
            .setGroup(GROUP)
            .setContentIntent(open)
            .setDeleteIntent(dismiss)
            .addAction(0, text("actionLabel"), open)
            .addExtras(extras)
        if (live && finished == null && state == "running" && data["startKnown"] != false) {
            builder.setWhen(time("startedAt") ?: updated).setUsesChronometer(true).setShowWhen(true)
        } else {
            builder.setWhen(updated).setUsesChronometer(false).setShowWhen(false)
        }
        if (finished != null) builder.setTimeoutAfter(120_000)
        // Public platform extra used by NotificationCompat 1.17 as well. The
        // platform setter was added in 36.1; using its documented extra avoids
        // calling it on the base Android 16 SDK or changing the app's toolchain.
        if (Build.VERSION.SDK_INT >= 36 && finished == null && data["connected"] == true && state != "stale") {
            builder.extras.putBoolean("android.requestPromotedOngoing", true)
            builder.extras.putString("android.shortCriticalText", title.take(6))
        }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val atomicKey = "atomic.$id"
        val priorAtomic = prefs.getString(atomicKey, null)
        val atomic = VivoAtomicNotification.available(context)
        if (!atomic && priorAtomic != null) {
            manager.cancel(VivoAtomicNotification.TAG, id)
            prefs.edit().remove(atomicKey).remove("revision.$id").apply()
        }
        if (atomic && (finished == null || priorAtomic == key)) {
            val revision = prefs.getInt("revision.$id", 0).let { if (it == Int.MAX_VALUE) 1 else it + 1 }
            if (priorAtomic != null && priorAtomic != key) {
                manager.cancel(VivoAtomicNotification.TAG, id)
                manager.cancel(id)
            }
            builder.addExtras(VivoAtomicNotification.extras(context, BuildConfig.VIVO_ATOMIC_SCENE,
                if (finished != null) 2 else if (priorAtomic == key) 1 else 0,
                revision, title, body, subtitle, text("actionLabel"), color, open))
            prefs.edit().putString(atomicKey, key).putInt("revision.$id", revision).apply()
        }
        val notification = builder.build()
        val ids = (prefs.getStringSet("ids", emptySet()) ?: emptySet()).toMutableSet()
        ids.add(id.toString())
        prefs.edit().putStringSet("ids", ids).apply()
        compat.notify(id, notification)
    }

    fun clearLegacyRunning() {
        if (Build.VERSION.SDK_INT < 23) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.activeNotifications.filter {
            it.notification.group == GROUP &&
                it.notification.extras.getString("liveTaskState") !in setOf("approval", "question")
        }.forEach {
            manager.cancel(it.tag, it.id)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .remove("atomic.${it.id}").remove("revision.${it.id}").apply()
        }
    }

    fun clear() {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getStringSet("ids", emptySet())?.forEach { value -> value.toIntOrNull()?.let { id ->
            manager.cancel(id)
            manager.cancel(VivoAtomicNotification.TAG, id)
            prefs.edit().remove("atomic.$id").remove("revision.$id").apply()
        } }
        prefs.edit().remove("ids").apply()
        if (Build.VERSION.SDK_INT >= 23) {
            manager.activeNotifications.filter { it.notification.group == GROUP }
                .forEach { manager.cancel(it.id) }
        }
    }
}

class LiveTaskDismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        LiveTaskNotifications.rememberDismissal(context, intent)
    }
}
