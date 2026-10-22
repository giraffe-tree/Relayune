# 手机后台耗电排查（2026-09-06）

代码审计确认后台存在不必要的显示定时器，同时保留了用于本地通知的实时连接。
尚未取得手机型号、安装版本、系统电池记录或真机能耗采样，以下是可核验的执行路径，
不能据此断言实际耗电占比或省电百分比。

## 已修正

- `mobile/lib/src/state/live_reply_presentation.dart`：回复逐字显示由 40ms 定时器驱动，
  原先只检查是否有监听者，页面切后台后监听者仍存在。现在在失去前台焦点时取消动画定时器，
  后台收到的文本直接更新到最新值，跳过动画用的字素拆分；回前台发布最新文本，后续输出继续动画。
- `mobile/lib/src/ui/workbench_screen.dart`：任务耗时、等待回复、Agent 详情三处每秒定时器
  改为前台运行。Agent 详情原先只是回调里判断生命周期，现在直接取消定时器。
  Agent 跑马灯同时停止滚动及循环延迟，回前台重新开始。
- `mobile/lib/main.dart`：只在经历 hidden/paused/detached 后恢复实时同步。
  原先权限弹窗、控制中心等短暂 inactive 状态结束也会关闭连接、拉取 bootstrap 并重新建连。

## 仍存在的候选耗电路径

| 路径 | 代码证据 | 影响与当前处理 |
| --- | --- | --- |
| 后台实时连接与重连 | `main.dart` 只在 detached 时 `pauseRealtime`；`app_controller.dart` 处理 invalidate 后拉取事件/目录；`server/realtime.ts` 默认每 30 秒心跳 | 后台仍可能收包、解密、更新内存状态；断线后按带抖动的指数退避重连，最大约 37.5 秒。暂保留，因为当前后台通知依赖这条连接。 |
| 等待命令结果的短轮询 | `app_controller.dart` 中 `waitForEncryptedResponse`、创建会话及配置结果等待每 250ms 重试 | 已开始的操作切后台后可能继续，通常有 20–60 秒超时；不是整夜持续轮询，但可能造成短时网络活动。 |
| Android 自动更新下载 | `android_auto_update.dart` 在回前台触发检查，最小检查间隔 10 分钟；下载过程中不监听后台暂停 | 新版本下载、文件写入和 SHA-256 校验可能跨越切后台；属于有界任务，需结合实际升级时间确认。 |

源码中的 iOS `Info.plist` 没有声明 `UIBackgroundModes`；Android 主清单未声明前台保活服务
或 WAKE_LOCK 权限。不能把“后台仍有代码路径”理解为 iOS 会整夜执行这些代码；系统挂起后
实际执行受系统约束。Flutter 的 paused 状态不再触发绘制帧，但应用自己的 Dart 定时器仍应主动管理。
生命周期语义参见 [Flutter AppLifecycleState 官方文档](https://api.flutter.dev/flutter/dart-ui/AppLifecycleState.html)。

## 验证与下一步

40 项相关回归通过，覆盖后台/前台计时器切换、后台文本合并与恢复、跑马灯暂停恢复，
以及已有通知、启动、任务活动界面行为。Flutter analyze 和移动测试映射检查通过。
此轮未发布、未安装真机版本。

真机应在相同网络、亮度和版本类型下，分别对比空闲后台、电脑持续输出时后台、断网后台
三个场景，记录 15–30 分钟 CPU/网络活动及系统电池记录。iPhone 使用 release/profile 构建
配合 Instruments；Android 结合系统电池记录和网络/CPU 跟踪。模拟器测试不用于推导省电幅度。

若接受后台不再及时通知，可在 hidden/paused 时关闭连接、取消重连及后续拉取，并用生命周期
版本号阻止切后台前尚未完成的恢复请求重新建连；回前台按游标补同步。若必须保留通知，需要另行
设计系统推送路径，在现有端到端加密约束下避免把业务明文交给 Server。该取舍尚未变更。
