# Codex 会话运行设置协议调研

> 调研快照：2026-08-31；本机 Codex Desktop / `codex-cli 0.151.0-alpha.7.2`。
> 本文中的 `model/list`、`thread/settings/update`、`turn/start` 是本机 Codex app-server 的实验协议观测，不是 OpenAI 公开 API 的稳定契约。公开语义仅以下文列出的 OpenAI 官方文档为依据。

## 2026-09-08：会话权限入口

手机端和 Web 端的运行设置新增 `permissions`：默认权限、自动审批、手动审批、完全访问。
仅对空闲主会话的后续消息生效，不更改全局配置，也不改变已开始任务的权限。
完全访问在客户端确认后才提交；未读到真实状态时显示“尚未确认”，不猜测默认权限。

- Relay 持有 writer 的会话：`thread/start` / `thread/resume` 顶层字段初始化；更新后等待
  `thread/settings/updated` 返回完整实际权限。不能用 `thread/resume` 确认尚未落盘的新会话。
- Codex Desktop 持有 writer 的会话：通过当前用户的私有 IPC socket 发现 owner，读取 v11
  会话快照，再使用 `thread-follower-update-thread-settings`（local host 请求版本 2）交给
  owner 更新。再次订阅获取新快照，只取 `latestThreadSettings` 的审批策略、审核者和沙箱字段。
- 查看历史或权限只读取 Relay 已知设置或 Desktop owner 快照。无 owner、缓存缺失或读取失败时显示“尚未确认”，不为查看而 resume；实际发送消息仍可按发送路径恢复无人持有的会话。
- `latestThreadSettings` 表示 Desktop 后续消息采用的配置；`currentPermissions` 可能仍代表
  上一任务，因此不得用两者互相替代。UI 明确标注后续消息权限。
- 只允许四个预设，不暴露通用 IPC RPC 转发。保留工作区现有 writable roots；自动、默认和手动
  模式使用工作区沙箱并关闭直接网络访问。手动采用 `untrusted`，安全读取不保证逐次询问。
- 本机配置、用户限制或不支持的协议导致失败时，保留或重新读取实际值，不把请求值当成功结果。
  离线、子会话、运行中、无法验证 owner 或版本不匹配时不能切换。
- 打开历史时读取权限；已请求过权限的会话（包括读取失败的会话）随目录轮询每隔至少 30 秒在后台重试。
  优先重试最久未读取的会话，最多同时保留 8 个目录触发的读取，与历史读取共用去重状态，不阻塞目录返回。
  读取失败撤销旧的确认状态；手机输入区隐藏未确认的权限，配置详情仍显示“权限待确认”及恢复提示。
  已确认的自定义权限继续显示“自定义权限”，不显示原始枚举。
- 会话配置和回读结果仍走原有 `session.configure` / `session.config_updated` 加密通道，Server 无新增字段。

本机 `codex-cli 0.153.4` 实测：成功读取两个 Desktop 会话，向一个空闲会话提交与原值完全相同的
权限设置，并从新快照确认一致；未改变该会话权限、未启动模型任务。另在真实 app-server 的独立 ephemeral 会话中逐一切换 manual、auto、full、default，
四次都由实际设置通知确认，未启动模型任务。拒绝、旧状态、运行中和版本不兼容另由隔离
IPC/adapter 测试覆盖。这不是 Windows named-pipe 兼容性证明；
当前原生 Desktop IPC 通道使用 Unix socket，不支持的环境显示未确认而不降级放行。

2026-09-09 排查手机输入区 `unknown`：截图对应会话在本机只读 IPC 探针的
`thread-owner-discovery` 阶段返回错误；同一 socket 可以成功读取另一个已打开会话的权限。
因此无法确认截图会话的后续消息权限，不能由历史 turn 或全局配置推断。
另发现目录刷新原先只重试成功读取过的会话，首次失败后无法随目录轮询恢复；现已修复并以
可控 Promise 测试失败后恢复、30 秒间隔、历史/目录去重和不获取 writer。
手机测试覆盖中英文未知/自定义状态、实际权限选中状态和完全访问取消流程。

新增实现：`relay/codex-desktop-settings.mjs`、`relay/codex-permissions.mjs`；测试：
`tests/codex-permissions.test.mjs`、`mobile/test/ui/session_model_settings_test.dart`。

以下为 8 月 31 日模型设置调研记录；其“权限入口尚未开放”的历史限制已由上述 owner 路径更新。

## 原调研结论

1. 当前本机 app-server 的 schema 确实允许用 `thread/settings/update` 配置 `model`、`effort`、`serviceTier`，`model/list` 也会返回相应目录；公开 API 同样支持请求级 reasoning 配置。能力存在不等于 Relayune 能修改 Codex Desktop 已持有的会话。
2. 对 Relayune 展示的真实 Codex Desktop 会话实测时，先 `thread/resume` 再调用 `thread/settings/update` 会返回 `thread already has an active writer`。不 resume 时则返回 `thread not found`。也就是说，Relayune 的第二个 app-server 连接无法取得同一线程的写入权。
3. `thread/queue/add` 虽然存在，但当前 schema 只接受 `threadId`、`input`、`clientUserMessageId`，没有模型、推理强度或 service tier 字段，不能替代设置更新。
4. 因此 Mobile 和 Web 的通用 Codex 输入区不再展示模型、推理强度、速度选择器，避免提供不能可靠生效的控件。Kimi ACP 自己声明并拥有的原生会话设置不受此决策影响。
5. Relayune 仍保留端到端加密的 `session.configure` 状态层、Desktop Relay 和 adapter 实现，作为协议研究、兼容与未来 app-server 支持共享写入或队列设置后的恢复基础；Server 仍看不到 `config_id` 和所选值。

## 1. 本机 app-server 协议观测

本次使用安装包内的二进制生成实验 TypeScript schema，并通过 JSON-RPC 实际调用 `model/list`。该协议随 Codex Desktop 版本变化，Relayune 不应硬编码某个版本的完整模型列表。

### 1.1 `model/list`

请求参数：

```ts
{
  cursor?: string | null;
  limit?: number | null;
  includeHidden?: boolean | null;
}
```

响应为 `{ data: Model[]; nextCursor: string | null }`。当前 `Model` 的实际字段包括：

```ts
{
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  defaultReasoningEffort: string;
  serviceTiers: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  defaultServiceTier: string | null;

  // 与本次 UI 无直接关系，但也在当前 schema 中：
  upgrade: string | null;
  upgradeInfo: object | null;
  availabilityNux: object | null;
  modelSpecialty: string | null;
  inputModalities: string[];
  supportsPersonality: boolean;
  multiAgentVersion: string | null;
  additionalSpeedTiers: string[]; // 已标记 deprecated
}
```

本机实测摘要：

| 模型 | 默认推理 | 可选推理 | `serviceTiers` |
|---|---|---|---|
| GPT-5.6-Sol | `low` | `low, medium, high, xhigh, max, ultra` | `priority` / Fast |
| GPT-5.6-Terra | `medium` | `low, medium, high, xhigh, max, ultra` | `priority` / Fast |
| GPT-5.6-Luna | `medium` | `low, medium, high, xhigh, max` | `priority` / Fast |
| GPT-5.5、GPT-5.4 | `medium` | `low, medium, high, xhigh` | `priority` / Fast |
| GPT-5.4-Mini | `medium` | `low, medium, high, xhigh` | 空数组 |
| GPT-5.3-Codex-Spark | `high` | `low, medium, high, xhigh` | 空数组 |

这些值是账号、安装版本和时间点相关的目录结果。尤其 `ultra` 是 Codex app-server 暴露的应用运行模式，不应从公开 Responses API 模型页反推；公开模型页与本机 Codex 目录的默认值或可选值可能不同。

### 1.2 `thread/settings/update`

当前实验 schema 的运行设置核心字段是：

```ts
{
  threadId: string;
  model?: string | null;
  effort?: string | null;
  serviceTier?: string | null;
}
```

- `model`：覆盖后续 turns 使用的模型。
- `effort`：覆盖后续 turns 的推理强度。
- `serviceTier`：覆盖后续 turns 的服务层；省略表示保持不变，`null` 表示清除当前线程的 tier。

同一请求还可携带 `cwd`、审批策略、审批路由、sandbox/permissions、reasoning summary、collaboration mode、personality 等线程设置；它们不属于本次模型/推理/速度 UI。

成功更新后，app-server 会发出 `thread/settings/updated`，其中 `threadSettings` 包含实际的 `model`、`effort` 和 `serviceTier`。Relayune 以该通知作为运行状态同步信号之一。

2026-08-31 的独立 ephemeral 会话烟测进一步确认：当探针本身拥有 writer 时，GPT-5.6-Sol 从 `xhigh` 更新为 `high` 可以成功，随后 `thread/settings/updated.threadSettings.effort` 为 `high`。这只证明字段语义正确，不证明第二个连接可以修改 Codex Desktop 已持有 writer 的会话。同一版本的 `thread/read` 与 `thread/list` 返回的 `Thread` 不携带 `model / effort / serviceTier`，因此它们也不能作为设置是否已应用的确认来源。

### 1.3 `turn/start` 与继承

`turn/start` 同样接受 `model`、`effort`、`serviceTier`，当前 schema 将三者描述为“覆盖本 turn 及后续 turns”。此外还有：

```ts
serviceTierForTurn?: string | null;
```

它只覆盖新启动的当前 turn，不修改线程 tier；`"default"` 明确表示标准速度，省略或 `null` 表示继承线程 tier。Relayune 保留的 adapter 没有使用 `serviceTierForTurn`，而是采用线程级设置：

1. 收到受信任的 `session.configure` 后先调用 `thread/settings/update`；
2. adapter 在内存中记录 thread 的实际 `model / effort / serviceTier`；
3. 后续 `turn/start` 再携带非空的 sticky override，防止旧线程恢复后丢失运行设置；
4. `thread/start` / `thread/resume` 响应中的 `model`、`reasoningEffort`、`serviceTier` 会重新填充该状态。

普通 `Thread` metadata 快照不是运行设置的权威来源。当前 schema 的 `Thread` 本身不含这些字段；旧版或兼容实现即使附带 `model / reasoningEffort / effort / serviceTier`，Relayune 也不会用它覆盖刚完成的设置。运行设置只接受本地成功配置、`thread/start` / `thread/resume` 顶层响应和 `thread/settings/updated` 通知，防止滞后的 `thread/list` 回滚 UI 与下一次 turn。

保留协议以内部哨兵值 `default` 表示“标准”，adapter 向 `thread/settings/update` 传 `serviceTier: null` 以清除 Fast override。之后的 `turn/start` 不再重复发送 tier，交由线程/app-server 默认行为决定。

## 2. 推理强度和 Fast 的公开语义

以下仅用于解释 OpenAI 公开 API，不代表 app-server 内部字段是公开稳定接口：

- Responses API 的 `reasoning` 对象用于配置推理模型，`reasoning.effort` 控制推理强度；具体可选值取决于模型。[OpenAI Responses API：Create a model response](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- 公开 API 的 `service_tier` 控制请求处理层。`default` 表示标准性能与价格；请求级 Fast 可以发送 `fast` 或 `priority`，响应统一报告 `priority`；不传时公开 API 的默认行为是 `auto`。[OpenAI Responses API：service tier](https://developers.openai.com/api/reference/cli/resources/responses/methods/create)
- 公开 GPT-5.6-Sol 模型页列出该 API 模型公开支持的 reasoning effort。它与本机 Codex app-server 目录是两份不同契约，不应混用默认值或额外应用模式。[OpenAI GPT-5.6-Sol 模型页](https://developers.openai.com/api/docs/models/gpt-5.6-sol)

当前本机 app-server 的 Fast 目录项是 `id="priority"`、`name="Fast"`、描述为 `1.5x speed, increased usage`，`defaultServiceTier=null`。Relayune 必须发送目录中的 `id`，不能把展示文案 `Fast` 或旧字段 `additionalSpeedTiers: ["fast"]` 当作实际设置值。

## 3. Relayune 保留的端到端传播路径

下列链路仍存在于状态层和桌面适配器中，但 Mobile / Web 的通用 Codex 输入区已经移除触发入口。

```text
Web / Mobile
  session.configure { config_id, value }
  + AAD(device/session/request/type/expiry)
  └─ A256GCM 加密
       ↓
Server
  校验用户、浏览器授权、路由 AAD、key id、TTL、幂等键
  仅保存/转发 envelope 与必要路由元数据
       ↓
Desktop Relay
  用该浏览器独立内容密钥解密
  校验明文 device/session/request/type 与外层路由一致
       ↓
Codex adapter
  对照实时 model/list 白名单验证 config_id/value
  调用 thread/settings/update
       ↓
thread/settings/updated
  ↓
session.configure_result 或 session.configure_error
  + request_id / session_id / config_id
  └─ Desktop 按浏览器分别 A256GCM 加密
       ↓
Web / Mobile 校验关联结果，成功后刷新 session_config_options

session.config_updated / catalog sync 继续承担跨客户端和重连后的状态同步，
但不再代替发起操作的客户端确认本次请求。
```

对应实现：

- Web：`app/workbench-page.tsx` 的 `sendEncryptedCommand()` 与 Kimi 原生会话设置提交逻辑；通用 Codex 选择器不再渲染。
- Mobile：`mobile/lib/src/state/app_controller.dart` 的 `sendEncryptedCommand()`、`configureSession()` 保留；`workbench_screen.dart` 不再渲染通用 Codex 选择器。
- Desktop Relay：`relay/mac-relay.mjs` 的命令解密、路由一致性校验、`configureSession()`、catalog/event 重新加密。
- Codex adapter：`relay/codex-adapters.mjs` 的 `loadModelCatalog()`、`modelConfigOptions()`、`configureSession()`、`turnSettingsParams()`。
- 密码封装：`relay/e2ee.mjs`，固定 envelope v2 / `A256GCM`，AAD 被认证。
- Server 盲转发：`server/relay-api.ts`；其数据库或私有 blob 只接触序列化 envelope，不解密业务载荷。

重要细节：整个 `sessions` catalog（包括 `session_config_options`）作为一个 JSON 对象加密，Relay 传输层不会按字段筛选。因此，如果客户端成功解密后只看到模型，丢失通常发生在 adapter 生成 catalog 之前，或客户端使用了旧 catalog/旧构建，而不是 Server 从密文里删掉了 reasoning/speed。

## 4. 为什么目录能力不能直接变成可用 UI

若以后重新评估该功能，按优先级排查：

1. **Active writer 所有权。** 先验证当前 app-server 是否提供由非 writer 连接安全更新线程设置的正式入口；不能用“独立 ephemeral 线程可以更新”替代这一验证。
2. **Queue schema。** 重新生成当前版本 schema，确认 `thread/queue/add` 或新的队列方法是否已经加入 `model / effort / serviceTier`；没有这些字段时不能假定会继承远端选择。
3. **桌面 Relay 仍是旧进程或旧 bundle。** iOS/Web 更新不等于执行命令的桌面 Relay 已更新；旧进程可能只构造 model 配置。
4. **兼容目录缺字段。** `reasoningOptionsFromModel()` 只接受 `supportedReasoningEfforts` 数组，`serviceTierOptionsFromModel()` 只接受 `serviceTiers` 数组。字段缺失时会安全降级，不猜测值。
5. **使用了旧缓存。** `loadModelCatalog()` 在刷新失败时保留已有 catalog；短暂 app-server 故障不会清空目录，但可能继续保留旧能力。

若 app-server 目录本身加载失败且没有可用缓存，当前 adapter 会发布空配置而不是仅发布模型；因此“恰好只有模型”是判断“旧形状目录或旧 adapter”的强信号。

## 5. 诊断步骤

诊断不得打印内容密钥、设备 token、邮箱 token、完整 envelope 或用户消息。

1. 核对源码、桌面 Relay 进程与移动包是否来自同一个 Git commit；修改后必须重启桌面 Relay，不能只热更新 Web/iOS。
2. 记录本机版本：`/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex --version`。
   Desktop 检测和 Relay 启动均优先使用这个新版内置路径；不存在时依次尝试旧版
   `Contents/Resources/codex` 和其他安装。显式配置的 `codex_bin` / `CODEX_BIN` 仍优先。
3. 用该版本的 `codex app-server generate-ts --experimental --out <临时目录>` 核对 `Model.ts`、`ThreadSettingsUpdateParams.ts`、`TurnStartParams.ts`。生成文件只作为版本化观测，不提交为稳定协议。
4. 在本机受控调试会话调用 `model/list`，只记录字段名、模型 id 和可选值，确认目标模型确有 `supportedReasoningEfforts`、`serviceTiers`。不要记录账户或认证材料。
5. 在 Desktop adapter 加密前的 session snapshot 中检查：

   ```text
   session_config_options ids = model, reasoning, speed
   reasoning.currentValue 属于当前模型 supportedReasoningEfforts
   speed.currentValue = default 或 serviceTiers[].id
   ```

6. 从 Web/Mobile 解密后的 catalog 状态检查相同 ids。若 Desktop 有三个而客户端只有一个，检查是否消费了旧 catalog、错误浏览器授权或旧 app 包；不要在 Server 日志中寻找密文内部字段。
7. 选择推理项后，确认 adapter 发出 `thread/settings/update { threadId, model, effort, ... }`；选择 Fast 时 `serviceTier="priority"`，切回标准时 `serviceTier=null`。
8. 确认收到 `thread/settings/updated`，桌面 Relay 返回相同 `request_id / session_id / config_id` 的 `session.configure_result`；发起操作的客户端只在解密并校验该结果后显示“已应用”。失败时必须解密 `session.configure_error` 并显示本机错误，不能继续显示旧的“已发送”成功提示。
9. 随后的 `session.config_updated.config_options` 和下一次 catalog 应继续反映新值，供其他已授权客户端及重连恢复使用。
10. 启动下一 turn，确认测试桩收到继承后的 `model / effort / serviceTier`；标准速度清除后不应残留 `priority`。

## 6. 测试覆盖与建议命令

现有关键覆盖：

- `tests/codex-adapter-restart.test.mjs`：旧目录 model-only 降级；动态目录；非法值拒绝；线程设置更新；标准速度清除；重启恢复；`turn/start` 继承。
- `tests/remote-e2ee-relay.test.mjs`：设置成功结果按请求关联并保持端到端加密，Server 看不到配置值。
- `tests/web-inline-approvals-runtime-settings.test.mjs`：Web 不再渲染通用运行设置面板，同时保留 Kimi 原生会话设置的加密确认链路。
- `mobile/test/state/app_controller_session_test.dart`：Mobile 等待、校验并应用加密设置结果，且展示桌面端返回的失败。
- `mobile/test/ui/workbench_parity_test.dart`：即使 catalog 带有 model/reasoning/speed，Mobile 输入区也不展示通用选择器。
- `tests/server-blindness.test.mjs`：Server 可见序列化结果不含业务明文，篡改路由 AAD 会导致认证失败。

建议最小回归：

```bash
node --test tests/codex-adapter-restart.test.mjs
node --test tests/remote-e2ee-relay.test.mjs
node --test tests/web-inline-approvals-runtime-settings.test.mjs
node --test tests/server-blindness.test.mjs
node mobile/tool/flutter.mjs test test/state/app_controller_session_test.dart
node mobile/tool/flutter.mjs test test/ui/workbench_parity_test.dart
```

还应保留一个“真实 app-server 版本烟测”：初始化本机 app-server，读取 `model/list`，断言默认模型至少生成 `model`，并按目录是否存在数组条件性断言 `reasoning` 与 `speed`。该烟测不应把具体模型名称、默认 effort 或 Fast 可用性固化为跨版本不变量。

## 7. 安全边界

- 明文端点仅是已授权 Web/Mobile 客户端与本机 Desktop Relay/app-server；Server 不持有内容密钥。
- Server 可见 `device_id`、`browser_id`、`session_id`、`request_id`、`command_type`、时间、状态和 envelope 大小。它能知道“发生了一次会话配置命令”，但不能知道选择了哪个模型、effort 或 tier。
- `config_id`、`value`、完整 catalog、设置更新事件都必须留在 `A256GCM` envelope 内；不得加入可搜索的 Server 字段、普通日志、分析事件或错误上报。
- Desktop 解密后必须校验内外层路由一致，并且只接受当前 `model/list` 广告的值；未知值 fail closed。
- “标准”必须通过清除 tier 或 app-server 明确支持的当前-turn `default` 语义表达，不能把展示字符串直接下传。
- app-server schema 是实验性的版本化本机接口。升级 Codex Desktop 后应重新生成 schema、运行真实目录烟测和 Relayune 回归测试，再决定是否调整 adapter。
