# Desktop Relay 退出诊断

Desktop 将结构化生命周期日志保存在 Tauri 的本机应用日志目录。macOS 默认路径：
`~/Library/Logs/cn.giraffetree.agent-relay/relay-lifecycle.jsonl`。
轮转文件为同目录的 `relay-lifecycle.previous.jsonl`。当前文件达到 1 MiB 后轮转，最多保留这两个文件；Unix 新文件权限为 0600。

出现“本机 Relay 意外退出”时，先保留这两个文件，再点击重新连接。按 `desktop_pid`、`generation`、`relay_pid` 关联启动与退出事件，比较 `exit_code` 和 `signal`；`terminated_requested` 表示桌面当时正在停止，`terminated_unexpected` 表示未处于停止状态。`process_observer_error` 和 `process_stream_closed` 是桌面观察通道故障，不等同于子进程已退出。旧代次的退出单独记为 `terminated_stale_generation`。`desktop_started` 能帮助识别跨重启的残留进程。

日志包含 UTC 时间和应用版本；仅记录固定事件及错误类别，不记录原始 stdout/stderr、异常文本、参数、环境变量、路径、URL、设备标识或会话内容。每代进程每种错误类别最多记录 8 条，随后记一次 `stderr_limit_reached`。未识别的错误记为 `stderr_unclassified`，不能由此推断具体原因。日志写入失败不会阻止应用启动。强制杀死桌面应用时可能来不及观察子进程退出；日志并不保证覆盖系统断电或原生崩溃，必要时同时检查 macOS DiagnosticReports。
