# Claude Cowork 接入

Relayune 使用独立的 `claude-cowork` provider，在 Web、iOS 和 Android 中浏览本机
Claude Cowork 项目、历史消息，并接管可恢复的空闲任务。macOS Relay 的 `multi`
模式自动加载此 provider。

## 使用方式

1. 在 Claude Desktop 的 Cowork 中创建任务，并选择本地项目目录。
2. 在 Relayune 选择 Cowork，打开同步的项目和任务。
3. 保持 Claude Desktop 已登录，并先停止其中的同一任务，再从 Relayune 继续。
4. 在会话设置中选择模型或权限模式；Relayune 启动的工具审批通过原有加密审批界面处理。

当前不在 Relayune 创建新的 Cowork 任务。模型候选来自本地同账户任务中已记录的模型，
并非服务端实时可用模型列表。设置覆盖保存在 Relay 进程内，作用于下一次由 Relayune
恢复的任务；重启 Relay 后重新读取 Cowork 原有配置。

## 本地数据与运行协议

- 自动发现 macOS Application Support 下 Claude 数据目录中的
  `local-agent-mode-sessions`；`spaces.json` 提供项目目录。
- `local_*.json` 的 `userSelectedFolders` 决定项目工作目录；内部 `cwd` 可能是
  Cowork 的输出目录，不适合作为用户项目分组。
- Relayune 使用 `local_*` 作为任务标识，并将 `cliSessionId` UUID 用于 Claude CLI
  的 `--resume` 和标准输入消息。历史来自该任务 `.claude/projects/` 下的 JSONL。
- 运行使用 Cowork 随附的 Claude CLI、该任务的 `CLAUDE_CONFIG_DIR`，以及
  stream-json / stdio control-response 协议。不会通过修改历史或审计日志触发审批。
- 接管前检查 Desktop 任务进程；无法确认空闲时拒绝恢复。用户仍应避免在 Relayune
  执行期间从 Claude Desktop 再启动同一任务，因为双方没有共享的事务锁。

## 授权与验证边界

Cowork 临时授权从本机 `host-creds-*.json` 读取。接入层验证文件权限、所有者、到期时间
和持有进程，只将授权环境变量传给子进程；不写入 Relayune 配置、日志或服务器。
授权缺失或失效时，已有历史仍可浏览，恢复任务会返回明确错误。

会话配置、消息、审批和历史继续使用 Relayune 现有端到端加密通道。
Claude Desktop 自己已弹出的审批不会被此接入自动接管；审批闭环仅覆盖 Relayune
启动的恢复任务。自动化测试覆盖目录映射、历史 provider、恢复消息格式、配置和审批协议；
真实服务端续接需要当前有效的 Cowork 授权进行独立验证。
