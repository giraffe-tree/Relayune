# Auto Review 后的接管调研

日期：2026-09-08。范围：官方 Desktop 发起的现有任务，手机通过 Relayune 接管。
由 3 个子 agent 分别核查官方源码、社区方案、本机能力，主 agent 核对官方文档及交叉结论。
本轮没有修改审批逻辑、真实 Codex 配置或信任记录，没有操作真实任务的审批。

## 结论

纯 Hook 尚无可靠的事后接管接口。隔离验证支持继续采用 **已有 PermissionRequest Hook +
Desktop 原生 IPC**：Hook 处理普通人工审批；IPC 只转发原生真正存在的待处理请求。
若 Auto Review 已明确拒绝，则是另一条“批准原动作重试”流程，不能当作待审批请求回复。
2026-09-08 补充验证已通过真实 app-server 协议及现有 Desktop IPC router；尚未完成
官方 Desktop 原任务 owner 与 Relayune 手机端的端到端验收，不能据此宣称产品已支持。

| 实际状态 | 可以用的入口 | 当前判断 |
| --- | --- | --- |
| Auto Review 通过 | 无人工请求 | 不创建手机审批 |
| 自动审批模式中出现真正的人工请求 | Desktop IPC 的 requests 和 follower reply | 普通人工请求已通过真实 router + 隔离 owner；Auto Review 转人工和原桌面 owner 尚未实测 |
| Auto Review 已拒绝，用户要授权原动作重试 | thread/approveGuardianDeniedAction | 真实 app-server 隔离验证通过；现有 Desktop IPC 未发现对应转发方法 |
| Agent 发出结构化问题 | user-input / MCP elicitation 对应回复方法 | 可作为 IPC 的独立请求类型，不是权限批准 |
| Agent 仅在文本中询问 | 普通用户消息 | 不能把回复文字冒充原 RPC 审批 |

## 官方源码与文档

固定源码版本：`53ba408a2f5502313792e46e5730a056e233bcab`，2026-09-07。

1. `PermissionRequest` 在 reviewer 路由之前运行。Hook 无决定才继续；路由转人工后
   直接调用原生 user approval，不再执行第二次 PermissionRequest。最新枚举没有
   AutoReviewCompleted 或 PostPermissionRequest。
   [审批顺序](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/core/src/tools/approvals.rs#L493)、
   [Hook 枚举](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/hooks/src/lib.rs#L23)。
2. 扩展 reviewer 的 `AskUser` 属于审批路由结果；未强制 Guardian 时可继续原生人工审批。
   不能将它概括为所有 Guardian 拒绝都会自动弹人工窗口。
   [AskUser 分支](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/core/src/guardian/decision.rs#L185)。
3. `item/autoApprovalReview/started`、`completed` 是通知，有 reviewId、action、状态与理由，
   不是可回复的审批请求；结构标记为 UNSTABLE。
   [通知结构](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1361)。
4. 官方 `/approve` 可以选择被拒绝的具体操作，记录针对同一操作的重试授权。
   重试仍经过 Auto Review，不能保证放行。
   [官方 Auto-review 文档](https://learn.chatgpt.com/docs/sandboxing/auto-review)。

对应 RPC 为 `thread/approveGuardianDeniedAction`，参数是 `threadId` 与原始
`GuardianAssessmentEvent`。completed notification 要按官方客户端逻辑转换，不能原样塞入。
[参数](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1154)、
[客户端转换](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/tui/src/chatwidget/protocol_requests.rs#L75)。

该 RPC 注入限定原动作的 developer 上下文，本身不启动新回合；任务空闲时还需正常发送继续请求。
当前 handler 显式检查 Denied 状态，但没有完整的原事件查找、TTL、一次消费校验。
Relay 若接入，必须自己保存真实观测到的事件，绑定任务/回合/reviewId/动作摘要，并校验 nonce、
期限和消费状态。手机只能提交引用与决定，不能上传任意 event。
[handler](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/core/src/session/handlers.rs#L742)、
[注入语义](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/core/src/session/inject.rs#L146)。

不能只靠现有 JSONL watcher：GuardianAssessment 在最新 rollout policy 中是不持久化事件。
也不能另起 app-server 就对 Desktop 原进程调用该 RPC：处理器只查当前实例已加载的任务。
另行 resume 不等于接管原任务进程，可能遇到 writer 冲突。
[rollout policy](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/rollout/src/policy.rs#L141)、
[加载任务](https://github.com/openai/codex/blob/53ba408a2f5502313792e46e5730a056e233bcab/codex-rs/app-server/src/request_processors/thread_processor.rs#L964)。

## 初次本机核验

- 安装版 Codex 为 0.153.4；schema 有上述拒绝重试 RPC。
- 现有 `~/.codex/ipc/ipc.sock` 存在，权限为 0600；daemon control socket 当前不存在。
- 实际只发送 Native IPC initialize（4 字节小端长度 + JSON），收到成功响应及 clientId，
  随后收到 following 状态广播和客户端发现消息后断开。没有读取会话正文或审批载荷。
- 安装版静态代码包含 v11 thread-stream-state-changed，以及 command、file、permissions、
  user-input、MCP elicitation 的 follower 回复方法。owner 会按原 requestId 转交原 app-server。
- Desktop 内存的 denied review item 保留完整 event；snapshot 序列化层未过滤该字段。
  因此有通过 snapshot 获得拒绝事件的静态依据，尚未验证真实拒绝快照。
- Desktop 自身 `/approve` UI 调用专用 RPC，但 Native IPC follower 白名单未发现该方法，
  也未发现任意 app-server RPC 的通用转发入口。
- 修改当前 reviewer 不会迁移已捕获步骤或已挂起的审批，因此不能靠切换模式接走现有请求。

以上实测只证明能连接现有 Desktop IPC，不能证明审批闭环已打通。
本机原始核查与临时测试材料留在私有维护仓库，内部验收档案未随公开源码提供；下列历史摘要不能作为公开副本的当前验收结果。

## 补充隔离验证结果

使用安装版 Codex **0.153.4**，临时 CODEX_HOME、临时工作目录和本机模拟 SSE 模型。
Codex 审批状态机、Guardian 调用、官方 RPC 和命令执行为真实实现；主模型输出和审查决定
由测试服务指定。没有使用真实账户、改动用户配置、修改 App 包或操作现有任务。

此前 502 已定位：仅清空代理环境变量时，macOS 系统代理仍会接管本机假模型请求。
只为临时 Codex 子进程设置代理到测试 HTTP listener 后通过；未修改系统代理。

| 验证项 | 结果 | 证据范围 |
| --- | --- | --- |
| 同一 app-server 两个 WS 客户端，人工拒绝 | 通过 | 同一 requestId；双方收到 serverRequest/resolved；turn 完成 |
| 同一 app-server 两个 WS 客户端，人工允许 | 通过 | 安全 echo 执行；双方收到 resolved；turn 完成 |
| 晚连接 WS 客户端订阅已有待审批 | 通过 | thread/resume 补发同一审批请求；不是另起 app-server |
| Auto Review 拒绝后官方 RPC 授权再试 | 通过 | denied → 原生授权上下文 → 新回合 → 再审 approved → printf exit 0 |
| 现有 Desktop IPC router 传递人工拒绝 | 通过 | 隔离 owner 发真实审批；follower 回复；原 app-server resolved；快照清理 |
| 现有 Desktop IPC router 传递人工允许 | 通过 | 同上；等待源端确认，没有只检查 IPC 的 ok |
| IPC follower 断线重连后取回待审批 | 通过 | 重新发现 owner、订阅，完整快照包含原请求 |
| requestId 类型不匹配、已完成请求重复回复 | 测试客户端拒绝 | 这是原型客户端校验，不证明原生 Desktop 自带相同防护 |

### 拒绝后的真实流程

第一次 Guardian 返回 denied 时，人工 requestApproval 数量为 **0**。
第二个 WS 客户端调用 `thread/approveGuardianDeniedAction` 返回 `{}`；随后 250ms 观察窗口内
没有自动启动新回合。正常 `turn/start` 后，模型输入带有原生生成的 `guardian.approved_action`
上下文，工具重试再次调用 Guardian。测试服务第二次返回 approved，安全 printf 输出
`relayune-auto-review-probe`，退出码 0。总计两次审查，顺序为 denied、approved。

因此该 RPC 的重试授权机制确实可用，但它不承诺真实审查模型放行，也没有解决如何从
Native IPC 调用官方 Desktop 原进程中的此 RPC。通知的 `action.source: unifiedExec`
必须转换为 core event 的 `unified_exec`；直接转发通知会被参数校验拒绝。

### Desktop IPC 实测边界

链路为：真实隔离 Codex app-server → 测试 owner → **现有 Desktop IPC router** →
测试 follower → 同一 router → 测试 owner → 原 app-server。
owner 只认领临时任务 ID，follower 只处理该任务；退出时取消订阅并断开连接。
没有替换 Desktop 或接管现有任务。

该测试确认真实 socket 的发现、订阅、快照和 follower 回复可以组合工作。
**owner 的请求处理与快照维护仍是测试实现，没有执行官方 Desktop renderer 内部 dispatcher。**
没有测试真实手机/E2EE 通道、真实 Auto Review 的 AskUser 分支、子任务、未打开任务、
桌面与手机同时抢答、owner 崩溃重连、patch 丢失恢复或其他四种请求类型。
原生 dispatcher 在请求已消失时可能仍返回 ok，产品实现必须以源端 resolution 或权威
快照为准，不能把传输确认当作审批成功。

### 验收材料归属

真实本机测试脚本、临时工作目录、任务及日志留在私有维护仓库，内部验收档案未随公开源码提供。公开复验必须重新建立自己的隔离环境，不能把不可访问的旧路径当作复现入口。

## 社区渠道对比

| 项目/渠道 | 核验发现 | 对本项目的价值 |
| --- | --- | --- |
| AgentHalo / remote-agent | macOS Desktop IPC，快照/patch、owner/revision检查、请求级回复与竞态测试；MIT | 最值得参考的补充通道 |
| codex-mobile | Desktop IPC 双向审批；Windows beta，作者未验证 macOS | 协议交叉参考 |
| codex-web | 也有 Desktop IPC permission/user-input 路由；未确认许可证 | 阅读机制，不直接复制 |
| Happy / Happier | 创建自己的 stdio app-server 并管理 RPC | 适用于自己管理的进程，不证明能接管官方现有任务 |
| Paseo | 区分 Auto Review 通知与人工审批 request | 参考模式处理，不是现有 Desktop 接管证明 |
| Vibe Halo / Vibe Island | 识别自动审批后跳过或静默 | 避免误拦截，未证明事后接管 |
| Shared app-server | 共享 authority 的方向合理，但原版 macOS 有新的启动回归 | 当前不作为首选 |

AgentHalo 固定版本 `181db7eba7b2b35f3d045094fa14923837cecfd7`（2026-08-24）：
[bridge](https://github.com/psyche08/remote-agent/blob/181db7eba7b2b35f3d045094fa14923837cecfd7/internal/provider/codex_desktop_bridge.go)、
[IPC](https://github.com/psyche08/remote-agent/blob/181db7eba7b2b35f3d045094fa14923837cecfd7/internal/provider/codex_desktop_ipc.go)、
[审批测试](https://github.com/psyche08/remote-agent/blob/181db7eba7b2b35f3d045094fa14923837cecfd7/internal/provider/codex_approval_test.go)。
测试覆盖自动审批模式下真正出现 request、源端确认、双端竞态、不同任务隔离，以及数字/字符串
requestId 混淆；这是源码及模拟测试证据，不是所有 Auto Review 场景的真人验收。

其他核验入口：
[codex-mobile](https://github.com/NathanZane/codex-mobile/blob/f79e6807ca0b9d6052afd24f822ee41b9a52e07d/src/codex/CodexDesktopIpcClient.ts)、
[codex-web](https://github.com/i-am-BT/codex-web/blob/2a15a79db0708ba35d639f0b9c2bec7fc05080fb/desktop-ipc-client.mjs)、
[Happy](https://github.com/slopus/happy/blob/ac64b9b4677870f7b7a9eacfd0780959229717f1/packages/happy-cli/src/codex/codexAppServerClient.ts)、
[Happier](https://github.com/happier-dev/happier/blob/fb4c99f41415e7b77e4f812c84afda19051f2d6a/apps/cli/src/backends/codex/appServer/client/createCodexAppServerClient.ts)、
[Paseo #960](https://github.com/getpaseo/paseo/issues/960)、
[Vibe Halo](https://github.com/DaliBerr/Vibe-Halo/blob/fd3e48fdeb1d1af7437882471cd037495a050aa3/hooks/vibe-halo-hook.js)、
[Vibe Island changelog](https://vibeisland.app/changelog/)。

[OpenAI #41014](https://github.com/openai/codex/issues/41014) 截至调研时仍 open：报告称桌面
注入 codex_app MCP 配置后绕过 shared-daemon 分支，引发双 writer 问题。
这不是所有安装版的统一结论，但足以说明不能将共享实例视为即插即用修复。

通知延时不是事后审批协议：[Orca #8519](https://github.com/stablyai/orca/pull/8519) 已合并但仅做
debounce；[#13991](https://github.com/stablyai/orca/pull/13991) 关闭未合并；
[#14715](https://github.com/stablyai/orca/pull/14715) 尚未合并，仍存在超过等待窗口就误报的问题。

## 建议的下一步验证

优先做隔离 Native IPC 原型，不改现有 Hook 对 Auto Review 的让行行为：

1. 观察原 owner 的完整快照及连续 patch，仅在存在真实、未解决的 request 时显示手机卡片。
   **不能因会话模式是 auto_review 就过滤掉这种真实请求。**
2. 使用现有 Relayune E2EE 通道传输；回复绑定 owner、任务、原始 requestId 类型、动作摘要与期限。
   源端 resolution 或权威快照确认后才结束卡片；发送成功本身不算处理成功。
3. 验证原生人工请求、结构化提问、子任务、没有打开的任务、双端抢答、断线和快照失配。
   明确哪些状态需要先由 Desktop 激活任务，不能默默切换原 owner。
4. 对明确 Denied 的记录先展示理由与原生 `/approve` 指引。找到专用 RPC 到原 owner 的可靠路径后，
   再验证精确动作重试。不要用普通 command approval、改 reviewer 或伪造授权文本替代该流程。

验收门槛是手机决定到达原进程并得到源端确认；握手、静态代码和模拟测试都不能替代它。
