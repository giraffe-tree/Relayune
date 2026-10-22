# OpenCode 接入

Relayune Desktop 的多 Agent 模式会启动 `opencode acp`，Web、iOS 和 Android
可选择 OpenCode，读取会话历史、继续对话、接收流式输出、处理中断和工具审批。
传输继续使用现有端到端加密链路。

先在电脑上安装 OpenCode 并配置可用模型。Desktop 可安装 CLI；检测通过代表
CLI 版本满足要求，不代表模型凭据或额度已验证。自定义 CLI 路径可通过
`OPENCODE_BIN` 提供给 Relay；单独运行可设置 `RELAY_ADAPTER=opencode`。
官方安装与模型配置：https://opencode.ai/docs/
官方 ACP 协议入口：https://opencode.ai/docs/acp/

已用 OpenCode 1.18.29 实测握手、会话列表、新建和空历史回放。流式消息、审批、
中断与失败清理由 ACP 子进程夹具验证；尚未进行真实模型生成及各端原生 UI 联调。
最低版本保守设为本轮实测版本，启动时另检查 ACP 会话发现能力。

当前不提供 OpenCode 模型切换面板、用量汇总或单独的新建子 Agent 接口；
模型配置沿用本机 OpenCode 设置。不能中途追加消息，需先停止当前轮次。
