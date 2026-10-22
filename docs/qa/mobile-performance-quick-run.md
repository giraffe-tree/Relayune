# 手机性能与实时同步快速复测

依据：卸载重装后的三轮基准（内部验收档案未随公开源码提供）、实时同步修复与六次真实回复（内部验收档案未随公开源码提供）。
这是复用方法，不是新一轮通过证明。完整核心回归仍遵循[核心回归入口](core-regression-prompt.md)；本页用于手机启动、会话打开、发送和同步专项测试。

## 一次准备，一批安装

1. 冻结源码提交、安装产物来源、版本/构建号、设备/系统、Debug/Profile/Release、网络与连接方式、实际目标 Mac、CLI/模型/推理强度。设备列表中的默认 Mac 未必是待测 Mac，必须在界面核对。
2. 一次确认 Desktop 已连接且 Agent 可执行，复用有效配对。模拟器操作使用 `$manage-ios-simulator-workflow`，只占用自己的设备；桌面席位仅用于实际交互，构建和网络等待时释放。
3. 先运行相关确定性回归，修复后提交，再从同一批最终代码提交各构建安装一次。保留 Flutter、Pods、Gradle、Cargo 缓存；版本或相关代码变化才让对应产物失效。发布直接构建正式包，不先额外构建一次等价包。
4. 复用专用 QA 项目和三个测试会话。真实用户的旧会话只读，不向其中发送探针。卸载重装只在指定的干净安装场景做一次；iOS Keychain 可能保留配对，不能把重装称为完全未授权冷启动。

## 固定矩阵和计时边界

每类至少三次，保存逐次值、中位数、范围和失败；三次样本不计算 P95。历史性能对照若沿用五次基线仍须保持五次。不同设备、网络、模型和缓存状态建立不同基线。

| 场景 | 必须观察的结束条件 | 计时口径 |
| --- | --- | --- |
| 进程冷启动 | 首页可交互、五个最近会话出现 | 系统启动到 Dart 与 Dart 后计时分别记录；不能省掉引擎/系统成本后称总启动耗时 |
| 回首页 | 五个最近会话完整出现，加载期间有占位 | UI 观察为上界，另保留原生 `recent_list` 标记 |
| 小/中/大会话 | 首次可读内容、最新完整页分别出现 | `selection_to_first_frame_ms` 是首屏；`display_ms` 是该次结果帧，不混成同一个值 |
| 内存、SQLite、网络冷读 | 核对真实 `source` 与消息数 | 重启进程不清 SQLite；预读已经命中时不能当网络冷读；OS 文件缓存另标注 |
| 新建会话 | 新会话页面出现且输入框可发送 | 创建命令成功与页面可发送分别记录 |
| 首条发送/追问 | 正确助手回复出现，并进入“本轮完成” | 命令接受、Agent 开始/最终答案、页面可见分别计量；模型生成不算同步故障 |
| 后台恢复 | 确认已到系统主页，记录实际后台时长；返回后新回复正常 | 返回 App 后重新核对连接与会话，不能把 Home 点击成功当实际进入后台 |

文件总大小、Mac 实际读取字节、返回 JSON 大小和网络响应体大小是四个量。跨设备时间差须说明时钟对齐；Mac 结果就绪至手机收到包含整理、加密、排队、中转与接收，不能全部称带宽成本。

## 统一脱敏采集，复用现有脚本

不再每轮临时编写 Python 过滤器。`summarize-history-performance.mjs` 的 `--stream` 只输出固定字段、固定阶段和随机 history trace；丢弃用户内容、账号、凭据、会话 ID 和未知字段。标准输入逐行处理，避免持久化整份 App 日志。

```bash
# 从已取得占用的精确设备采集。替换下方 UDID；不要使用 booted。
flutter logs -d <UDID> | node scripts/summarize-history-performance.mjs - --stream > /tmp/relayune-safe-metrics.log

# 停止日志观察后，与本机 Relay 的数字诊断一起按随机 trace 汇总。
node scripts/summarize-history-performance.mjs /tmp/relayune-safe-metrics.log <本机数字诊断文件> --output /tmp/relayune-metrics.json
```

汇总 schema 2 保留 `traces`，另有 `startup_samples` 和无 trace 的 `untraced_samples`；它不会自动把启动样本归入某次操作。操作时间、编号和环境必须独立落盘再关联。停止 `flutter logs` 仅停止观察；不要用 `simctl launch --console` 的中断来结束观察，否则可能把 App 一同结束。

GUI 使用一次工具调用里的连续采样，避免人为几分钟空窗。文本状态优先 AX，布局、占位和实际后台必须截图；只报告首次确认时的观察上界。AX 与截图可能先后发生，上一条 AX 返回时间不能冒充严谨的 UI 完成下界。原生帧标记才用于精确 App 阶段耗时。

## 实时同步先测竞争，再测真实旅程

先用 `mobile/test/state/online_stream_recovery_test.dart` 的加密 WebSocket fixtures 验证：正常恢复、目录版本在读响应途中继续变化、恢复途中再次收到 resync。用受控时序重现竞争；没有必要等待真实模型碰巧触发它。

```bash
node mobile/tool/flutter.mjs test test/state/online_stream_recovery_test.dart test/network/online_stream_test.dart test/state/app_controller_realtime_test.dart --reporter expanded
node --test tests/online-stream-client.test.mjs tests/online-stream-integration.test.mjs tests/history-performance-report.test.mjs
```

随后在真实 App 三个专用会话各执行首发和追问，至少一个在后台两分钟恢复后执行。示例输入：

```text
Return only the concatenation of IOS, _SYNC_A and _OK. Do not use tools, read files, or change anything.
```

期待 `IOS_SYNC_A_OK`，该完整字符串不出现在用户输入中，避免误把用户消息当助手回复。换用不同固定标记区分各轮，逐次确认助手内容、发送状态与终态。保持当前会话直到完成，不回首页或重开历史救场；在发送窗口核对没有网络历史重读，证明页面靠实时事件更新。只读回查测试会话的原生事件，确认输入/回复次数和工具调用数，避免重复发送造成假绿。

## 失败只诊断一次，按检查点接续

每步立即保存操作起止、断言、原生标记、实际观察上界、版本、结果和下一动作。30 秒无确定进展时读取当前命令/事件/连接阶段；真实 Agent 总截止时间沿用核心回归约定，不因刷新重置。仅有暂时性故障证据时重试一次，保留第一次失败。原生完成而手机仍等待时定位事件交付和渲染，不重复发送或重建全部平台。

接续先读 `summary.json` / checkpoint 和未闭环项；锁屏、账号和硬件等待单列。最终报告分别说明协议、模拟器、生产服务与真机覆盖，释放自己的 ticket/lease。没有测量的提速比例和未跑的平台不写成通过。
