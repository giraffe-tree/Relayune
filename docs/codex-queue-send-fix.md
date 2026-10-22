# 修复：Codex Desktop 占用会话时远程发送消息失败

交接说明：Relayune 向 Codex Desktop 创建的 thread 发消息时可能失败，本文给出已实测验证的修复方案。

## 2026-09-08 实现更新：只读查看、owner 队列与逐条跟踪

- 查看历史/权限不会触发 `thread/resume`；读不到权限时保持未确认。
- 发送给已通过本机 Desktop IPC 确认 owner 的线程，直接 `thread/queue/add`。无法确认 owner 时保留显式发送的恢复路径；发生 active writer 冲突后入队。
- 删除每 60 秒尝试 resume 的后台接管逻辑。队列跟踪只读 `thread/queue/list`、`thread/read` 和本机 rollout，绝不因等待超时接管。
- 使用 `clientUserMessageId` 与历史 `userMessage.clientId` 精确对应，区分 queued / running / completed / failed / interrupted / unconfirmed。队列消失、文字停止输出、入队成功均不等于执行完成。
- 非 owner 的 `thread/read` 在真实 0.153.4 中可能把运行中轮次返回为 interrupted；因此终态须由 rollout 的 `task_complete` / `turn_aborted` 确认。无法读取生命周期时保持未确认。
- 入队前持久化标识回执，重启恢复只读跟踪。同一消息 ID 并发去重；入队 RPC 超时后核对原 ID，不盲目重发。回执只存 ID 和时间，消息明文不进入新存储或服务端。
- 手机和 Web 按消息 ID 更新等待提示；其它消息开始执行不会清除本消息提示，迟到的入队回执不会覆盖新状态。跟踪 35 分钟后仍无法确认则提示未确认，不声称成功。

当前实现没有在每轮结束后关闭 app-server，也没有增加单线程强制解锁。以下旧版重试方案仅作历史记录。

## 2026-09-08 更新：0.153.4 持锁方会自动执行跨进程入队消息

本机真实实验已更新下文旧版本结论：独立 app-server A 持有会话，B 的 `thread/resume` 被 active writer 拒绝，但 B 的 `thread/queue/add` 成功后，**A 自动执行该消息并完成回复**。没有关闭 A、没有再次 resume，也没有调用 `thread/queue/start`。完成后 A 仍加载线程，B 从未加载线程且继续无法 resume；队列已清空。

实验版本为 `codex-cli 0.153.4`，使用专用新会话和两条真实模型消息，测试后归档。完整实验记录（内部验收档案未随公开源码提供）。这证明“两个客户端交互”可以通过同一持锁方完成，不要求两个 app-server 同时获得写锁。

因此，下文“持锁方不会主动消费、必须等待释放”的结论与 35 分钟重试建议仅保留为 `0.151.0-alpha.7.2` 历史观测，不能直接作为当前版本行为描述。当前队列路径仍需区分“已持久化入队”和“已实际执行”；本实验不保证其他版本、离线 owner、等待审批或正在运行时的所有队列行为。

## 症状

`thread/resume` 返回错误：

```
code -32600: thread <id> already has an active writer
```

## 原因

Codex 用 OS 文件锁管理每个 thread 的写入权：`~/.codex/thread-writer-locks/<thread-id>.lock`。
Codex Desktop 会把最近打开的 thread 持续加载在内存里并持有锁，直到「无订阅者且无活动
30 分钟」自动卸载，或退出 App 才释放。期间任何其他 app-server 进程都无法
`thread/resume` / `turn/start` 该 thread。

## 原修复方案：thread/queue/add（0.151.0-alpha.7.2 历史记录）

codex ≥ 0.151 的 app-server 提供队列方法（实测版本 `0.151.0-alpha.7.2`）：

```
thread/queue/add | list | start | delete | update | reorder
```

前提：`initialize` 时必须声明实验能力：

```json
{ "method": "initialize", "params": { "clientInfo": {...}, "capabilities": { "experimentalApi": true } } }
```

### 实测结论（0.151.0-alpha.7.2）

- `thread/queue/add` **不需要 writer 锁**：Desktop 占用中的 thread 也能入队，
  消息立即持久化，`thread/queue/list` 可查。
- 持锁方（Desktop）**不会主动消费**队列；`thread/queue/start` 要求本进程先 resume
  （会被锁挡住，报 `resume the thread before starting a queued message`）。
- 锁空闲时：本进程 `thread/resume` 成功后 `thread/queue/add`，消息会被**自动立即
  执行**（无需再调 `queue/start`），正常落盘、turn 完成。

### 发送流程（伪代码）

```
try:
  resume(threadId)          # 现有路径
  turn/start(content)       # 现有路径
except "already has an active writer":
  thread/queue/add(threadId, input=[{type:"text", text:content, text_elements:[]}],
                   clientUserMessageId=clientMessageId)   # 消息持久化排队，不丢
  标记消息为「已排队，等待 Desktop 释放会话」
  启动后台重试：每 60s 尝试 resume(threadId)
    - 一旦成功：队列会被自动消费执行（或先 queue/list 再 queue/start）
    - 确认消息进入历史后标记「已发送」，停止重试
  重试总上限建议 35 分钟（覆盖 Desktop 30 分钟卸载窗口）
```

### 注意点

- 幂等：`clientUserMessageId` 用 Relayune 的 `clientMessageId`，`queue/list` 返回中
  同名字段可用于去重。
- `queue/delete` 的参数名是 `queuedSubmissionId`（不是 `submissionId`）。
- 每个 thread 队列上限 100 条。
- 能力探测：0.150 及更早版本没有 queue 方法（可用
  `codex app-server generate-ts --out <dir>` 或捕获 method not found 判断），
  老版本回退为「明确报错 + 纯后台重试」。
- UI 提示文案建议：「该会话正在 Codex Desktop 中打开，消息已排队，关闭后会自动发送」。

## 相关代码

- `relay/codex-adapters.mjs`：`CodexAppServerAdapter.submitMessage`（发送入口，
  在此加 queue 分支）、`initialize`（加 `capabilities.experimentalApi`）。
- `scripts/test-codex-desktop-message.mjs`：连通性测试脚本，可扩展验证 queue 路径。

## 已知遗留问题（可顺带修）

`verifyUserMessage`（`relay/codex-adapters.mjs:586`）的持久化校验窗口太短：
`turn/start` 后 userMessage 约 5 秒才落盘，当前只在 ~160ms 内重读 3 次就放弃，
导致 `persisted:false` 误判，且脚本退出杀进程会把 turn 打成 interrupted。
建议改为等待 `user.message` 事件或延长到 10~15 秒指数退避。
