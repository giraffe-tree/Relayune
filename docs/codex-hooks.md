# Codex 桌面任务的手机审批

Relayune 通过 Codex 的 `PermissionRequest` Hook 接收官方桌面端或独立 CLI
产生的普通人工权限请求。手机使用现有审批卡片；Server 仍只接触加密载荷。
不需要包装启动 Codex，也不要求两个客户端共用 app-server。

## 当前范围

- 支持 macOS / Unix 本机 Relay；Windows 暂不注册此 Hook。
- 手机可以允许一次、拒绝，或选择 **Return to Codex** 交回原生审批。
  不提供“以后全部允许”，避免 Hook 改写会话审批策略。
- 仅当请求所在回合的 `approvals_reviewer` 明确为 `user` 时转发。
  `auto_review`、`guardian_subagent`、未知值、缺失或不可读取的回合记录均直接返回 `{}`。
  等待期间再次切换到 Auto Review 时，回传前的复核也会取消手机决定。
- Auto Review 后转交人工的接入暂缓。本实现不监听该阶段，也不处理普通文字追问或
  `request_user_input`。选择全部允许而未产生权限请求时，手机不会凭空显示审批。
- Relayune 自己启动的 Codex app-server 设置 `RELAYUNE_SKIP_CODEX_HOOKS=1`，
  继续走其已有 RPC 审批通道，避免重复卡片。

## 启用与停用

包含本改动的 Relay 启动并连接成功后，默认在 `$CODEX_HOME/hooks.json`
（默认 `~/.codex/hooks.json`）增量注册 Hook，仅对 `multi` / `codex` 入口生效。
已有其他 Hook 保留；配置损坏、符号链接、用户改过受管理定义时停止写入并记录不含业务内容的提示。

**注册不等于 Codex 已允许执行。** Codex 要求用户审核并信任确切的 Hook 定义。
在使用同一 `CODEX_HOME` 的 Codex CLI 中打开 `/hooks`，确认 Relayune 的命令路径后信任它，
再重启或重新载入官方桌面端任务。Relayune 不修改信任数据库，不设置 bypass 参数，
不覆盖管理员对 Hook 的禁用设置。更改启动命令后可能需要重新审核。

源码运行方式：

```sh
node relay/cli.mjs codex-hooks status
node relay/cli.mjs codex-hooks install
node relay/cli.mjs codex-hooks uninstall
```

打包后的 macOS App 可使用同样的子命令：

```sh
/Applications/Relayune.app/Contents/MacOS/relayune-core codex-hooks status
```

安装器绑定当前可执行程序的绝对路径和 Codex home，不依赖 Hook 的工作目录或 PATH。
应使用准备长期运行的 Relayune 版本注册；源码路径移动或 App 删除后需重新安装或卸载 Hook。
`uninstall` 保存停用意愿，后续 Relay 启动不会重新注册；显式 `install` 才重新启用。
`RELAY_CODEX_HOOKS=0` 可临时禁止 Relay 启动监听和自动注册，不影响已有直接 RPC 审批。
`status` 只报告文件注册情况，不声称 Codex 已信任或手机已在线。

## 请求生命周期与安全边界

1. Codex 调用同步命令 Hook。客户端只读 rollout 末尾最多 2 MiB，倒序找匹配
   **当前 `turn_id`** 的最新 `turn_context`，不使用全局配置或其他回合猜测。
2. 客户端通过 `$CODEX_HOME/relayune-hooks/approval.sock` 联系现有 Relay 进程。
   目录 `0700`，socket `0600`，检查本机 UID，拒绝不安全路径，不监听 TCP 或 HTTP。
   这是同一 OS 用户下的本机 IPC，不增加 broker、凭据文件或明文业务存储。
3. Relay 独立复核回合，生成一次性审批编号和动作摘要；命令和工作目录只经现有
   每客户端独立密钥的 E2EE 通道发送。未授权客户端不能通过此入口建立授权。
4. 手机回复仍校验设备、会话、摘要、nonce、期限和可选决定。重复、过期、串单及
   不支持的选项都不能产生允许结果。只有普通人工请求的明确允许才返回 Hook `allow`。
5. 等待上限为 90 秒，Hook 总超时配置为 120 秒。Relay 不在线、Hook 进程断开、
   Relay 退出、超时或错误时交回 Codex 并使手机卡片失效。手机离线通常要等到超时；
   Relay 有授权客户端并不意味着该手机此刻在线。交回原生后最终是否弹窗由 Codex 策略决定。

socket 内的请求及待审批状态只在进程内存中存在；outbox 保存的仍是密文。
本机同一 UID 下的恶意程序不在此隔离边界内，和 Codex 本身的本机配置具有相同信任边界。
手机“已批准”表示决定已交给 Hook 传输，不能当作命令已执行或执行成功。

同一 Codex home 只允许一个 Relay Hook 监听者，第二个实例会保留原生审批。
启动锁和配置锁只在短暂写入期间存在；若进程在此期间崩溃留下 `*.lock`，应在确认没有
Relay 运行后检查并移除对应锁。正常运行后崩溃留下的 socket 可由下次启动安全回收。
进程重启不恢复旧 Hook 决定；旧卡片只能过期，不会自动重放成允许。

## 验证记录

2026-09-08：本机 Codex Desktop 0.153.4 的 `hooks/list` 在隔离 `CODEX_HOME` 中
识别安装器生成的 `permissionRequest` 命令，`enabled=true`、`timeoutSec=120`，
无 warnings/errors，初始为 `untrusted`，符合原生信任要求。

自动化测试覆盖实际 CLI 子进程与 Unix socket、允许/拒绝/交回原生、回合匹配、
Auto Review 跳过与等待中切换、断线/超时/退出、双实例互斥、配置保留，以及
Relay 审批校验和 outbox 不含明文。测试使用构造的权限事件；不等同于真实手机和
官方桌面任务的完整人工验收。正式手机验收还需运行包含本改动的 App 并完成 Hook 信任。

参考：[Codex 官方 Hook 文档](https://learn.chatgpt.com/docs/hooks)。

2026-09-08 补充：[iOS 模拟器验收](qa/codex-hook-ios-simulator-verification.md) 已通过
真实页面的允许、拒绝与源端文件副作用检查。该轮由测试脚本显式调用 Hook；本机原生
Hook 仍为 untrusted，不能将手机回传通过等同于官方 Desktop 自动触发已验收。
