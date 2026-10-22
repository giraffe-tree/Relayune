package cn.giraffetree.relayune

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Explicit debug-only design fixture; excluded from release packages. */
class LiveTaskPreviewReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val state = intent.getStringExtra("state") ?: "running"
        if (state == "clear") { LiveTaskNotifications(context).clear(); return }
        val now = System.currentTimeMillis()
        val labels = mapOf("running" to "正在工作", "approval" to "等待确认", "question" to "等待回答",
            "completed" to "已完成", "failed" to "任务失败", "stale" to "状态待同步")
        LiveTaskNotifications(context).update(mapOf(
            "sessionId" to "design-preview", "turnId" to "design-preview-v1",
            "title" to "优化搜索体验", "provider" to "Claude", "state" to state,
            "statusLabel" to (labels[state] ?: "正在工作"), "staleLabel" to "状态待同步",
            "updatedLabel" to "最近同步", "elapsedLabel" to "已用时",
            "actionLabel" to if (state == "approval") "前往处理" else "查看任务",
            "startedAt" to now - 243000, "updatedAt" to now, "staleAt" to now + 75000,
            "finishedAt" to if (state == "completed" || state == "failed") now else null,
            "foreground" to true, "connected" to (state != "stale"), "startKnown" to true,
        ))
    }
}
