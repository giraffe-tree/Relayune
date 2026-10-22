package cn.giraffetree.relayune

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Bundle

/** vivo's documented local notification protocol, not a floating overlay.
 * Source: https://dev.vivo.com.cn/documentCenter/doc/896
 * The scene is allocated through vivo's review; an empty scene disables this path.
 */
object VivoAtomicNotification {
    const val TAG = "VIVO_SUPERX_TAG"

    fun available(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < 23 || BuildConfig.VIVO_ATOMIC_SCENE.isEmpty() ||
            !(Build.MANUFACTURER.equals("vivo", true) || Build.BRAND.equals("iQOO", true))) return false
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // Publicly documented OEM capability. Missing/denied capability falls back.
        return try {
            manager.javaClass.getMethod("getSceneStatus", String::class.java, String::class.java)
                .invoke(manager, context.packageName, BuildConfig.VIVO_ATOMIC_SCENE) == true
        } catch (_: ReflectiveOperationException) { false }
          catch (_: SecurityException) { false }
    }

    fun extras(context: Context, scene: String, operation: Int, revision: Int,
               title: String, body: String, subtitle: String, action: String,
               color: Int, open: PendingIntent): Bundle {
        val icon = Icon.createWithResource(context.packageName, R.drawable.ic_notification)
        val base = Bundle().apply {
            putParcelable("notification.superx.baseInfos.icon", icon)
            putCharSequence("notification.superx.baseInfos.title", title)
            putCharSequence("notification.superx.baseInfos.content", body)
            putInt("notification.superx.baseInfos.subInfo", 1)
            putString("notification.superx.baseInfos.subText", subtitle)
            putInt("notification.superx.baseInfos.subTextColor", color)
        }
        val short = Bundle().apply {
            putParcelable("notification.superx.shortInfos.icon", icon)
            putParcelable("notification.superx.shortInfos.image", icon)
            putParcelable("notification.superx.shortInfos.imageClickResp", open)
            putString("notification.superx.shortInfos.describeShort", title)
            putString("notification.superx.shortInfos.coreInfoShort", action)
        }
        val capsule = Bundle().apply {
            putInt("notification.superx.capsule.state", if (operation == 2) 0 else 1)
            putParcelable("notification.superx.capsule.icon", icon)
            putString("notification.superx.capsule.content", title)
            putInt("notification.superx.capsule.contentColor", Color.rgb(11, 18, 28))
            putInt("notification.superx.capsule.bgColor", color)
            putInt("notification.superx.capsule.showTime", 75)
            putParcelable("notification.superx.capsule.clickResp", open)
        }
        val island = Bundle().apply {
            putInt("island.superx.leftTemplate", 1)
            putBundle("island.superx.leftInfo", Bundle().apply {
                putParcelable("island.superx.leftInfo.icon", icon)
                putCharSequence("island.superx.leftInfo.content", "Relayune")
            })
            putInt("island.superx.rightTemplate", 6)
            putBundle("island.superx.rightInfo", Bundle().apply {
                putCharSequence("island.superx.rightInfo.capsuleContent", title)
                putInt("island.superx.rightInfo.capsuleBgColor", color)
                putParcelable("island.superx.rightInfo.clickResp", open)
            })
            putInt("island.superx.islandClick", 0)
            putParcelable("island.superx.clickResp", open)
            putInt("island.superx.showTime", 75)
            putInt("island.superx.template", 4)
            putBundle("island.superx.baseInfos", base)
        }
        return Bundle().apply {
            putInt("notification.superx.operation", operation)
            putString("notification.superx.scene", scene)
            putInt("notification.superx.template", 4)
            putBoolean("notification.superx.showNotify", true)
            putBoolean("notification.superx.sound", false)
            putBoolean("notification.superx.dismissWhenKill", false)
            putInt("notification.superx.changedRecord", revision)
            putInt("notification.superx.keepDuration", if (operation == 2) 120 else 0)
            putInt("notification.superx.displays", 0x10111)
            putParcelable("notification.superx.clickResp", open)
            putBundle("notification.superx.baseInfos", base)
            putBundle("notification.superx.infos", Bundle())
            putBundle("notification.superx.shortInfos", short)
            putBundle("notification.superx.capsule", capsule)
            putBundle("notification.superx.island", island)
        }
    }
}
