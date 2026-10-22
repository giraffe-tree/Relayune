# 会话中的临时思考状态

手机在滚动会话中、当前轮次的消息与工具记录之后、分隔线上方缩进显示临时
思考状态。只显示“思考中… (N 秒)”及当前连续思考阶段的实际秒数，不带 Agent 名称、
图标或整轮运行时间。它随会话滚动，阅读旧消息时可以移出屏幕；状态出现或清除
不会把阅读位置拉回底部。只有原生 Agent 明确报告思考时才显示；没有这类信号时
不添加临时提示，任务运行状态仍由原有会话和过程标题展示。

计时从当前阶段的实时 `turn.thinking active=true` 事件时间开始，重复开始事件
保留原始起点。开始回复、执行工具或等待审批后清除；再次收到思考信号时从新的
阶段重新计时。停止或结束后移除。思考状态不创建消息、过程折叠块或历史缓存
检查点。断线、后台暂停和退出账户使已有思考提示及计时失效，历史回读不恢复它。

## 加密事件

`turn.thinking` 包含 `turn_id`、布尔值 `active` 和可选的公开 `provider`。
不包含思考正文、摘要、签名或 token。沿用现有独立客户端授权和端到端加密事件通道；
Server 无新增明文字段。密文投递缓冲区的正常保留窗口不等于聊天历史。

Relay 按会话和轮次去重，只发送状态变化。消息、工具、审批和终态是状态边界，
后续思考可重新开始。手机只接受当前已确认运行轮次的提示，用来源序号及时间拒绝
旧事件；重复的开始事件不能覆盖当前思考，结束后的提示不能复活任务。
界面读取当前实时会话的思考状态，不要求原生历史分组 ID 与实时适配器 ID 相同，
避免回读历史后追问时漏掉提示；事件接收仍严格校验当前运行轮次。
ACP 的正常 `end_turn` 统一映射为 `completed`；手机也识别旧缓存中的 `end_turn`，
确保正确回复结束后显示“本轮完成”。

ACP 新建、恢复、配置修改及 `config_option_update` 的已公布配置通过
`session.config_updated` 同步到手机，相同配置不重复发送。恢复后的模型和思考档位
不依赖下一次目录刷新。只读历史不会为获取选项而激活 Kimi 会话；重启 Relay 后，
首次发送触发原生恢复并同步其真实选项。

| Agent | 原生信号 |
| --- | --- |
| Codex | `reasoning` item 开始/结束及 reasoning delta 通知 |
| Kimi / OpenCode / MiniMax Code | ACP `agent_thought_chunk`；下一条消息或工具事件清除 |
| Claude Code / Claude Cowork | 主会话 stream 的 thinking block 开始、增量及结束 |
| Pi | RPC `thinking_start` / `thinking_delta` / `thinking_end` |
| ZCode | `model.streaming.reasoning_delta`；下一条消息或工具事件清除 |

模型可能关闭推理，原生接口也可能延迟到块完成时才报告开始；不通过等待时长猜测思考。
子 Agent 的思考不会覆盖主会话提示。外部会话或中途加入时缺少实时证据，仍显示普通运行状态。
Pi 当前仍为实验接入：桌面的多 Agent Relay 需要 `RELAY_ENABLE_PI=1` 才会加载 Pi
适配器和同步其会话。直接运行 Pi 适配器的测试不证明默认桌面安装版已启用该入口；
手机验收必须记录实验开关是否启用。

### Codex 桌面外部会话的限制

Relayune 自己启动的 app-server 会话能够接收 `item/started` / `item/completed`
及 reasoning 增量。桌面中已运行的外部会话使用只读 rollout 和本机 owner IPC；
`thread/read` [不会订阅实时事件](https://learn.chatgpt.com/docs/app-server)。
本次实际只读检查中，rollout 的 reasoning 记录没有开始/进行中状态，owner IPC 的
reasoning item 也没有进行中标记。进一步监听自有活跃会话 35 秒捕获到实时条目 patch；
本机桌面源码对 reasoning 开始和完成均写入同一条目形状，未携带可区分的完成标记，
所以条目新增或内容变化本身不能证明当前思考阶段。
Codex 0.160.1 本机生成的实验协议 Schema 也没有独立 `thread/subscribe` 方法；
`ThreadActiveFlag` 只有 `waitingOnApproval` 和 `waitingOnUserInput`。
`thread/timeline/list` 是普通与实时会话的历史列表，不能当作当前思考阶段订阅。
不能用这些已完成记录、任务“运行中”或子任务数量猜测当前正在思考。因此外部链路
没有明确边界时显示“正在处理”；这不代表模型没有思考。

## 验证

- `tests/turn-thinking.test.mjs`：原生事件映射、轮次隔离、去重和正文排除。
- `tests/pi-adapter.test.mjs` / `tests/zcode-adapter.test.mjs`：适配器串流和终态。
- `mobile/test/ui/transient_thinking_test.dart`：会话位置、工具后再次思考、回复后移除、
  终态、旧事件、断线恢复、35 条工具记录后的滚动位置、阅读历史时结束不跳底、
  外部目录运行状态不伪装为思考；
  320px 宽界面。
- `scripts/test-pi-rpc-live.mjs`：真实 Pi CLI 配合受控本地模型，覆盖思考、真实工具批准/
  拒绝、提问、停止和恢复。已验证 Pi 1.0.4；保留已验证的 0.85.1 兼容限制，
  其他版本仍须先验证，不能仅通过放宽版本门禁宣称兼容。

2026-10-06：Codex、OpenCode 2.0.24、Kimi、Claude Code 与 MiniMax Code 的真实
云模型算术测试均观察到 Relay 思考事件及正确终态。Pi 1.0.4 和 ZCode 0.16.9 通过
真实 CLI + 受控本地模型验证；此项不证明它们当前的云模型连接可用。
Claude Code 本机底层模型为 Kimi，不代表 Anthropic 模型覆盖。

后续对 Kimi 2.1.1 重新进行真实云模型验证：新建高思考档位、重启适配器后恢复、
恢复后显式设置高档位三轮均有 Relay 思考事件及正确回复；恢复时实际收到配置事件。
只读原生历史最终包含三条输入和三条回复，没有思考历史消息。
Codex 0.160.1、Claude Code 2.1.291、MiniMax Code 0.6.3 也分别通过真实 CLI 和
云模型复测，Relay 收到思考事件并返回正确答案；Claude 底层模型仍为 Kimi。
Pi 当前 ApiMux 模型配置未声明 reasoning，原生状态为 off；云请求重试失败，模型目录
请求在 TLS 握手时失败。ZCode 当前原生默认模型为空。两者的云模型思考能力尚未通过，
不能用此前受控模型验证代替。

## 公开复验边界

个人任务、设备、锁屏与安装实操的历史记录归私有维护仓库，内部验收档案未随公开源码提供。上述实现说明与测试入口不代表本副本已完成实际模型、桌面安装连接或手机实时同步验收。
