# ZCode CLI 多端接入

这里的 ZCode 指 Z.ai / 智谱的 ZCode Agent。当前支持其 `app-server --stdio`
运行时，通过 Relayune Desktop Relay 向 Web、iOS、Android 提供会话列表、历史、
新建、文字和图片输入、流式回复、工具输出、中断和一次性权限审批。

## 安装与连接

桌面检测列表标为 **ZCode (community CLI)**。安装按钮使用固定版本的社区启动器
`zcode-app-cli@3.11.2-22`，它包含本轮验证的 ZCode 0.16.5 运行时；它不是 Z.ai
官方发布的 CLI。Relayune 不随安装包再分发该运行时。

先在本机启动 `zcode` 完成模型设置，再启动 Relayune。模型配置与凭据由 ZCode
管理，Relayune 不读取、迁移或上传它们。桌面显示 CLI 就绪只代表可执行文件和
版本检测通过，不代表模型认证或额度已验证。

默认多 Agent 模式自动接入；独立运行可设置 `RELAY_ADAPTER=zcode`。
非标准安装可给 Relay 设置 `ZCODE_BIN`，指向支持 `app-server --stdio` 的可执行
文件。当前不会自动导入 ZCode Desktop App 的会话、OAuth 登录或工作区；CLI 的
独立存储通常位于 `~/.zcode/cli`，不能把 CLI 会话可用等同于 Desktop 原会话同步。

## 协议与边界

- 使用独立的行分隔 JSON RPC；不能套用 OpenCode ACP 或 Codex 协议。
- 反向运行偏好请求显式关闭宿主搜索增强；新会话使用 `build` 模式，保留工具审批。
- 只允许一次性批准或拒绝。审批过期、停止、进程退出时清理等待状态；未知反向请求
  返回不支持，不自动代答问题或注入认证头。
- 新建空会话可能直到首次发言才由上游保存，Relayune 不提前显示“已持久化”。
  自定义标题、模型切换、独立子 Agent 创建、用量汇总、计划确认和交互式问答尚未接入。
- 仅继续本适配器启动的轮次；不支持向运行中轮次追加输入，也不承诺控制另一个
  ZCode Desktop / CLI 进程中正在执行的任务。
- 使用现有加密链路；Server 不新增明文或凭据字段。运行时 stderr 不转发到 Relay 日志。

## 验证

本轮使用社区包中实际 ZCode 0.16.5 运行时，隔离 HOME 和模型配置，验证发现、新建、
历史读取，并连接本机 HTTP 模型夹具验证真实运行时的发送、流式事件、完成及历史
回放。该验证没有调用真实付费模型；审批、图片载荷、中断、进程失败另由 stdio
协议夹具覆盖。原生设备界面和 ZCode Desktop 原会话未联调。

来源：
- 官方产品：https://zcode.z.ai/en/docs/agents
- 社区启动器：https://github.com/kingsword09/zcode-cli
- 协议交叉参考：https://github.com/william0wang/zcode-acp/blob/main/docs/PROTOCOL.md
