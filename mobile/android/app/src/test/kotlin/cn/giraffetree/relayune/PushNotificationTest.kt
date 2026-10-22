package cn.giraffetree.relayune

import android.app.NotificationManager
import android.app.NotificationChannel
import androidx.core.app.NotificationCompat
import android.app.Application
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.robolectric.RuntimeEnvironment
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, manifest = Config.NONE)
class PushNotificationTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private fun card(session: String, state: String) = mapOf<String, Any>(
        "sessionId" to session, "turnId" to "turn", "state" to state,
        "statusLabel" to state, "title" to "Task", "connected" to true,
        "foreground" to true, "updatedAt" to System.currentTimeMillis())

    @Test fun runningCardsAreSuppressedAndResumingCancelsOnlyThatSession() {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val live = LiveTaskNotifications(context)
        live.update(card("one", "running"))
        assertEquals(0, manager.activeNotifications.size)
        live.update(card("one", "approval"))
        live.update(card("two", "question"))
        assertEquals(2, manager.activeNotifications.size)
        live.update(card("one", "running"))
        assertEquals(1, manager.activeNotifications.size)
        assertEquals("question", manager.activeNotifications.single().notification.extras.getString("liveTaskState"))
        live.update(card("two", "completed"))
        assertEquals(0, manager.activeNotifications.size)
    }

    @Test fun startupRemovesLegacyLiveCardsButKeepsOtherNotificationsAndNewApprovals() {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel("test", "test", NotificationManager.IMPORTANCE_LOW))
        manager.notify("legacy", 42, NotificationCompat.Builder(context, "test")
            .setSmallIcon(R.drawable.ic_notification).setGroup("cn.giraffetree.relayune.live").build())
        manager.notify(43, NotificationCompat.Builder(context, "test")
            .setSmallIcon(R.drawable.ic_notification).setContentTitle("Completed task").build())
        val live = LiveTaskNotifications(context)
        live.update(card("one", "approval"))
        live.clearLegacyRunning()
        assertEquals(2, manager.activeNotifications.size)
        assertFalse(manager.activeNotifications.any { it.id == 42 })
        assertTrue(manager.activeNotifications.any { it.id == 43 })
    }

    @Test fun vivoLifecyclePayloadUsesOneApprovedSceneAndFixedLandingIntent() {
        val open = PendingIntent.getActivity(context, 7, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        for (operation in 0..2) {
            val extras = VivoAtomicNotification.extras(context, "APPROVED_TEST_SCENE", operation, operation + 1,
                "等待确认", "测试任务", "更新于 12:00", "查看请求", 0xff69e1d2.toInt(), open)
            assertEquals(operation, extras.getInt("notification.superx.operation"))
            assertEquals("APPROVED_TEST_SCENE", extras.getString("notification.superx.scene"))
            assertTrue(extras.getBoolean("notification.superx.showNotify"))
            assertFalse(extras.getBoolean("notification.superx.sound"))
            assertEquals(if (operation == 2) 120 else 0, extras.getInt("notification.superx.keepDuration"))
            assertEquals("等待确认", extras.getBundle("notification.superx.baseInfos")!!.getCharSequence("notification.superx.baseInfos.title"))
            assertEquals(6, extras.getBundle("notification.superx.island")!!.getInt("island.superx.rightTemplate"))
        }
    }
    @Test fun unsupportedDeviceUsesStandardNotification() {
        assertFalse(VivoAtomicNotification.available(context))
    }
    @Test fun notificationPermissionDoesNotImplySdkConsent() {
        context.getSharedPreferences("relayune_push_settings", Context.MODE_PRIVATE).edit().clear().commit()
        assertFalse(RelayPush.consented(context))
        assertFalse(RelayPush.enabled(context))
        assertNull(RelayPush.registration(context))
        RelayPush.consent(context)
        assertTrue(RelayPush.consented(context))
        assertFalse(RelayPush.enabled(context))
    }
}
