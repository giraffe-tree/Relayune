# Agent 真实流程验证

可复用的定位经验、覆盖边界及后续自动化路线见
[Agent 接入测试经验与自动化路线](qa/agent-integration-testing-lessons.md)。

2026-09-08，通过 Relayune 的实际适配器依次连接本机 CLI：Codex 0.153.4
（ChatGPT 内置二进制）、Kimi Code 0.39.1、Claude Code 2.1.177。
使用临时项目和真实模型响应，不用模拟器替代真实流程。测试会消耗账户额度。

| 流程 | Codex | Kimi Code | Claude Code |
| --- | --- | --- | --- |
| 新建项目、目录和目录登记回读、幂等重试 | 通过 | 通过 | 通过 |
| 新开会话、首轮消息 | 通过 | 通过 | 通过 |
| 多轮记忆、会话目录、历史回读 | 通过 | 通过 | 通过 |
| 批准命令后检查文件内容 | 通过 | 修复后通过 | 通过 |
| 拒绝命令后确认文件不存在 | 通过 | 通过 | 通过 |
| 原生子 agent 调用、完成事件和任务快照 | 通过 | 通过 | 通过 |
| 工具调用后的上下文保持 | 通过 | 通过 | 通过 |
| 适配器重启后恢复会话 | 通过 | 通过 | 通过 |
| 同一项目的独立会话不串上下文 | 通过 | 通过 | 通过 |
| 等待审批时停止，旧审批失效 | 通过 | 修复后通过 | 通过 |
| 停止后继续多轮对话 | 通过 | 通过 | 通过 |

本轮修复：

- Kimi ACP 审批请求可能只有工具标题和 `content`，没有 `rawInput`。
  原来卡片只显示 Bash，现保留命令说明或文件差异。
- Kimi 加载会话期间连续发送两条消息会同时通过运行状态检查，覆盖当前轮次。
  现提前预留会话启动状态；加载失败释放预留，关闭适配器后禁止继续发送。
- Kimi 停止或结束轮次后残留待审批记录。现按会话撤销并清理，禁止迟到审批执行旧操作，
  保留其他会话的审批。
- Web 的 Cowork 回归用例仍要求页面内声明 AgentProvider；现检查实际共享类型来源。

验证包括 166 项适配器、项目、工具、审批和 Web 回归，19 项加密与服务端盲存储测试，
`npm run typecheck` 和改动文件 ESLint。新增并发、失败重试、关闭时加载、审批内容及中断清理测试。
Web 检查是代码回归；本记录不代表 macOS/iOS/Android 页面逐项人工点击验收。

## 重跑

在已安装并登录相应 CLI 的电脑执行：

```sh
node scripts/test-agent-live.mjs codex
node scripts/test-agent-live.mjs kimi
node scripts/test-agent-live.mjs claude
```

每个成功结果输出 JSON，包含测试临时目录 `cwd` 和 `sessionId`。
关闭第一次运行的进程后，用对应结果验证恢复流程：

```sh
node scripts/test-agent-live.mjs kimi --recover <sessionId> <cwd>
```

替换 provider 即可测试其他 CLI。`AGENT_LIVE_TIMEOUT_MS` 可调整单轮等待时间，默认 180 秒。
脚本只批准测试目录内的精确写文件命令，其余审批拒绝；中断用例保持审批待处理后停止。
Kimi 显式选择当前测试会话的 default 模式，Codex 选择 manual，确保验证人工审批路径。
测试保留临时目录及 CLI 会话记录供核验，不推送、发布或修改生产环境。

本机 PATH 的 npm Codex 安装缺少 vendor 二进制；Relayune 的自动解析优先选择可用的
ChatGPT 内置 Codex，因此不影响本次实际接入验证。未修改全局 npm 安装。
