# MiniMax Code beta 接入

2026-09-27。本次验证版本：`@minimax-ai/code@0.5.5`，macOS arm64，Node 22.19.0。

## 使用

在 Relayune 的侧栏 Agent 设置中选择 **MiniMax Code · Beta**，默认仍只显示
Codex、Claude Code 和 Kimi Code。桌面 Agent 页面支持检测、安装和打开本机登录。
官方安装器会准备兼容的 Node；自行 npm 安装需 Node 22.19+ 或官方支持的新版 Node。
本机先执行 `mcode login`（国际账户用 `mcode login --region global`），或在 mcode
配置自己的模型。Relayune 不读取、复制 MiniMax 的凭据文件。

Relay 以 `mcode acp` 启动，支持 `MCODE_BIN` 和官方 `MCODE_INSTALL_DIR` 路径。
独立运行可使用 `RELAY_ADAPTER=mcode node relay/cli.mjs relay`，其余 Relay 环境配置不变。
多 Agent 模式自动探测已安装的 mcode，单家不可用不影响其他 Agent。

## 本版范围

- 会话发现、新建、文本对话、流式文本、工具开始/结束、计划更新。
- 权限请求显示命令或文件信息，只提供上游声明的单次允许/拒绝。
  审批 ID 绑定本次连接；过期、取消、退出后的旧审批不能用于另一条请求。
- 停止任务、独立 ACP 连接回放历史、分页、重启后恢复并继续会话。
- 本机状态探测使用 ACP `initialize` + `session/list`，无登录态不能显示已就绪。
- 不自动改变 mcode 的本机权限模式。若用户在 mcode 已配置自动执行规则，
  Relayune 只展示 mcode 实际发出的审批，不承诺所有工具都会弹出审批。
- 当前 ACP 声明不支持图片，Web/手机禁用该 Agent 的图片入口，适配层也拒绝图片。
- 模型、长期权限策略在本机 mcode 配置；暂不提供额度和独立子 Agent 面板接入。
  不把 Kimi 工具解析结果套用为 MiniMax 子 Agent。

## 可重复验证

协议夹具依照官方 `packages/tui/src/acp/agent.ts`、`interactions.ts`、`updates.ts`
的消息形态构造，不需要登录：

```sh
node --test tests/mcode-adapter.test.mjs
```

真实已安装 CLI + 隔离数据目录 + 本地模拟模型，不使用用户账户、不消耗模型额度：

```sh
MCODE_BIN=/absolute/path/to/mcode node scripts/test-mcode-local.mjs
```

运行进程的 Node 也需满足 mcode 的兼容要求。脚本只写临时测试目录，并在结束时清理。
验证未登录的启动拒绝、真实 ACP 握手、流式文本、允许/拒绝/取消的文件副作用、
历史回读、进程重启和恢复后的再次发送。测试各权限决定使用独立会话，避免前一会话
已授权工作目录影响下一用例；只有收到对应审批才认为覆盖了审批链路。

本次结果：协议及相关适配回归 41 项通过；跨端目录/加密路由相关回归 46 项通过；
桌面单测 127 项通过，原生运行时单测 8 项通过；手机相关测试 70 项通过。
Web 类型检查、手机静态检查和测试映射检查通过。真实 CLI + 本地模型脚本通过。
这些结果不代表 MiniMax 云端账户、实际模型质量、图片或子 Agent 能力已验收。

生产 Web/API 未部署；账户侧 beta 显示偏好的服务端白名单也需随正常版本发布更新。
