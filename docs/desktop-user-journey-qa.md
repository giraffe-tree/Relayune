# Relayune macOS / Windows 用户旅程 QA

初始记录日期：2026-08-10；本篇保留后续逐次追加的历史 QA 证据。
不同段落中的“本轮”“当前产物”和锁屏状态仅适用于当次记录，不是现行发行状态。
官方 0.3.33 的最终构建、安装与生产连接以[官方联合升级清单](official-deployment.md)为准。

## 证据范围

### 2026 AI 产品官网一手参考

2026-08-09 重新浏览了 [Cursor](https://cursor.com/)、
[Linear](https://linear.app/)、[v0](https://v0.app/)、
[Lovable](https://lovable.dev/) 与 [Replit](https://replit.com/) 当前官方首页。
只迁移与启动到登录相关、不会增加理解成本的模式：

- Cursor 在单一主动作后立即展示有明确可访问描述的真实产品界面，再接可信客户和安全证明；
  Relayune 对应保持“连接/登录”主动作先于演示，并让安全说明贴近动作。
- Linear 用一条连贯任务从请求、Agent 处理中到待审阅结果，动效服务状态变化而非装饰；Relayune
  对应只让当前启动、等待、恢复和完成阶段变化，不叠加无关转场。
- v0 与 Replit 把可执行输入放在解释之前；Replit 还用“之后可修改、第一次无额外成本”的短句
  降低试错压力。Relayune 对应继续把一次登录/8 位码作为首要路径，并明确无需令牌或长密钥。
- Lovable 用“提出想法 → 实时成形 → 调整发布”三步叙事，同时给 Security/Trust Center 明确出口；
  Relayune 对应使用“桌面发起 → 浏览器登录/输入码 → 继续本机任务”的有限三步和可见安全边界。

当前抓取还显示 Cursor、Linear、Lovable 首页有显式 skip link，v0 的 Vercel 登录页先说明
“登录 v0”上下文再列邮箱、SSO 与第三方入口，Lovable 和 Replit 则把 Security / Trust 入口放在
公开旅程中。客户端渲染的登录失败提示和官网的 reduced-motion 行为无法仅由官方文本抓取证明，
因此不据此臆测错误持续时间或复制动效；Relayune 只迁移可证实的键盘入口、上下文和信任提示。

这些页面都没有理由让装饰动效压过主动作。Relayune 已有手动暂停，但旧状态在进入登录再返回、
切换中英文或刷新后会丢失，用户必须反复关闭干扰。本轮将这一非秘密布尔偏好保存在本地；
存储不可用时控件仍直接生效。它不会进入 URL，也不会与 locale、pairing id 或短码共用键。

本轮本地真实浏览器复验已启动隔离 QA API 和 Next 开发站，但 Chrome 控制通道在命名会话时
超时并重置，未获得新的 DOM / 截图证据；服务已正常停止。下面此前已完成的四档 Browser
矩阵仍保留为历史证据，本轮新增的密码/配对错误语义只声明 typecheck、lint 和定向测试结果。

### Desktop WebView 浏览器模拟补充

本轮新增仅在 Vite development 模式且带显式 `relayune-desktop-qa` 参数时启用的
Tauri invoke / event mock。它不记录 invoke 参数、PAKE share、请求体或随机 8 位码；
production build 已检查不到 QA 参数、样例浏览器或 QA workspace 标记。mock 可稳定构造
preparing、启动失败后重试、首次连接、已连接和 Relay 错误状态，并可让配对请求保持等待
或进入恢复阶段。视觉取证使用码值遮罩，URL 仍只携带随机 pairing id。

本轮真实 QA 页面还暴露出一项模拟边界缺口：后台 updater 返回“无更新”后，前端会把
`update_available=false` 同步给原生菜单，但 mock 没有实现该生产命令，导致健康的首次
连接页凭空显示 `update_failed`。development-only bridge 现已接纳并无状态地完成
`set_update_available`，且不读取或保存参数；`webview-journey.test.ts` 锁定该命令不能再
回退到 unknown error。修复后由应用内 Browser 真实打开中文和英文首次连接页：两者只
显示对应语言的主动作与“一次完成”说明，不再出现 update_failed 或混合语言；没有点击
生成码，因此未读取、截图或输出任何短码。

真实浏览器已分别渲染 520×720 macOS 中文首次连接、520×480 Windows 英文首次连接、
320×400 英文窄窗和 420×420 英文已连接首页。四个视口中首要动作、长英文状态、浏览器
设备名省略和纵向滚动均可用，没有发现应用自身横向溢出；320px 截图右侧浮层来自浏览器
控制扩展，不属于 Relayune WebView。浏览器扩展随后在配对点击/截图调度中持续超时，内置
Browser 在当前环境不可用，因此 preparing、失败诊断、连接恢复、设置、取消和退出的后半程
改由可执行源码/几何测试补证据，没有把测试结果表述为真实点击。

本轮主线还在 520×720 macOS 中文视口真实打开了冷启动失败页，确认“重试”和诊断入口
可见；触发开发态的单次恢复动作后，页面自动回到“连接这台电脑”首次连接页。随后尝试的
520×480 Windows 英文 `/start` 瞬时失败恢复旅程因浏览器控制通道超时而中止，因此该路径
只采用 Vitest / Node 状态机证据，不声明已在真实 Windows WebView 中点击完成。

窄窗审计发现连接开始后二维码先于默认的 8 位码，倒计时又位于整个二维码区域之后，
会在 420×420 和 320×400 下把核心输入码路径推到首屏外。现在 480px 以下优先排列码值，
倒计时紧邻码值操作；同时在宽高都受限的窗口收起可选二维码和配对品牌动效，让码值、
重新打开/复制与取消保持在主路径前部。520×480 仍保留并排二维码，不牺牲正常 Windows
窗口的扫码路径。新增 `webview-journey.test.ts` 锁定四档宽度、dialog gutter、纵向滚动、
reduced-motion、development-only harness 以及启动/配对/取消/成功/退出的焦点去向。

后续对抗审计又补齐了可串行驱动的 QA action：启动失败重试、生成码后取消、新浏览器
生成码后取消、设置取消和确认退出都会等待目标状态真正可见且可操作再推进，不读取或输出
码值。设置对话框同时发现一项真实键盘/双语缺口：原生 `type=url` 校验可能使用系统语言，
绕过 Relayune 的稳定错误映射；Codex/Kimi/Claude 路径或自动启动失败也只显示 toast，焦点仍停在
保存按钮。表单现在统一由应用校验，失败后聚焦并选中对应字段；透明开关还增加了可见的
`:focus-visible` 环。当前 Chrome 扩展在新一轮开始会话时持续无响应，内置 Browser 仍不
可用，因此这些后半程 action 只保留为可执行 harness 与 Vitest 证据，未新增真实点击声明。

最新一轮 Browser 会话同样在建立阶段超时，因此没有新增真实 DOM、点击或截图证据，也没有
重试控制通道或启动替代浏览器服务。本轮新增的是可执行 harness / Vitest 证据：启动失败后
切换语言会从稳定 `DesktopErrorCode` 和最近一次脱敏 `RelaySnapshot` 重新生成诊断摘要与日志，
不会在前端保留 raw error；`bootstrap` 尚不可用时，设置入口保持原生 `disabled` 并关联当前
启动说明，失败文案只指向真实可用的“重试”和“帮助与诊断”，不会再打开无法保存的空设置框。
QA actions 还锁定了默认浏览器 handoff 失败后有效配对仍可取消；所有步骤只等待码区域非空，
不读取、输出或截图码值。

本次 Web 子代理显式选择 in-app Browser 时返回不可用；按 Browser 技能执行一次连接恢复检查
后只发现外部 Chrome，因此该子任务没有切换控制面或伪造真实证据。主代理随后在自己的
in-app Browser 会话中以当前 production self-hosted 构建真实复验 360×800 英文首页与
`/?login=1` 启动错误页：两页 `html/body` 宽度均为 360px，URL 不含语言或连接码。该复验发现
英文错误页的备用价格链接仍显示汉字“中文价格”，且 SPA 从营销首页切换到错误页后焦点停在
`body`；现分别改为 `Chinese pricing`，并把焦点送到可程序聚焦的错误标题，使用克制的品牌色
焦点环。语言按钮还为目标文案声明 `lang=zh-CN/en`，避免读屏沿用错误发音规则。可执行审计
另发现 Web 配对取消按钮消失后焦点会随按钮一起丢失；现在状态复位后焦点和选择会回到重新
启用的连接码字段。360px CSS 也从不存在的 `.pairing-code-input` 修正为实际
`.pairing-code-field input`，确保最小视口获得紧凑字距。真实复验没有打开有效配对页，也没有
读取、记录或截图连接码；取消配对仍由无秘密的 harness / Vitest 证明。

同一 production Browser 在 320×560 英文首页确认 `html/body` 无横向溢出，但首个 Download
主动作从约 548px 才开始，只露出按钮边缘且文字完全位于首屏下方。现在仅对宽度不超过
360px 且高度不超过 620px 的首屏收紧顶部留白、标题、说明和动作间距；360×800 与产品预览
的 `min-height` / 定位不变。可执行几何测试按五行英文标题、六行说明和 48px 主动作的保守预算，
把按钮底部约束在 530px 内。主代理随后用最终 `build:self-hosted` 在同一 production Browser
真实重测：主动作从约 406px 开始、454px 结束，完整按钮、文字和下一动作均可见，页面宽度仍
严格为 320px；修复前后的差异因此同时具有真实 DOM、截图和自动化几何证据。

最新 production Browser 又在英文首页点击 Sign in，捕获到工作台懒加载期间约 0.3 秒的
中英混合状态；同一启动错误页切换语言时还会重新执行 bootstrap 网络流程，把焦点从语言按钮
抢回错误标题。当前实现按本地语言偏好或浏览器语言为 fallback 选择唯一文案，并在 fallback
子树显式声明 `lang`、挂载后同步根文档语言；bootstrap 错误只保存稳定 kind，渲染时按当前
语言翻译，首轮加载 effect 不再依赖 locale，标题聚焦也只在错误 kind 首次出现时执行。语言
按钮的 `aria-label` 使用当前页面语言（`Switch to Chinese` / `切换为英文`），目标语言只标在
可见字形上。子任务 Browser 按技能恢复一次后仍连接超时，因此修复后真实时序、焦点与根
`html lang` 由主线统一 production Browser 复验；本轮只声明新增渲染测试、稳定错误测试与
effect 接线测试通过。配对 URL、日志和截图均未读取或加入 8 位码。

主线随后在最终 `build:self-hosted` 上完成该复验：从 `/en/` 点击 Sign in 后，懒加载阶段只
显示 `Opening secure workspace…`，正文没有汉字且根文档保持 `lang=en`；错误页的语言按钮
读屏名称为 `Switch to Chinese`，切成中文后焦点仍停留在同一按钮，新名称为“切换为英文”，
不会再跳回错误标题。正式 build 还会精确重写 `/en/**` 每份静态 HTML 的首字节语言及 Next
序列化根布局语言；英文首页、价格、条款和隐私页都从初始 HTML 即声明 `en`，英文分享元数据
不再继承中文根标题。语言探测被拆到轻量模块，公开首页恢复原有 JS 预算且不下载完整认证
字典；构建产物测试同时锁定上述首字节、序列化状态、分享元数据和 bundle budget。

本轮再次按 Browser 技能把最终 `dist/self-hosted/` 暴露为只读本地 production 静态站；Chrome
控制在会话建立和按文档恢复一次后都超时，随即停止本地服务，没有改用替代自动化。可执行
审计确认 `/`、`/zh/`、`/en/` 的首字节语言分别为 `zh-CN`、`zh-CN`、`en`，构建 CSS 含
320/360 紧凑布局、520/820 移动布局、键盘焦点和 `prefers-reduced-motion` 降级；现有响应式
测试锁定 320×560、360px 最小断点的长英文换行、主动作、产品预览与短码字段，构建 CSS 规则
审计确认 390、768、1280 分别落入预期的手机、平板和桌面区间，但本轮不把规则匹配表述成
新的视觉渲染证据。源码审计同时发现 Web API 合并调用方取消和 15 秒超时时使用
`AbortSignal.any()`；[WebKit 官方说明](https://webkit.org/blog/15063/webkit-features-in-safari-17-4/)
确认该 API 到 Safari 17.4 才加入。Desktop 构建目标却是 Safari 16，且首次连接取消也需要立即
终止仍在等待的请求。Web 与 Desktop 现共用 `shared/abort-signal.ts` 中的兼容组合器，任一信号
都能取消，并在请求结束后移除长生命周期 listener；Desktop 取消还会中止本次 run 的网络
请求和恢复等待，旧 run 不会误绑定到下一次连接的取消信号。自动化实际覆盖调用方取消、预先
取消、dispose 后不再传播和 Desktop run 接线。

主线随后用当前 Vite DEV-only QA bridge 和真实 Browser 复验 Desktop：英文 Windows
520×480 首次连接按钮完整可见，文档宽度严格等于视口；420×420 生成连接码后，码、剩余时间
和取消动作均可见，非必要二维码按短高度规则隐藏且无横向溢出。点击取消会清空连接状态并把
焦点送回登录按钮。配对进行中从英文切成中文时，连接码保持不变，URL 仍只含 QA 场景参数；
真实交互还发现语言按钮的读屏名称曾使用目标语言、原生 `disabled` 会在 native tray 同步期间
丢掉焦点。现中英文名称分别为“切换为英文”与 `Switch to Chinese`，仅可见目标字形声明目标
`lang`；按钮用 `aria-disabled` / `aria-busy` 和并发守卫保持原位焦点。测试只返回码的格式与
长度布尔值，没有读取、输出或截图实际 8 位码。

本轮以四层证据审计桌面端从冷启动到再次使用的主路径：

1. `node --test` 和 Vitest 自动化验证协议、错误短码、退出撤销、Web 认证双语、平台打包及源码交互契约；
2. 对 Tauri 前端、Rust 生命周期、Relay 重连状态机和浏览器邮箱登录页面进行源码级用户旅程模拟；
3. 对 production identity 的最新 macOS `.app` 做构建、Developer ID 签名、Apple 公证、staple 和 Gatekeeper 产物准入；
4. 用独立 identifier 的 unsigned debug QA `.app` 做隔离真机交互，并保留尚不能触达的 macOS 菜单栏及全部 Windows 真机清单。

此前 production identity 的 universal macOS `.app` 已成功构建，Developer ID 签名有效，Apple notarization 状态为 `Accepted`，`stapler validate` 与 `spctl` 均接受该产物。该包内 `relayune-core` 已分别以 arm64 和 x86_64 强制启动，两种架构都进入 Relayune 业务入口并按预期仅因测试环境未提供 `RELAY_SERVER_URL` 退出。当前共享树此后仍有 UX 与诊断边界改动，因此这份公证产物是发布流程证据，不冒充当前源码的最终发布包。为避免打断正在连接的生产 Relayune，本轮有意没有启动完整签名 `.app` 主进程。原生窗口交互改在独立 identifier 的 unsigned debug QA `.app` 中完成，以隔离生产进程和凭据。

Computer Use 已在此前隔离 QA 包中验证：中文首屏可见、可切换英文、英文设置页可用、无效 URL 草稿点击 Cancel 后没有保存，以及点击红色关闭按钮后应用进程仍驻留。英文首次连接页还实际完成了 Tab 焦点顺序检查，设置对话框打开后初始焦点位于关闭按钮，Escape 关闭后焦点返回设置入口。当前共享树重新构建 `desktop/dist` 和 Rust debug binary，写入独立 `cn.giraffetree.agent-relay.menu-qa` 包并重新 ad-hoc 签名；macOS 子任务没有修改前端源码。此前实际点击红色关闭后 Finder 桌面不再出现窗口，`pgrep` 仍只看到该 QA 主进程；从应用菜单点击 Quit 后进程消失。此前 QA 包还实际启动了交互式第二实例和带 `--background` 的第二实例：两次启动都立即正常退出，进程列表始终只保留最初实例，证明 macOS 运行时不会启动第二份 Relay。菜单栏图标现在通过 AppKit 的 `NSStatusBarButton` 显式设置本地化 VoiceOver label、help 和稳定 identifier；Relay phase、tooltip 与辅助功能名称通过同一互斥刷新链更新。未登录状态改为“尚未连接 / Not connected”，不再与已配对后主动停止混淆；高频 Relay publication 只读 `AppState` 的非秘密 paired 缓存，不会反复访问 Keychain，配对、退出、撤销和回滚会同步更新该缓存。独立 Menu QA 包还确认语言偏好会写入本地配置，改为英文后以 `--background` 冷启动仍保持英文。此前解锁轮次的可用 AX 树仍不暴露 SystemUIServer 状态项；本轮主 Agent 后来确认 Finder 已解锁并看到 QA bundle 进程启动，但 Computer Use 通过路径和 bundle id 读取应用状态都超时，随即按精确路径清理该测试进程。因此“实际点击状态项恢复”“OS 最终焦点”“Cmd-Tab / Dock 形态”和“VoiceOver 实际朗读”仍未验证。当前也没有 Windows 10 / 11 执行环境。隔离 QA 包的交互证据不能替代 production identity 签名包在 identifier、Keychain、updater 和发布配置上的运行验收。

最终稳定树已再次重建并 ad-hoc deep sign 上述独立包：`LSUIElement=true`，
`codesign --verify --deep --strict` 通过，当前 executable SHA-256 为
`ec3381d659e6285f1cb1616f9f112786f0425a58e03432c78949406c5aac2b78`。该 binary 以
`tauri/custom-protocol` 强制嵌入最终 production `desktop/dist`，签名 executable 与
静态资源均未命中 QA harness 或 source-map 标记，当前 runtime assets 为
`index-CEvqiW5O.js`、`index-D65FT62e.js` 和 `index-BfjKgbSY.css`；旧
`index-DHiydG6l.js`、`index-fQExl_Zv.css`、`index-BmIPXywd.js`、`index-CNqkryUj.js`、`index-PanlNBzI.js`、`index-u4KtyRn4.js`、`index-B-8UxIkW.css`、`index-BmxJRJCs.js`、`index-CgimPnF3.js`、`index-BgrqRdVR.js`、
`index-B0lseDUX.js`、`index-qhiYydWf.css`、
`index-BuWQ-1vB.js`、
`index-60oRSg0I.js`、
`index-Dg1gLZWJ.js`、
`index-DHyu0Exv.js`、`index-DKDwA_uJ.css`、
`index-Bwc5g6uf.js`、
`index-DoEZBQmH.js`、
`index-BRbItvAt.js`、
`index-Bgk8AGmc.js`、
`index-DwQmE_jX.js`、`index-DMwDJzAB.js`、`index-BhB2Rz-U.js`、
`index-DnxoJPru.js`、`index-DUVUUto6.js`、`index-BI9eNXbB.js`、`index-CrR58-t9.js`、`index-B9S1b2rO.css`、`index-CRZdQiXG.js`、`index-CF1dFSHd.js`、`index-BTStyW5e.js`、`index-DYAGBifZ.js`、`index-D-kemNcP.js`、`index-Dbf_XROV.js`、`index-ExRzmwhr.js`、`index-CscBfeYJ.js`、`index-DsSUCjJQ.js`、`index-DUNySTTn.css` 在签名 executable 与
production frontend 资源均为零命中，且 dist 不含 `.map`。最终 binary 包含 Relay retry
bootstrap、`relaySnapshotAfterBootstrap`、`defer_native_entry`、`record_window_hide_result`、`restore_window_from_native_entry`、
`restore_window_with_hooks`、
`publish_native_action_error_with_hook`、`publish_native_action_error_with_refresh_hooks`、
`refresh_tray_status_for_snapshot_locked`、`refresh_tray_language_locked`、`publish_relay_snapshot_with_hooks`、
`publish_relay_snapshot_with_retry_hooks`、
`mark_process_event_error`、`mark_process_event_error_with_hook`、`mark_process_stream_closed`、
`mark_connected_with_hook`、`mark_reconnecting_with_hook`、
`record_native_window_action_dispatch_result`、`emit_native_window_action`、
`reconcile_bootstrap_native_presentation`、
`reconcile_cleared_secret_native_presentation`、
`reconcile_durable_config_native_presentation`、
`reconcile_pairing_rollback_native_presentation`、
`begin_bootstrap_request`、`bootstrap_request_is_current`、`invalidate_bootstrap_requests`、
`cancel_browser_pairing`、`lock_tray_update`、`lock_tray_items`、`tray_items_snapshot`、
`initialize_tray_presentation_with_hook`、
`setup_tray`、`record_initial_tray_accessibility_result`、`native_menu_recovery_available`、
`set_non_windows_launch_at_login_with_hooks`、`set_launch_at_login`、
`set_ui_language_with_refresh_and_save`、
`reconcile_known_credential_presence`、
`tray_presentation_phase`、
`has_window_hide_recovery_surface`、`hide_main_window_with_hook`、`window_hide_recovery_available`、
`schedule_windowed_recovery_confirmation`、`macos_windowed_recovery_policy_is_active`、
`request_windowed_recovery_surface`、`schedule_runtime_windowed_recovery_confirmation`、
`record_windowed_recovery_policy_confirmation`、`window_hide_recovery_surface_is_active`、
`record_native_menu_visibility_result`、`macos_status_item_is_visible`、`validated_window_hide_recovery_surface`、
`restore_window_after_recovery_surface_loss`、
`restore_window_after_recovery_surface_loss_with_hooks`、
`PRE_SETUP_NATIVE_RESTORE_PENDING`、`request_pending_native_restore_with_hook`、
`take_pending_native_restore`、
`restore_window_from_native_entry_with_hooks`、`schedule_native_entry_recovery_check`、
`schedule_native_entry_recovery_check_with_hooks`、
`stop_for_exit`、`stop_exit_target_with_hooks`、`take_exit_stop_target`、
`stop_reserved_target_with_hooks`、`take_stop_target`、`reserve_start_generation`、
`kill_relay_child`、`kill_relay_pid`、`confirm_process_exit_with_hooks`、
`confirm_macos_relay_process_exit`、
`reserve_start_with_failed_runtime_recovery`、
`record_start_preflight_result_with_hook`、
`commit_reserved_start_with_hook`、`cancel_uncommitted_start`、
`RelayConfigChangeGuard`、`start_with_config_change_admission`、
`start_during_config_change`、`runtime_requires_restart_for_config_change`、
`begin_relay_config_change`、`finish_relay_config_change`、`relay_config_change_in_flight`、
`process_transition_with_hooks`、`safe_process_plugin`、`request_restart`、
`defer_interactive_exit_stop`、`defer_interactive_exit_stop_with_hooks`、
`begin_exit_stop`、`complete_exit_stop`、`cancel_exit_stop`、
`get_bootstrap`、`complete_pairing`、`complete_browser_pairing`、
`revoke_browser_authorization`、`logout`、`stop_relay`、`clear_secret`、
`set_ui_language`、`set_update_available`，
以及 safe process plugin 的 `exit` / `restart` 命令与异步响应闭包；
`relay_stop_failed`、`window_failed`、`update_failed`。当前 binary 还静态包含 `Help & Diagnostics…`、`Quit Relayune`、`帮助与诊断…`、`退出 Relayune`，证明两条 bootstrap durable-language 恢复路径可以通过完整语言刷新同步菜单尾部标题。当前 `index-D65FT62e.js` 还包含首次配对阶段、语言按钮双语、
`retryingStartup` 状态及“正在重试… / Retrying…”双语忙碌文案、
`browserAuthorizationActionsDisabled` 编译后的 `stage !== "idle"` 动作禁用逻辑，以及
“撤销 {name} 的授权 / Revoke access for {name}”双语命名动作；源码标识经 production
minify 后不会保留，但当前 asset hash、编译逻辑与 copy 均已逐项核对。该资源中的统一
update gate 实际同时携带 `installing-update/pairing/config/settings/language/logout/revoke/relay-start/workspace-picker/native-language-reconciliation`
十项 in-flight 状态；workspace picker、Relay retry 与后台原生语言核对均和 updater 互斥，且
保留 `Default working folder`、`Reconnect` 与更新忙碌提示，证明根线 update/workspace/relay
事务进入本次嵌入资源。首次配对失败会把本地化 error presentation 保留到刷新后的登录面，
该资源包含“无法完成安全连接。现有连接没有改变，请重试。”及
“Could not finish the secure connection. Existing access is unchanged. Try again.”，
不会因 bootstrap 刷新立即消失。该资源还包含当前
中英文恢复/更新菜单和稳定凭据诊断事件码。该 asset 还把 `pairingDeadlineExpired`
编译为有限正数 deadline 与 `Date.now() >= deadline` 的判断，并由 1 秒 interval 驱动
`tickPairingExpiry`；waiting / recovering 的短码一旦过期会立即清空并显示双语过期提示，
不再留下可见但无效的连接码。此前隔离运行使用 `AGENT_RELAY_TEST_MODE=1`、独立绝对配置路径、
loopback Server、128-bit 随机 device account、空 `browser_ids`、关闭随启动运行 Relay 的配置和
`(deny network*)` sandbox，且没有引用 production credential account。本轮收尾按严格边界
没有启动应用、检查 UI、查询 Keychain 或执行状态项/关闭/恢复/Quit；
当前哈希只完成 production asset 嵌入、符号、独立 identity 与签名产物验证，
红色关闭、恢复和显式 Quit 的真实点击证据来自此前同轮 QA binary，不把它冒充为最新包重测。

本轮又对同一隔离包执行了一次当前态复验：英文未登录窗口冷启动可见；红色关闭后 Finder 获得焦点且 PID 仍驻留；随后按同一 bundle identity 恢复，AX 焦点回到 Relayune 的 HTML content，进程表仍只有原 PID。`lsappinfo` 对该运行进程报告 `ApplicationType=UIElement`，给出了实际 Accessory/Dock 隐藏形态的运行时证据。SystemUIServer 与 Dock 的 Computer Use/AX 读取仍超时，因此这项证据仍不能代替状态项实际点击、Cmd-Tab 枚举或 VoiceOver 朗读。

较早的 continuation 中 Mac 曾反复锁屏；本轮主 Agent 已确认 Finder 解锁，并启动重建前的独立 QA bundle，系统进程列表确认该独立 bundle id 正在运行。但 Computer Use 通过应用路径和 bundle id 两次读取状态都超时，无法取得可靠画面或 AX 树，因此立即停止 UI 操作，并只按精确 QA executable 路径终止该测试进程、确认没有残留。为避免把 setter 调用或“进程已启动”当成辅助功能已生效的证明，原生实现现在会在每次写入后从具体 `NSStatusBarButton` 读回 label、help 与 `RelayuneMenuBarItem` identifier，任一不一致都会使更新失败。新增无 harness 的 `macos_menu_ax_probe` 还在 macOS 主线程真实创建状态项和 `NSMenu`：先验证英文未连接状态下唯一连接主动作可用、Web 工作台禁用，再切换为中文已连接状态并验证“显示 Relayune”、Web 工作台、诊断和退出的标题与 enabled 状态，最后移除菜单和状态项；该可执行探针已随完整 `cargo test` 以退出码 0 通过。它证明原生属性与菜单状态链可写可读，但仍不等同于 VoiceOver 扬声器实际朗读或用户点击 production 状态项。

锁屏期间新增的 Tauri `MockRuntime` 运行探针直接调用生产 `handle_tray_menu_event`，而非只匹配源码或读取标题：没有 `main` 窗口时依次触发连接/显示、未连接 Web 入口和诊断回调，三次都实际进入 `show_window` 失败路径、记录 `relayune:window_failed`，并确认没有误发 `open-diagnostics`；创建 mock `main` 窗口后，探针以不会打开浏览器的无效测试 URL 触发已配对 Web 回调，确认浏览器校验失败被记录、共享恢复链成功执行，随后才收到诊断事件。显式 Quit 的 `app.exit` 在 Tauri MockRuntime 中未实现，因此最新 binary 的 Quit 仍只能引用此前隔离包真机证据，不能声明本轮重新点击完成。

## 2026-08-09 完成 / 未完成矩阵

| 目标 | 现有证据 | 结论 | 尚未覆盖的真机证据 |
| --- | --- | --- | --- |
| 中英文官网到登录的连续旅程 | `/zh/` 与 `/en/` 使用独立营销字典包；`marketing-i18n.test.mjs` 校验结构、英文无汉字、ARIA、动效暂停偏好持久化与当前语言入口不下载另一语言；构建器与 `rendered-html.test.mjs` 保证 `/en/**` 首字节和序列化根语言为英文、英文分享元数据无汉字；本轮 production DOM 证明 `/en/?login=1` 旧实现仍停留营销页，现由 locale route 先呈现英文安全加载态，再规范化到根认证入口，只转送 login、set-password 与合法随机 pairing id；真实浏览器此前完成 360 / 390 / 768 / 1280px 中英文首页到登录矩阵，并验证 CTA 不被产品预览遮挡、英文懒加载单语、语言切换焦点、对比滑杆键盘操作、登录错误页与 locale-aware 返回首页 | 自动化与浏览器交互完成；营销页进入登录使用 history entry，可用浏览器后退，错误/过期页也有 44px 首页出口；用户暂停动效后刷新、登录往返或切换语言仍保持暂停；四档视口均无横向溢出，公开入口保持 JS budget；修后应用内 Browser 实际访问 `/en/?login=1&locale=zh&debug=true`，最终 URL 仅为 `/?login=1`，英文错误恢复页保持单语；中文损坏 pair 同样规范化为 `/?pair=` 并聚焦中文错误标题 | 尚未在 Safari、Edge 和系统读屏中各完成一次完整视觉与键盘验收；运行主机未开启系统 reduced-motion，真实验收只覆盖了手动暂停 |
| 配对成功后的 Web 工作台双语 | `web-workbench-language.test.mjs` 枚举 200+ 份工作台文案，校验中英文非空、变量占位符一致、英文 UI 文案无汉字，并检查顶部语言切换及工作台 JSX / handler 接线；`web-auth-language.test.mjs` 覆盖登录前语言持久化与隐私边界 | 自动化完成 | 尚未在真实邮箱登录及配对成功会话中，对中英文完整页面各做一次浏览器视觉、键盘和读屏验收；用户消息、Agent 输出和后端业务内容不属于 UI 翻译范围，仍可使用其原始语言 |

右侧 Agent 面板的页签和标题必须复用同一个 `子 Agent / Subagents` 字典键；语言契约测试会拒绝配对后工作台回退为硬编码英文 `Agents` 或 `Subagents`。

邮箱状态检查或首次验证邮件发送失败时，错误必须作为表单内持久 `role=alert` 保留，并通过 `aria-describedby` 与邮箱输入关联；不得只依赖会自动消失的 toast。用户编辑邮箱或重新提交后再清除，切换语言时从稳定错误键即时重译。

工作台检测到新子 Agent 并自动跟随最新内容时，程序化滚动也必须读取系统 `prefers-reduced-motion`：普通模式使用平滑滚动，减少动态效果模式使用瞬时定位。CSS 禁用动画不能代替这项 JavaScript 行为约束。

工作台并行委派子 Agent 使用同步 in-flight guard，慢请求期间输入保持可聚焦但只读，提交动作以 `aria-busy` / `aria-disabled` 和当前语言的 live status 呈现。重复点击不能启动第二组相同任务；成功后清理已提交任务并聚焦 Agents 页签，失败则返回原委派动作。移动端委派按钮保持至少 44px 触控高度。当前证据为中英文 source contract 与定向测试，尚未在真实已登录、已配对会话中创建生产子任务。

工作台停止任务也使用同步 ref gate：30 秒请求窗口内重复点击不会再发送第二条 `interrupt_turn`，停止期间不能同时提交相互矛盾的新消息；按钮保持可聚焦并以 `aria-busy` / `aria-disabled`、双语“正在请求停止…”和既有 live region 表达事实。成功后焦点进入输入区，失败则返回原停止按钮。当前没有安全可用的生产运行中任务，因此该路径由状态机和 Node 契约证明，不冒充真实停止点击。

从登录页脚进入价格、条款或隐私页面后，Relayune 品牌入口必须回到当前语言首页（`/zh/` 或 `/en/`），不得统一落到中文根页；品牌的可访问名称也必须使用当前页面语言（`Relayune 首页 / Relayune home`）。
| 原生 / sidecar 错误不穿透英文 UI | `desktop-native-error-language.test.mjs` 枚举稳定错误码，校验英文映射无汉字；未知原生错误按命令降级为稳定码；toast、状态和诊断不插入原始 OS / sidecar 文本。Desktop Vitest 与 Rust 测试同时通过 | 命令边界和渲染边界自动化完成 | 尚未在英文系统上真实注入 Keychain、Credential Manager、sidecar 启动、网络和更新错误并截图确认 |
| macOS 产物、Accessory、菜单栏和窗口恢复 | 此前 production identity universal `.app` 已通过 Developer ID 签名、Apple 公证、staple、Gatekeeper 以及包内 arm64 / x86_64 sidecar 双架构业务入口 smoke；`desktop-signing.test.mjs` 还用合成双 slice fat Mach-O 实际执行偏移修复，约束“生产签名定型 → 绝对偏移修复 → 重签 → 双架构 smoke”的顺序；`desktop-user-journey.test.mjs` 验证 `Accessory`、single-instance、后台启动不抢焦点、关闭改隐藏、未登录/停止状态区分、paired 缓存、原生 VoiceOver label/help、隐藏期间状态原子刷新及所有入口共用唯一恢复链；Rust 对抗测试还用一秒 deadline 实际执行幂等 Start/Stop，防止运行状态锁递归死锁，并约束状态项创建失败后切回 Regular、后台启动也显示唯一恢复窗口；新增 close-to-background hook 还实际证明状态项与 Regular fallback 都失败时不会调用 hide，而会发布 `window_failed` 保留最后一个窗口；隔离 QA `.app` 的早先 binary 已实际完成启动、关闭后进程驻留和显式 Quit；当前轮唯一一次 Finder 状态读取确认 Mac 锁定，随后未启动应用或访问 Keychain | 发布流程、双架构 sidecar、偏移算法、隐藏/恢复、菜单状态、幂等 Relay 生命周期与辅助功能自动化边界完成；隔离包的早先所列交互完成；当前源码的完整原生窗口运行准入未完成 | 当前 production identity 发布包尚未重建运行；本轮锁屏，未进行当前源码的状态项点击、Dock / Cmd-Tab、OS 实际焦点或 VoiceOver 朗读；仍需验证隐藏时连接状态 |
| Windows DPI、托盘与安装器准入 | `windows-desktop.test.mjs` 读取实际的 `tauri.windows.conf.json`、viewport 和 CSS，在 100% / 125% / 150% 下计算最小逻辑视口、dialog gutter、紧凑布局、可滚动高度与长文案换行；验证 Windows 左键托盘事件、菜单动作、single-instance 都只能进入唯一的 `unminimize → show → set_focus` 链，命令 shim / sidecar smoke 均隐藏控制台；浏览器 handoff 使用 `ShellExecuteW` 并检查失败返回码；Windows 2022 CI 会先执行合成升级生命周期，精确清理后再独立执行当前安装器的 clean install 与首次后台/交互启动，WebView2 注册表访问失败不能伪装成 Runtime 缺失；CI 与正式本地 `desktop:build:windows` 都在 `tauri build` 后解析最终 GUI / sidecar PE，再验证唯一 NSIS、合理大小、Authenticode 状态和 SHA-256，拒绝 Console GUI、动态 `VCRUNTIME140*`、缺资源、缺 ASLR / DEP 或损坏签名的产物；两轮 lifecycle 还会在首次启动前分别对已安装 GUI 与 sidecar 和当前源 PE 做 SHA-256 精确比对，避免 target 门禁通过但 NSIS 实际携带旧 payload；本地全新交叉 release PE 已通过同一检查，Windows MSVC cross-check 已通过 | DPI 数值、恢复路径、浏览器失败恢复、隐藏进程、静态 VC Runtime、PE/安装器及 CI/交叉编译契约完成；两轮 lifecycle 脚本、安装后 payload hash 与新增 PowerShell NSIS 门禁尚未在本机或已完成的 workflow 中执行，Windows 原生准入未完成 | 仍需 Windows 10 / 11 真机确认 WebView 在三档 DPI 的实际渲染、任务栏/托盘恢复焦点、默认浏览器拒绝后的恢复、无控制台闪窗、Credential Manager、SmartScreen、签名安装 / 覆盖升级 |

本轮全量 Next production build 后通过 Node `182/182`；当前 Desktop Vitest `84/84`、Rust unit `106/106`，macOS 原生状态项辅助功能探针另以退出码 0 通过，均为零失败。`npm run typecheck`、`npm run desktop:check`、Desktop production build 和 `npm run build:self-hosted` 同样通过；Windows contracts `11/11`、MSVC x64 `--tests` cross-check 通过。Lint 为零错误，仅有宣传视频脚本中的 3 个既有未使用函数警告。Node 集成测试需要允许绑定本机 loopback，Next 首次构建也需要下载配置的 Google Fonts；受限沙箱中的网络或 `listen EPERM` 是执行环境限制，不是产品失败，允许所需网络与 loopback 后全量通过。依赖真实生产 URL、设备身份和部署中 MongoDB 的两条线上探针未在本地伪造环境变量执行，仍属于部署准入。

### 本轮新增的强约束

- Desktop 更新安装保持焦点：首次登录前也可能出现更新卡；下载、验签、安装与安全重启期间，已按下的主动作保持原生可聚焦，并以同步 guard、`aria-busy` / `aria-disabled` 拒绝重复 relaunch。失败后仍回到同一重试动作，不会在最长的更新阶段落到 `body`。
- Desktop 新增浏览器 starting 焦点：授权列表的 Add 动作在配对面打开后会被重建，persistent header 动作也会立即不可用；现在 `pairingStage="starting"` 第一次 render 后、任何 PAKE 或网络 await 前，浏览器授权路径同步把焦点交给稳定且本地化的 `pairingPanelStatus`。慢安全连接不会让键盘或读屏上下文落到 `body`；finishing 阶段继续复用同一稳定状态，失败才返回精确重试入口。Desktop Vitest source contract 锁定 starting 与 finishing 两次焦点交接，本轮未生成或读取真实短码。
- 设置保存保持焦点：路径校验、LaunchAgent 写入、配置持久化和 Relay 重启可能持续数秒；提交按钮现在保持原生可聚焦，以同步 guard、`aria-busy` / `aria-disabled` 与“正在保存 / Saving”拒绝重复提交并表达忙碌事实。成功关闭设置弹窗后焦点明确回到“设置”，失败仍进入可修正字段，不再在提交开始时落到 `body`。
- Web locale cookie fallback 与首屏预算：语言偏好仍优先读取 localStorage；Safari 隐私模式、存储策略或异常让它不可用时，同站 `relayune_locale=zh-CN|en` cookie 维持登录/营销入口语言，写入使用 `Path=/`、一年 Max-Age、`SameSite=Lax`，HTTPS 时追加 Secure。无效 cookie fail closed 回到系统语言。最终 production 首屏脚本计量为中文 `686000` bytes、英文 `685942` bytes；本轮没有为 fallback 提高既有 budget，单语言首屏仍不会加载另一语言营销字典。
- Web workspace session 交接焦点：从项目抽屉、Agent 卡片、父会话返回或会话列表切换 workspace 时，统一的 `openWorkspaceSession` 会先提交目标 session、关闭抽屉并切到 workspace 面板，再在下一帧把焦点移入新的 workspace 标题；不会让焦点停在已卸载的抽屉按钮或旧会话。`agent-status-ui.test.mjs` 锁定所有入口复用该 helper、当前项使用 `aria-current=page` 且交接后聚焦标题；本轮没有登录生产工作台做真实点击或读屏朗读。
- Web 会话草稿隔离：消息草稿不再是跨项目、Provider、主线程和子线程共享的一条全局字符串，而是按 session id 独立保留。切换工作区只展示目标会话自己的未发送内容；发送请求的异步闭包绑定发起时会话，慢失败只能把原文恢复到原会话，不能覆盖用户已经切换到的新会话或造成误发。可执行 source contract 覆盖清空、恢复与会话切换；本轮没有在已登录生产工作台实际发送消息。
- Web 历史读取错误本地化：历史慢请求失败不再把底层 `error.message` 缓存在长期页面状态或直接写入 toast。状态只保留稳定失败事实，详情与提示在每次渲染时从 `historyReadFailed` 按当前语言生成；错误面持续显示时切换中英文会一起重译，也不会泄漏 Relay、解密或运行时原文。既有 alert、重试和焦点恢复语义保持不变；本轮由可执行 source contract 验证，未在已登录生产工作台加载真实历史。
- Windows clean first-run 系统语言：lifecycle 在注入任何隔离测试配置前，以安装包真实 current-user 默认路径执行一次 `--background` 首启并回读生成文件；`ui_language` 字段必须存在且严格为 `null`，让原生层按 Windows 系统语言决定首屏，不能由构建机或测试脚本预置中英文。相同探针同时要求唯一生产 Server、空 `browser_ids`、当前用户 AppData state path 与无 broad-write 权限，再按 GUI/owned WebView2 精确身份清理；11/11 source contract 已锁定，真实执行仍待 `windows-2022`。
- Windows `/UPDATE` 配置保留：基线升级不再只依赖相邻 sentinel 推断用户配置安全。lifecycle 会在更新前写入无秘密、符合当前 schema 的真实 `config.json` fixture，更新后要求文件仍存在且 SHA-256 字节级不变，再精确移除 fixture，让后续 clean first-run 继续从“配置不存在”开始。内容与哈希均不输出；11/11 source contract 锁定写入、更新、验证与移除顺序，实际 NSIS 行为仍待 `windows-2022`。
- Web 状态刷新回焦：同步中断提示里的重试动作成功后会随提示一起卸载；旧路径因此可把焦点留在不存在的按钮并退回 `body`。现在 single-flight refresh 完成后优先聚焦仍可见的状态刷新按钮，否则聚焦可编程的工作区标题；失败时重试动作保持可用，`aria-busy` / `aria-disabled` 与当前语言继续表达进行中事实。Node source contract 锁定成功、失败和控件不可见三条分支，本轮没有把它冒充已登录生产工作台的真实点击。
- 慢启动可安全重试：Desktop bootstrap 超过 4 秒后不再只留下无操作的“继续等待”，而是同时显示本地化 Retry 与帮助诊断入口。点击 Retry 会在 listener setup 前立即失效较早请求；重试动作本身保持可聚焦，以同步 guard、`aria-busy` / `aria-disabled` 和“正在重试… / Retrying…”阻止在线事件或双击启动第二轮 bootstrap，诊断入口也不会在等待时消失。成功后焦点进入真正的登录或状态界面，失败则回到重试动作。每次 `refresh()` 只有最新 generation 能提交 Bootstrap、语言、授权列表清理和首焦点，较早请求即使稍后成功或失败也不会覆盖新登录状态。development-only QA harness 以“第一次 bootstrap 永久 pending、第二次返回首次连接状态”锁定 `startup-slow-retry` 旅程，并继续保证 production bundle 不包含 QA bridge 或调用计数标记。进一步修复了慢准备期间的语言切换：过去 Retry 一旦可见，切换语言会把仍在进行的请求误写成“启动失败”；现在保存稳定的 `preparing / stillPreparing / startupFailed` 事实键并按当前语言渲染。真实 in-app Browser 在隔离 QA 页面等待 4.6 秒后自动切到英文，DOM 仍为 `data-i18n=stillPreparing`、只发起一次 bootstrap，并显示英文慢准备说明、Retry 与 Help & Diagnostics；随后已关闭标签和本机 QA 服务，未触配对或短码。
- 原生 bootstrap 同样 latest-wins：此前窗口侧 generation 只能拒绝旧响应渲染；两个并发 `get_bootstrap` 仍可同时读取配置与安全凭据，较慢的旧请求随后会把旧 config、语言、paired/recovery 状态重新写入 `AppState` 并刷新 NSMenu、tooltip 与 AX。现在每次原生 bootstrap 会在任何慢读取前领取原子 generation，读取继续并发而不会把 Retry 串行堵住；取得 `tray_update` 后只有当前 generation 可以提交状态和原生 presentation，过期请求可以返回给窗口侧丢弃，但不能再调用 refresh。阻塞双线程回归让旧中文/旧 URL 请求停在模拟读取中，证明新英文/新 URL 请求能在一秒内独立完成；释放旧请求后又验证其 refresh 次数为 0，最终 config、原生语言、paired 与 recovery 全部保持新值。Computer Use 本轮唯一一次 Finder 只读检查仍报告 Mac 锁定，随后没有启动应用、访问 Keychain 或读取短码；这里是 Rust 并发与 Node source contract 证据，不冒充真实菜单点击或 VoiceOver 朗读。
- 原生 cross-command generation：仅在 `get_bootstrap` 开始时递增 generation 仍不足以保护用户写入；旧 bootstrap 可以先读到中文 config，随后用户明确切换英文，而旧请求仍被视为 current 并较晚把 `AppState`、NSMenu、tooltip 与 AX 写回中文。现在语言事务会在等待 `tray_update` 前使所有已开始 bootstrap 失效，同值语言请求也按原生 reconciliation 处理；durable settings 的新值与成功回滚、以及已经提交的 paired/signed-out presence 同样在权威内存/native commit 前失效旧 bootstrap。阻塞双线程回归让旧中文 bootstrap 停在模拟安全存储读取中，先完成英文 refresh 与 durable save，再释放旧请求；旧 refresh 次数必须为 0，最终 config/native 语言为英文且 paired/recovery 不被旧凭据结果改写。Node contract 还锁定 invalidation 必须位于语言事务等待原生锁之前。本轮 Computer Use 唯一一次 Finder 检查仍为锁屏，随后没有 UI、Keychain、短码或 QA 包操作；证据属于 Rust 并发、source contract 与后续 AppKit/xwin 准入。
- 凭据清除不会被旧 bootstrap 复活：此前 `clear_secret` 已不可逆删除设备 token 或最后一份内容密钥后，只在内存中临时设置 unpaired，再刷新菜单并启动下一次 bootstrap；若已有旧请求读到完整凭据并较晚提交，而新的安全存储复读又暂时失败，NSMenu 与 Web 动作会重新显示已配对，诱导用户打开已经失效的工作台。现在清除成功后先失效所有已读取旧 presence 的 bootstrap，再在同一个 `tray_update` 事务中提交 paired=false、清除 recovery 并刷新菜单/tooltip/AX；原生刷新失败会保留稳定诊断并重试，但不会回滚已知缺失的凭据状态。阻塞回归先让旧请求记录 paired presence，再完成清除事务并释放旧请求，验证旧 refresh 为 0、Connect/Web enabled 状态不能复活。Computer Use 本轮唯一 Finder 检查仍为锁屏，未调用真实 Keychain clear；证据严格属于纯 Rust 并发、Node source contract 与 AppKit probe。
- Windows 首启 Retry 边界：原生 lifecycle 脚本会用隔离的损坏配置实际等待中英文启动失败说明与可见、可用、可聚焦且支持 UIA Invoke 的“重新尝试 / Try again”按钮；修复同一临时配置后调用 Retry，要求恢复同一 HWND、首次登录 CTA 真正取得键盘焦点、未配对 sidecar 未启动，并在进入后续后台旅程前精确清理该进程树。11 项 Windows source contract 已锁定 UIA 属性、语言来源、配置不变量与清理顺序；当前仍没有 Windows 10 / 11 真机执行结果，因此不能把脚本与源码准入表述成真实安装机点击证据。
- Windows 默认生产配置：lifecycle 在注入隔离测试配置前先以安装包真实当前用户路径后台启动一次，等待应用自行创建配置并回读；Server 必须精确为唯一生产入口 `https://relayune.giraffetree.cn`，浏览器授权必须为空，state path 必须位于当前用户 AppData，且配置目录和文件不能具有 broad write 权限。探针明确拒绝继承 `AGENT_RELAY_TEST_MODE` / `AGENT_RELAY_CONFIG_PATH`，并按同一 GUI 与 owned WebView2 身份清理。该语义由 Windows `11/11` source contract 锁定，Darwin 未执行 Windows 安装包，仍待 `windows-2022` workflow。
- universal sidecar：不再只搜索 `lipo` / `codesign` 关键词。测试从实现中执行真实偏移修复函数，把两份 thin pkg fixture 组合为带 arm64 / x86_64 slice 的合成 fat Mach-O，并验证两个 slice 的 payload / prelude 都被写为 fat 文件绝对偏移、payload 长度不被破坏；同时锁定签名、修复、重签和业务入口 smoke 的先后顺序。
- macOS 隐藏恢复：测试保证配置中只有一个 `main` 窗口，Rust 中只有共享 `show_window` 能直接解析、显示和聚焦它；菜单动作、诊断、Dock reopen、single-instance 和前台启动都必须委托该函数。菜单动作、交互式二次启动和 Dock / Finder reopen 不再丢弃共享恢复链的错误；后两者失败也会使用原生 action 的串行 publication，把含稳定 `window_failed` 的最新 snapshot 推给隐藏 WebView。MockRuntime 同时证明缺少窗口会收到一份 fresh `relay-status`、窗口存在时不会追加错误。后续审计又确认 setup 时的 `window_hide_recovery_available` 只是一次准入快照；若状态项后来不再可见，或此前确认的 Regular policy 失效，旧值仍会把最后窗口隐藏到不可恢复的 Accessory 进程。现在每次关闭都重新从具体 `NSStatusItem.isVisible()`、button 和 `NSApplication.activationPolicy()` 验证至少一个真实恢复面；两者都失效时拒绝 hide 并发布 `window_failed`。进一步对抗审计发现这里仍有 check-to-hide 竞态：状态项可在首次读回后、native hide 执行期间失效。生产路径现在会在 hide 成功后立即重复同一真实核对；若状态项和 Regular 身份都已消失，就调用唯一 `show_window` 链恢复并聚焦原窗口，同时发布 `window_failed`。本轮继续发现第二层失联边界：若这次 show/focus 也失败，旧实现只把 `window_failed` 写进已隐藏 WebView，Accessory 进程仍没有任何可见入口。现在失败分支先清除已失效的状态项准入，再请求 Regular policy 并排队真实 AppKit readback；成功即可恢复 Dock/Cmd-Tab 入口，失败仍保留稳定诊断。纯 Rust hook 分别注入恢复失败/成功，证明只有失败会请求第二 OS 恢复面且不会给成功路径增加 Dock 闪烁；AppKit probe 实际把独立状态项切为 invisible 再恢复并读回，Node contract 锁定 CloseRequested 的前后两次核对、共享恢复链和 Regular fallback。第四轮继续确认主动恢复入口仍有同类但独立的失联路径：窗口已隐藏且状态项消失时，用户从 Finder/Dock 或交互式第二实例触发恢复，show/focus 失败过去只会把诊断发给隐藏 WebView。现在该入口失败后实时核对恢复面；仅当状态项与 Regular 都不可达时复用同一 windowed fallback，状态项仍存在或恢复成功则不改变纯菜单栏 identity。纯 Rust 三分支覆盖“失败且无入口 / 失败但状态项仍在 / 恢复成功”，MockRuntime 继续证明 fresh diagnostic publication，后续 policy readback 不再用误导性的 `startup_failed` 覆盖运行期 `window_failed`。`--background` 的第二实例不会激活窗口，关闭事件只能在恢复面真实可达时 hide，不能退出或停止 Relay。本轮 Finder 仍锁定，证据不冒充 production 状态项关闭/重开真机行为。
- 原生恢复使用 AppKit 主线程真值：Dock/Finder reopen 与交互式第二实例为避免 `tray_update` / 主线程锁反转，会先把 `show_window` 放到 blocking worker；旧失败分支随后却在同一 worker 直接调用依赖 `MainThreadMarker` 的 `NSStatusItem.isVisible()` 与 `NSApplication.activationPolicy()`，两项在非主线程必然返回 false。一次瞬时 show/focus 失败因此会把仍健康的菜单栏恢复面误判为消失，清除 hide admission 并无故切到 Regular Dock/Cmd-Tab。现在失败只安排恢复面复查，具体状态项与 policy getter 回到 AppKit 主线程执行；真实恢复面存在时保留纯菜单栏 identity，只有两者确实不可达或主线程拒绝调度时才 fail closed 请求 Regular。纯 Rust 回归证明 getter 只能在 scheduled callback 内运行，覆盖“状态项仍在 / 恢复面缺失 / 调度失败”三条分支；Node source contract 锁定 `run_on_main_thread` 包围 live getter。本轮 Computer Use 唯一 Finder 检查仍为锁屏，随后未启动应用、访问 Keychain 或短码；证据不冒充真实 Dock/Finder 恢复或 Cmd-Tab 观察。
- setup 前 single-instance 恢复：single-instance 插件在 plugin setup 中启动 socket listener，早于 Relayune 用户 setup 管理 `AppState`；过去极早的交互第二实例会进入无 state 分支，只尝试一次 `show_window` 并丢弃失败。若 WebView 尚未创建，第二实例随即退出，而 `--background` 首实例仍可完成为隐藏状态，用户的打开动作永久丢失。现在无 state 回调先保存原子 restore intent；若隐藏窗口已经可取仍立即显示，失败才复查 state。若 setup 已注册 state 则 callback 自己恢复，否则 setup 消费 intent 并强制覆盖隐藏后台策略。原子 swap 握手保证 callback-first、state-first 以及 setup 恰在复查中消费三种交错都恰有一个 owner，不丢失也不重复恢复。纯 Rust 回归覆盖即时成功、三种 interleaving 和后台行为，source contract 锁定 single-instance 仍最先注册且最终进入唯一 `show_window` 链。本轮 Finder 唯一检查为锁屏，未启动 App/Keychain，因此不冒充真实快速双击启动。
- 窗口恢复准备步骤降级：此前共享 `show_window` 用 `unminimize().and_then(show).and_then(set_focus)`；解除最小化即使只是瞬时或平台特定失败，也会短路本可成功的 reveal/focus，使冷启动、状态项、Dock/Finder reopen 与 single-instance 点击表现为无窗口。现在 `unminimize` 为 best-effort，`show` 与 `set_focus` 仍是必须成功并返回稳定 `window_failed` 的恢复条件。纯 Rust hook 注入解除最小化失败，实际证明后两步各执行一次且整体成功；另一回归证明显示失败仍停止聚焦并返回稳定错误。Node source contract 锁定所有入口继续委托这条唯一恢复链。本轮唯一一次 Finder 状态读取仍为锁屏，随后未启动 QA 包或访问 Keychain，因此未冒充真实状态项点击或 OS 最终焦点。
- 状态项启动可见性准入：此前 `TrayIconBuilder::build` 成功就被视为 background Accessory 模式的恢复入口，但 Tauri 对象存在不等于 AppKit 已把具体 `NSStatusItem` 暴露为 visible；这种部分成功会让登录启动保持隐藏，既无 Dock 也无可见状态项。setup 现在在决定隐藏前从生产使用的具体 AppKit getter 读回 `isVisible()` 与 button；built-but-invisible 会记录稳定 `startup_failed`，进入现有 Regular readback 流程并强制显示唯一窗口。纯 Rust 回归注入“build 成功、visible=false”，证明后台启动选择窗口恢复且 true/true 不制造诊断；AppKit probe 实际把状态项设为 invisible/visible 并逐次读回，Node contract 锁定 readback 必须位于 tray build 与 startup behavior 之间。本轮唯一一次 Finder 状态检查显示桌面已解锁，但没有启动 QA/production app 或访问 Keychain，因此不声称完成当前 binary 的真实状态项启动准入或 Dock/VoiceOver 观察。
- 原生启动降级与幂等 Relay：Accessory 和状态项创建都不再是让 Tauri setup 退出的单点故障；状态项失败会记录参数无关的稳定错误、best-effort 切回 Regular，并在 `--background` 下也显示恢复窗口。后续审计确认 `AppHandle::set_activation_policy` 只把消息排入 Tauri 事件循环，旧实现却立即把 Regular 当成已确认恢复面；一旦 AppKit 最终拒绝或没有应用该请求，用户关闭窗口就会隐藏 Accessory 进程的最后入口。现在 setup 先保持 close-to-background 禁用，再把主线程 readback 排在 policy 消息之后；只有真实 `NSApplication.activationPolicy()` 等于 Regular 才开放隐藏，失败则保持窗口并发布稳定 `startup_failed` snapshot。纯 Rust 回归覆盖 readback false/true 与 fresh diagnostic，AppKit probe 执行生产路径使用的同一 concrete getter；锁屏下独立 probe 不能可靠改变 LaunchServices policy 或证明 getter 返回可用策略，因此不声称完成 Accessory → Regular 往返。Node 契约锁定消息顺序与 getter，不能再把 dispatcher 成功当成 Dock 可达。既有真值表和 hide hook 继续证明双恢复面失败时 hide 调用数为 0。重复 Start 已运行 Relay、重复 Stop 已停止 Relay 时都会先释放 runtime mutex 再读取快照；一秒超时测试直接执行两个核心路径，防止 UI 永久卡在“正在连接”或“正在停止”。本轮唯一一次 Finder 检查仍为锁屏，未启动 QA 包或访问 Keychain，因此不冒充真实 Dock/Cmd-Tab 观察。
- 安全凭据冷启动降级：任何 Keychain / Credential Manager 读取失败都进入本地化 Needs attention / Show 恢复面，不再把空 `browser_ids` 的旧版授权误报成首次连接并诱导重复配对；只有磁盘已知浏览器授权时 Web 菜单才保持启用。纯 Rust 状态矩阵分别覆盖已知浏览器、空列表旧版凭据、真实无错误首次启动和凭据可读四种分支；真实 Keychain 故障注入仍属于解锁真机准入。
- Windows DPI / 托盘：测试按三档 DPI 计算物理和 CSS 逻辑视口，验证 420px 最小窗口会进入 480px 紧凑布局，login、状态动作、dialog footer 和超长英文能收缩/换行；Windows 左键抬起会直接恢复窗口，菜单和托盘事件都不能绕过共享 focus 链；sidecar smoke 会隐藏窗口并拒绝未进入 Relayune CLI 入口的进程。
- 配对恢复：一次性连接码的 10 分钟有效期内，transport、429 和 5xx 波动会进入明确的“正在恢复连接”阶段并持续重试；恢复后返回等待状态，过期和已使用只显示本地化稳定错误，不透传 Server 原文。
- 配对请求完整超时：15 秒 deadline 会一直保留到响应 body 完整读取结束，不再在只收到 HTTP headers 后提前清除。Server 若发出 headers 后卡住 body，会进入可重试超时而不是永久冻结首次登录或把 `null` 误判为成功响应。
- 配对创建恢复：如果首次 `POST /api/pairings/start` 因网络、429 或 5xx 暂时失败，Desktop 会在同一 10 分钟运行窗口内自动重试；若响应已在 Server 成功但回程丢失，后续 `pairing_exists` 只会在随机 pairing id、模式和本次 initiator share 全部一致时恢复原会话。恢复文案不会在连接码尚未生成时谎称码仍有效，取消也会立即中止等待。
- 首次配对交接：新 Relay 进程被系统接受后立即进入可见 Home，不再为了等待完美网络阻塞最多 30 秒；连接阶段和手动恢复动作会继续显示。只有替换仍可用的旧设备时才等待新 Relay 真正上线后撤销旧设备。配对提交成功后先把授权列表置为 loading、渲染可操作 Home 并把焦点送到连接状态卡，再在后台刷新浏览器授权；慢网络不再把用户留在不可取消的 finishing 画面，也不会闪现误导性的空授权列表。
- 配对切换事务：替换设备前先完成所有可失败的状态路径计算；旧 Relay 停止失败、浏览器密钥、设备令牌或配置持久化任一步失败都会恢复旧路径，并用新 token 尽力撤销 Web 已创建的远端设备。只有 device token、没有可用内容密钥的旧设备也会读取 bearer，在新配对成功后远端撤销，但不会为了不可运行的旧 Relay 多等 30 秒。首次配对或新增浏览器已完成本机提交后直接返回已知 paired bootstrap，不再二次读取 Keychain / Credential Manager 而把成功误报为失败。
- 配对回滚与慢 bootstrap：失败配对在验证新 Relay 期间会暂时提交新配置和 paired cache；此前若一个 bootstrap 已读到这份临时状态但尚未取得原生呈现锁，持久回滚恢复旧身份后它仍可晚到，把已撤销设备及 Show/Web enabled、tooltip、AX 状态重新写回内存和菜单。初次配对与新增浏览器的两条回滚现在都在旧配置持久化成功后立即推进 bootstrap generation，并在同一个 `tray_update` 事务中恢复旧 config/paired 与原生呈现；AppKit 刷新失败仍会记录稳定诊断并重试，但不会跳过新凭据清理或旧 Relay 恢复。阻塞双线程 Rust 回归先让旧请求读到临时 paired 配置，完成回滚后再释放它，验证旧 refresh 为 0、最终只保留旧 URL、空 browser list 和 Connect/Web disabled；Node source contract 锁定两条回滚共享同一 commit gate。本轮唯一 Finder 检查仍报告 Mac 锁定，因此证据属于 Rust 并发、源码契约和既有 AppKit probe，不冒充真实状态项点击或 VoiceOver 朗读。
- 配对时限与焦点：首次连接和新增浏览器都直接采用 Server 返回的 `expires_at`，不会在客户端擅自续期；冷启动、重试、开始配对、取消、失败、恢复和成功后的焦点都移动到下一项可操作内容，键盘用户不会被留在已经隐藏的视图。未知 PAKE / WebView 异常会折叠为稳定的本地化安全连接错误，不把底层实现文本直接显示给用户。
- 首次配对错误持续性：首次配对请求失败、PAKE 握手异常或连接码过期后，失败原因不再只存在于 4.2 秒自动消失的 toast。登录主动作通过 `aria-describedby` 关联紧邻的持久说明；失败时该说明切换为 `role=alert` / assertive live region，保存的只是稳定翻译键或 Desktop 错误码，切换中英文会按当前语言重新渲染。重新发起配对时才清除旧错误；短码、share、原始异常和请求正文不会进入该状态。
- 配对取消与异步呈现：Desktop 二维码先绘制到离屏 canvas，并只在 URL 仍属于当前会话时原子提交；快速取消并重连时，旧任务不能把旧随机 pairing URL 覆盖到新短码旁边。canvas 从任务开始到当前会话完整提交前保持 `aria-busy=true` 与低对比度，晚到旧任务既不能提交旧图，也不能提前清除新任务的 busy 状态。Web 短码提交后输入框保持可聚焦但 `readOnly`，表单用 `aria-busy` 和原子 live status 表达阶段，避免 `disabled` 让焦点掉回 `body`；同步 guard 仍阻止重复 Enter。Windows lifecycle UIA 会真实 Invoke 可恢复态的取消操作，等登录 CTA 恢复后再跨越 2.5 秒、覆盖多个一秒重试周期，要求隔离 loopback stub 的 pairing-start 聚合计数不再增加；随后通过 `HasKeyboardFocusProperty` 验证取消恢复及同 HWND 关闭重开后，本地化登录 CTA 都真实取得键盘焦点，不能只用 foreground window 冒充可操作。该 Windows 证据属于 CI 脚本与 11 项源码契约，仍不冒充 Windows 10 / 11 真机执行。
- 新增浏览器远端取消：过去 Desktop 取消后只中止本地等待；若原生 `start_browser_pairing` 已在 Server 创建或稍后才完成，`waiting` 会话仍可被已登录浏览器发现最多 10 分钟。现在取消/过期会立刻调用设备鉴权的幂等取消；创建 invoke 结束后再做第二次同 pairing id 清理，覆盖“取消早于插入”的竞态。两次尝试由 pairing id 级串行队列组成一个有界事务；其间 Home 保持可见并显示“正在清理已取消的连接… / Cleaning up the cancelled connection…”，重新配对、设置与 Server URL 保存、退出、撤销授权、语言原生核对和更新重启都暂时门禁，避免旧清理落到新 Server 或更新退出抢在晚到清理之前。最终尝试结束后统一恢复动作；若删除失败，Server 的 10 分钟 TTL 仍是上限。Server 只删除同一用户、同一设备、`mode=browser` 且仍为 `waiting/responded` 的文档，首次连接与 `paired` 授权不受影响。行为测试实际证明删除、重复 204、首次配对保留和 paired 保留；Desktop 队列测试证明首次失败后事务仍 active、最终清理不会越过前次调用；source contract 锁定短码/share 不进入取消路径。
- 安全凭据恢复：只有 Keychain / Credential Manager 的 `NoEntry` 才表示未配对，访问失败会以稳定的 `credential_access_failed` 进入可重试启动错误态；若磁盘仍有浏览器授权，原生菜单会保持已知设备路径并显示“需要处理 / Needs attention”，而不是误显示首次连接和重复配对动作。重试成功后，bootstrap 会持有 `tray_update` 同时提交 paired cache 与 recovery flag，再刷新 status、主动作、Web enabled、tooltip 和 AX；因此并发 Relay publication 不能观察到一半旧恢复态、一半新凭据态。阻塞并发测试从 locked recovery 提交权威 NoEntry，证明另一 publication 在 100ms 内不能越过，释放后只观察 `(connection=false, web=false)`；连续两次原生刷新失败测试还证明权威 NoEntry 不会回滚为已配对或 recovery，Bootstrap snapshot 会携带稳定 `language_failed`。若重试得到完整凭据但 Relay 尚未运行，Desktop 会恢复 Relay，并在启动失败时刷新原生错误状态，而不是假装未登录或永久停留在“正在连接”。
- 已提交凭据事务清除 recovery：此前 `paired_bootstrap`、`signed_out_bootstrap` 和浏览器撤销的已知 presence 会直接返回 Web，但不会清除冷启动留下的 `recovery_required`；因此 Keychain 恢复后成功配对、授权或退出仍可能让 NSMenu、tooltip 与 VoiceOver 永久显示“需要处理 / Needs attention”。现在所有已知 presence 都先复用 `tray_update` 串行提交：完整凭据启用 Show/Web，空凭据切回 Connect/禁用 Web，并同步清除 recovery 后才构造 Bootstrap。后续对抗审计又发现该入口曾复用 bootstrap config reconciler，在获取 `tray_update` 前复制 config；若用户在配对期间先完成语言切换，较晚取得锁的凭据提交会把内存 config/菜单语言回放为旧值，而磁盘已是新语言。known-presence 事务现在只提交 paired/recovery，明确不读取或写回 config/ui_language。纯 Rust 矩阵实际从 recovery 分别提交 paired Connected 与 signed-out Stopped，并验证中文 durable locale 在凭据提交和原生刷新中保持不变；另一测试注入连续两次 AppKit 刷新失败，证明权威 paired/recovery 状态不会回滚且稳定 `language_failed` 可诊断。Node source contract 锁定首次配对、浏览器配对、浏览器撤销和退出共同经过该入口，并拒绝该函数重新出现 config/locale 写入。本轮唯一一次 Finder 只读检查仍报告 Mac 锁定，随后没有启动应用或访问 Keychain；证据属于 Rust/Mock/source contract，不冒充真实状态项或 VoiceOver。
- 原生辅助功能启动降级：状态项创建后会立即写入并读回 VoiceOver label、help 和 identifier；若第一次 AppKit 读回瞬时失败，只记录稳定诊断，不再让 Tauri setup 在登录窗口出现前退出。bootstrap 或下一次 Relay publication 会沿同一串行刷新链重试，正常路径仍由真实 AppKit probe 约束全部属性 round-trip。
- 原生 AX 恢复后重新准入关闭驻留：首次状态项 AX 读回失败会正确保持窗口并请求 Regular fallback，但旧实现把 `window_hide_recovery_available=false` 永久缓存；后续 bootstrap / Relay / 语言刷新即使已从可见 `NSStatusItem` 成功读回全部 AX 属性，红色关闭仍会被永久拒绝并反复发布 `window_failed`。现在生产 AX setter 先同时确认具体状态项可见和 label/help/identifier 全部读回，再把已修复菜单重新准入；若先前排队的 Regular policy readback 较晚失败，它不能覆盖这个独立真值。每次关闭前后仍读取真实状态项与 activation policy，因此缓存重新准入不会掩盖再次消失。纯 Rust 回归从 initial AX failure 开始，模拟成功重试后确认 close admission 恢复，再注入失败的延迟 Regular readback并验证状态不回退、错误发布为 0；Node source contract 锁定 production getter、重新准入和合并语义。本轮 Computer Use 唯一 Finder 只读检查显示桌面已解锁，但按一次状态检查边界未继续启动 QA / production 应用，也未访问 Keychain 或短码；证据属于 Rust/源码契约与既有 AppKit 属性探针，不冒充真实红色关闭或 VoiceOver 朗读。
- 原生诊断最小化：Relay 生命周期和孤立浏览器授权清理只写无参数稳定事件码；`RelaySnapshot.logs` 通过最终 allow-list 准入，PID、工作区路径、adapter、计数、stdout / stderr、原始中英文、参数化或未注册码统一折叠为本地化的隐藏诊断。切换语言会从稳定错误码和最近脱敏快照重新渲染，不保存 raw error，也不会把旧语言诊断残留在新语言窗口。
- 冷启动配置恢复：Tauri setup 仍可用安全默认值创建错误窗口，但 bootstrap 会重新读取持久配置；损坏、无权限或无效路径不再被默认配置掩盖成“首次连接”。临时默认配置带随机临时 identity，setup 不再用它读取 Keychain / Credential Manager，必须等配置重试恢复真实 device ID 后才探测对应凭据。原生菜单此时显示“需要处理 / Needs attention”和“显示 Relayune / Show Relayune”，同时保持 Web 工作台禁用，避免把临时默认 Server 当成已授权工作台或诱导已有用户重复配对。用户修复文件或权限后可以原地重试，失败态还可直接打开脱敏诊断；成功重试会恢复 durable config、清除 recovery 标志、同步 paired 菜单状态并刷新原生菜单。交互式冷启动即使第一次窗口显示/聚焦瞬时失败，也只记录稳定诊断并保留已经创建的状态项，用户可从菜单再次恢复，不再让 Tauri setup 整体退出。
- 冷启动持久语言原子恢复：此前配置读取失败后原生状态使用系统语言，后续 bootstrap 虽重新载入 durable config，却没有同步 `AppState.ui_language`；Web 会按持久语言恢复，而 NSMenu 标题、tooltip 与 VoiceOver label 会一直停留在 fallback 语言，直到用户手动切换。现在 durable config、持久语言、paired cache 与 recovery flag 都在同一个 `tray_update` 临界区提交并刷新；若 Keychain / Credential Manager 仍不可读，则只恢复 config/语言并保留 Needs attention 状态，不把失败伪装成 NoEntry。进一步对抗审计发现这两条 bootstrap 提交过去只调用状态刷新，遗漏了独立的 Diagnostics 与 Quit 标题：Show、Update、tooltip 与 AX 已恢复英文时，菜单尾部仍可能保留中文。现在凭据成功与安全存储失败两条路径都执行完整语言刷新；Rust 回归在持久英文、凭据仍不可读的恢复态中直接锁定 `Help & Diagnostics…` 和 `Quit Relayune`，Node source contract 同时约束两条生产 closure。阻塞并发测试证明竞争的 Relay publication 在 100ms 内不能越过恢复刷新，释放后只能同时观察英文配置、英文原生语言和完整 NoEntry 状态；AppKit probe 还读回了中英文 Needs attention 的 menu/tooltip/AX 属性。本轮 Mac 锁屏，未重建或启动隔离 QA 包，因此这些证据严格属于当前源码、Rust/Mock 与真实 AppKit 属性探针，不冒充最新包的用户点击或 VoiceOver 朗读。
- 原生 recovery phase 保持：`recovery_required` 过去只控制 Show/Connect 与 Web enabled；setup 虽先显示 Needs attention，但随后的语言恢复、更新同步或 Relay publication 会使用 runtime 的 `Stopped` 覆盖 status、tooltip 与 AX label，让凭据/配置故障看起来像用户主动停机。所有 setup 与刷新入口现在先计算统一 presentation phase，只要 recovery 尚未被权威 bootstrap 清除就强制保持 Error / “需要处理 / Needs attention”。Rust 运行矩阵对 Stopped、Starting、Connected、Stopping、Error 五种 runtime phase 都验证英文 status、中文 tooltip 与英文 AX label 不会降级；AppKit probe 继续读回对应中英文原生属性。本轮仍为锁屏下的源码与探针证据，未重建 QA 包。
- 辅助原生状态降级：LaunchAgent / Run 项启用状态回读失败只把当前开关降级为关闭并记录 `autostart_failed`，不再让已经成功读取配置和安全凭据的 bootstrap 整体失败、阻断登录或配对。主窗口关闭仍先阻止退出再调用系统 hide；MockRuntime 实际执行正常 hide dispatcher，并验证 hide 失败只记录 `window_failed`，Relay 驻留语义不变。独立 hook 回归还模拟状态项与 Regular fallback 双失败，证明系统 hide 根本不会被调用且 fresh diagnostic 仍被发布。MockRuntime 不模拟 AppKit 最终可见性，真实红色关闭结果仍按真机准入。
- macOS 登录启动写事务：此前启用 LaunchAgent 成功但 `is_enabled` 回读为 false 或失败时，命令会向设置页报告失败，却不会撤销可能已写入的登录项；用户下次登录仍可能看到一次意外的后台启动。禁用也会把“登录项本来已不存在但插件删除报错”误报为失败。现在非 Windows 路径在 enable 任一步失败或权威 readback 不匹配/不可读时都 best-effort disable 后返回稳定 `autostart_failed`；disable 以 readback=false 作为幂等成功，仍启用或不可读则再删除一次并报告失败。纯 Rust hook 矩阵覆盖 enable 写失败、readback false/error、disable 初次报错但已关闭，以及 readback true/error 的第二次清理；Node contract 锁定 macOS command 必须经过该门禁，Windows 保留自己的 Run/StartupApproved 事务。本轮唯一 Computer Use Finder 检查为锁屏，随后未启动应用、访问 Keychain 或读取短码；真实 LaunchAgent 写入与登录后后台启动仍属解锁真机准入。
- 原生退出与并发状态：`stop_for_exit` 只在 runtime 锁内摘取 child / PID，锁外终止 sidecar；child 终止失败会按 PID 再试，两者均失败时保留可重试 PID、发布最新 `relay_stop_failed` snapshot，并阻止可取消的 tray / OS 退出。普通 Stop 与 Quit 双失败都会从 `Stopping` 进入可见 Error / Needs attention，使 NSMenu、tooltip 与 VoiceOver 不再无限显示“正在停止 / Stopping”；后续 Stop / Quit 会真实认领并重试保留 PID，Start 在 PID 未清理前拒绝启动第二份 sidecar。并发 Stop 不再清空仍在终止中的 PID；`Starting` 重复 Start 保持幂等，重试终止期间拒绝 Start，避免第二份 sidecar和状态覆盖。进一步的竞态注入证明：过去 Stop/Quit 可在 `Starting` 已保留 generation、但 child/PID 尚未登记时返回成功，启动线程随后仍能 spawn，导致 Stopped 后重新运行或 GUI 退出/更新重启后遗留孤儿 Relay。现在 generation 准入、native spawn、child/PID 发布共享一个 runtime 临界区；Stop/Quit 要么先原子取消未提交 generation，使 spawn hook 调用数为 0，要么等待已开始的提交并认领真实 PID。后续审计又发现 Cmd-Q / 系统 Quit 仍直接在 Tauri 原生事件循环同步调用该停止链；等待 Starting generation 或进程 kill 时，菜单、AX 和窗口恢复都会冻结。现在第一次交互式退出立即 `prevent_exit` 并派发唯一后台 stop，快速重复 Quit 只共享该 worker；成功后才发起一次程序化退出，失败先解除门禁再发布稳定诊断，使保留 PID 可重试。100ms 阻塞探针证明 stop 尚未释放时回调已返回且没有提前退出；成功、重复请求和失败后重试均有纯 Rust 回归。最新对抗审计还确认 Tauri 在等待 sidecar 结束失败时只发 `CommandEvent::Error`，不会再发 `Terminated`；旧实现只记录日志，原生菜单可能永久停在 Connecting/Connected。现在同 generation 且非 Error/Stopping/Stopped 的等待错误会提交 Error / `relay_start_failed` 并立即刷新菜单、tooltip、AX 和 Web snapshot，同时保留 child/PID 供 Stop/Quit 清理；超时 Rust 回归证明旧 generation 和 Stop owner 不会被晚到错误覆盖。事件 channel 也可能完全不发送 Error/Terminated 就直接 EOF；观察 task 现在在循环结束后进入同一幂等失败路径，避免隐藏应用永久卡在 Starting/Connected。新增一秒 deadline 回归证明 EOF 只发布一次、保留 PID，重复 EOF、既有 Error、Stop owner 与新 generation 均不会被覆盖。新一轮继续发现 macOS `CommandChild::kill()` / `kill -KILL` 的成功只证明 SIGKILL 已投递，旧实现随即清空 PID 并允许 Quit/updater transition，sidecar 若尚未退出或回收就会与新实例短暂冲突。现在 child 与 PID 两条路径都在最多约一秒内轮询确认目标 PID 消失；仍存活或检查失败按既有 `relay_stop_failed` fail-closed，保留 PID 并阻止退出/重启。纯 Rust 回归不等待真实时间地覆盖“第三次检查消失”和“40 次仍存活”两条路径，Node contract 锁定两种 kill 都经过确认。Computer Use 唯一 Finder 检查仍为锁屏，未启动 QA App、Keychain 或短码；没有把 helper 证据冒充真实菜单 Quit、进程回收或 updater relaunch。当前 production dist 与包含该修复的 Rust binary 已重新嵌入独立 Menu QA 包并完成 ad-hoc deep/strict 验签，前述 executable hash 即为本轮封存产物。
- Quit 与 updater 完成态所有权：旧门禁在 owner 已停止 Relay、置 `ready` 并调用某个 process transition 后，把任何随后调用都当作 `Ok` 幂等；菜单 Quit 先提交时，updater restart 因而可能收到成功却从未调用 relaunch。反向地，更新重启已提交后到达的 `code=None` Cmd-Q 会因 ready 直接放行，可能用普通退出覆盖 relaunch。两个 Atomic 之间还有完成 owner 发布 ready、释放 in-flight 后，早先读到 ready=false 的 contender 再次 CAS 成功的 TOCTOU。现在 completed transition 对新 native command fail closed；`begin_exit_stop` 在取得位后复核 ready，只释放自身 in-flight 而不清除完成态；每个交互式 OS Quit 在检查 ready 前都同步 `prevent_exit`，programmatic `code=Some` 仍沿原 follow-up 分支完成唯一转场。Rust 回归锁定第二 Stop/transition 调用数为 0、返回稳定 `relay_stop_failed`、完成态不能再成为 owner，以及完成后 Cmd-Q 只 prevent、不派发 worker；Node contract 锁定检查顺序。本轮 Finder 唯一检查为锁屏，未启动应用、Keychain 或短码；包含修复的隔离 QA binary 已完成 custom-protocol 重建、ad-hoc deep/strict 验签和符号封存，但没有启动，因此不冒充真实 Quit/更新重启点击。
- sidecar 迟到进度不会越过 Stop/Quit：同 generation 的 stdout / stderr 可能已经在管道缓冲，用户 Stop 或 Quit 把 runtime 置为 `Stopping` 后仍会到达。旧 helper 只检查 generation，会把 `Stopping` 改回 Connected / Starting / Error；更旧 generation 虽被 helper 拒绝，事件外层仍无条件追加 `relay_connected` / `relay_reconnecting` 并发布，污染当前 NSMenu、AX、Web snapshot 与诊断。现在 Connected / reconnecting 进度必须同时满足 current generation 且非 Stopping / Stopped；只有被接纳的事件才在 runtime transition 后写入对应稳定码并发布一次，401 还保留精确 `relay_unauthorized`。纯 Rust 回归覆盖 Stop owner、旧 generation、正常连接、普通重连与未授权五条分支，Node source contract 拒绝事件外层重新无条件 log / publish。本轮唯一 Finder 状态检查为锁屏，未启动应用、Keychain 或短码，因此不冒充真实 sidecar 输出、菜单变化或 VoiceOver 朗读。
- updater relaunch 退出门禁：Tauri 的 restart 使用特殊 exit code，框架明确忽略 `ExitRequestApi::prevent_exit()`；旧实现直到该不可取消事件才调用 `stop_for_exit`，sidecar child/PID 双终止失败时仍会退出并重启，遗留旧 Relay 并让新实例进入冲突。当前保持 `@tauri-apps/plugin-process` 的命令名与 ACL，但由同名原生 plugin 在设置 restart flag 前调用 `stop_for_exit`；失败时发布 fresh `relay_stop_failed`、让前端 Promise 拒绝并保留当前应用，成功才 `request_restart()`。纯 Rust hook 实际证明 stop 失败时 transition 调用数为 0、diagnostic 回调为 1，成功时 transition 恰为 1；Node contract 锁定 updater client 仍走 stop-aware route。AppKit probe不模拟进程替换，真实签名更新安装、失败 relaunch 与新旧 PID 交接仍属发布真机准入。本轮唯一 Finder 状态检查显示桌面解锁，但没有启动应用或访问 Keychain，不冒充真实 updater/relaunch。
- Quit 与并发 Start 门禁：交互 Cmd-Q、菜单 Quit 和 updater/plugin exit 都会先停止 Relay，再异步请求进程退出；旧路径在 stop 成功和 `ExitRequested` 到达之间没有阻止新的 Start。若此时 Start 预留并启动 sidecar，follow-up event 会因 `exit_stop_ready=true` 跳过第二次 stop，最终 `RunEvent::Exit` 又只做丢弃错误的 best-effort cleanup，可能遗留无人管理的 Relay。现在三种退出入口在 stop 前共同占用 exit gate，stop 失败先清 gate再发布诊断；`relay::start` 在任何安全存储读取前快速拒绝已知 Quit，并在持有 runtime lock 的 generation reservation 中再次检查，闭合“Start 先开始等待、Quit 后占 gate”的竞态。阻塞双线程回归先持有 runtime 让 Start 排队，再占用 Quit gate并释放 runtime，证明旧 Start 必须以稳定 `relay_start_failed` 退出；取消/失败 Quit 后 Start 可正常重试。Node contracts 同时锁定 menu、updater 与 Windows tray Quit 共用 gate。Mac 唯一 Finder 检查仍为锁屏，因此未启动 QA App、访问 Keychain/短码或声称真实 Cmd-Q/updater 进程交接。
- Quit 与 updater transition 所有权：共享 exit gate 过去把“已有 stop 正在进行”和“已有 process transition 已提交”都当作幂等成功。菜单 Quit 若先取得 gate，紧随其后的 updater restart 会收到成功 Promise，却不会执行自己的 `request_restart`，最终 owner 只做普通 exit；反向竞争也会静默改变用户请求的退出语义。现在只有 `exit_stop_ready` 的已提交 transition 可以幂等成功；仍在 stop 的不同调用立即返回稳定 `relay_stop_failed`，且不重复记录诊断，实际 owner 继续负责唯一 transition 或失败发布。阻塞双线程回归让 owner 停在 sidecar stop 内，证明 contender 不调用 stop、不 transition、不发布伪失败且必须返回错误；释放后只有 owner transition 执行一次。本轮 Finder 唯一检查仍为锁屏，未启动应用或访问 Keychain，因此这属于 Rust 并发与 source contract 证据，不冒充真实菜单 Quit / updater 交接。
- Relay 状态发布顺序与原生失败恢复：原生菜单、tooltip、AX / VoiceOver 与 WebView `relay-status` 事件在每个 `tray_update` 临界区内使用同一个 snapshot。双线程阻塞测试证明较新的 Connected publication 不能越过尚未完成的 Starting 原生刷新，释放后两组 native / Web 结果严格保持 Starting → Connected。此前生产入口丢弃 native refresh 的 Err，导致 Web 已前进而菜单/AX 静默停留在旧 phase；现在首刷失败会先释放锁、记录稳定 `language_failed`，再以最新 snapshot 开启第二个串行事务立即重试并 emit。注入测试分别证明瞬时失败第二次自愈，以及连续两次失败仍向 WebView 发布含诊断的最新 snapshot，不会递归或回放旧 phase。
- 原生发布门禁 poison 恢复：`tray_update` 只保存 `()` 并负责 NSMenu、tooltip、AX 与 Web snapshot 的顺序，不拥有任何业务状态；此前任一 AppKit/Tauri backend callback 若在持锁 refresh 中 unwind，标准 Mutex 会被永久 poison。之后语言、更新、bootstrap、凭据提交、Relay publication 和手动 refresh 全部拒绝该锁，即使进程、窗口与权威 `AppState` 仍可使用，隐藏菜单也会永久停在旧状态。现在所有生产入口只经过共享 `lock_tray_update`：从 poison 中取回 unit guard、立即 `clear_poison`、记录一次 allow-listed `language_failed`，然后继续当前 authoritative refresh；不会把 panic 前的半完成呈现当成成功。阻塞回归先在线程持锁时注入 unwind，再让一次 Relay publication 恢复门禁并故意停在 refresh，证明并发 update 在 100ms 内仍不能越过；释放后 update 正常刷新、门禁保持未 poison 且诊断只记录一次。Node contract 拒绝任何生产入口重新直接 `.lock()`。本轮 Computer Use 唯一 Finder 检查仍为锁屏，随后未启动应用、访问 Keychain 或短码；真实 AppKit panic 注入与 VoiceOver 恢复仍属解锁真机准入。
- 原生菜单句柄 poison 恢复：此前语言与 Relay 刷新会在持有 `tray_items` 容器锁时调用真实 Tauri/AppKit menu setter；backend unwind 会同时 poison 外层 publication gate 和内层句柄容器。只恢复 `tray_update` 时，下一次事务仍会永久卡在内层 poisoned lock，NSMenu、tooltip 与 AX 无法再自愈。当前刷新先通过 `tray_items_snapshot` 克隆轻量 Tauri handles 并释放容器锁，再调用 backend；`lock_tray_items` 仍可取回已 poisoned 的旧容器并清除 inner poison，外层 gate 保留唯一稳定 `language_failed`，避免为一次 unwind 重复写诊断。阻塞 Rust 回归同时 poison 两把锁，证明两者均被清除、后续线程仍在 guard 释放前被阻塞且释放后恢复；Node source contract 禁止生产路径绕过 helper或在 setter 期间继续借用 registry guard。Mac 本轮仍锁定，因此该证据属于 Mutex/AppKit 调用边界与源码契约，不冒充真实状态项或 VoiceOver 朗读。
- 状态项 setup 与 deferred callback 原子边界：`TrayIcon::build` 返回后原生菜单回调已经可调度，但旧 setup 此时尚未写入 `tray_items` 或完成首次 AX label。极早的 Show/Diagnostics/Update 失败会在 worker 中先发布 native error，连续两次刷新都只能看到空句柄；setup 随后虽然完成，却没有新的权威 publication 触发自愈，另一个 worker也可能和首次 AX setter 并发。现在 build、句柄注册和 initial AX readback 全部位于 `initialize_tray_presentation_with_hook` 的同一 `tray_update` 事务；回调可立即离开 AppKit 线程，但必须等 setup 完整提交后才能刷新。阻塞回归证明 callback 在 setup 释放前 100ms 内不能进入、释放后正常恢复；另一路注入 build 失败，证明 gate 会立即释放且不会伪造句柄已注册。Node contract 锁定 production 顺序。Mac 唯一 Finder 检查仍为锁屏，未启动 QA App 或访问 Keychain/短码；证据属于 Rust 并发、源码与既有 AppKit probe。
- 初始 AX 失败的后台恢复面：状态项创建且肉眼可见不等于 VoiceOver 能找到它。旧路径把首次 label/help/identifier 读回失败仅记为 `language_failed`，仍允许 `--background` 保持隐藏；若安全凭据同时缺失，既不会启动 Relay，也没有 WebView bootstrap，注释所期待的“下一次 publication 重试”可能永远不来，使 VoiceOver 用户只剩不可访问的 Accessory 进程。`setup_tray` 现在把初始 AX readiness 作为非致命准入结果返回：setter 失败不终止 Tauri，但 visible + AX ready 才能作为唯一隐藏恢复面，否则复用现有 Regular readback 并显示主窗口。纯 Rust 矩阵证明 credential-less background launch 在 AX=false 时 `show_main_window=true/start_relay=false`，AX=true 保持纯菜单栏；Node contract 锁定 setup、fallback 与可执行回归。本轮唯一 Finder 检查为锁屏，随后未启动应用、访问 Keychain 或短码；AppKit probe 继续证明属性 setter/readback，本条不冒充 VoiceOver 实际朗读。当前 production dist 与包含该修复的 Rust binary 已重新嵌入独立 Menu QA 包并完成 ad-hoc deep/strict 验签，前述 executable hash 即为本轮封存产物。
- Desktop 冷启动事件仲裁：首个 `get_bootstrap` 只会在 `relay-status` 监听器注册成功后开始，监听器注册失败可从启动错误面重新尝试；WebView 还会记录最新事件及其本地修订号。如果 Connected / Error 等事件在 bootstrap 等待期间到达，即使首个 Bootstrap 尚未建立也不会丢失，晚到的旧 bootstrap snapshot 会与这条更新合并后再渲染。冷启动 native 语言核对失败也会显示本地化提示，不再让窗口与菜单栏静默分裂。后台 native 语言核对现在也是 updater 的显式事务门禁：核对进行中不能开始下载/重启，下载期间的 focus / online 恢复不会写原生配置；若安装失败，被延迟的核对会立即恢复，避免更新重启与菜单语言写入交错。若安全存储或原生 bootstrap 超过四秒仍未返回，准备页会用当前语言说明耗时异常并开放“帮助与诊断”，但不会启动第二个 bootstrap；run-id 与当前 view 双重检查保证晚到计时器不能覆盖成功或失败页面，语言切换仍按稳定 `data-i18n` 状态重译。
- 原生菜单事件桥：诊断和更新监听器也会在首个 bootstrap 前尝试注册；任一辅助监听失败不会阻塞登录、配对或 Relay，而是显示本地化提示并在窗口再次聚焦时只补注册缺失监听器。两个监听器各自保留独立的 in-flight promise，部分失败不会把仍在注册的另一项重复挂载。bootstrap 完成前打开诊断只会显示本地化“正在检查”，不再把尚未验证的状态误报为健康。这样极早的菜单点击窗口被压缩到 WebView 初始化前，失败也不再形成无提示、不可恢复的永久事件缺口。
- 原生更新状态自愈：发现、忽略或确认无更新后的 native `update_available` 同步不再由空 `catch` 吞掉。WebView 只串行提交最新期望值；失败会显示稳定本地化错误并保留待同步值，窗口重新聚焦或联网时重试，避免菜单栏长时间残留错误的“安装更新”动作。若同步期间收到相反的新状态，重试始终保留更新的请求而不是把旧值写回。
- 首次配对阶段反馈：Desktop 点击连接后不再在连接码尚未生成时误报“等待浏览器”。按钮和原子 live status 会按当前语言依次呈现“创建一次性安全连接 → 等待浏览器 → 等待确认/正在完成”，并以 `aria-busy` 阻止重复提交；断网恢复和可取消入口保持原有语义。创建 PAKE 材料或等待网络恢复期间，主连接按钮保持原生可聚焦，以 `aria-disabled` 表达单次进行中并由同步门禁拒绝重复点击；键盘用户仍可直接 Tab 到取消动作，不再因为原生 `disabled` 掉到页面主体。远端浏览器响应后，原 handoff 动作会失效；现在同一状态提交会把焦点交给稳定挂载的本地化“等待确认 / 正在完成”事实，成功再进入 Home 状态卡，失败则回到精确重试入口。development-only Browser QA 在隔离的首次 503 恢复窗口中实测：短码仍为空时 `document.activeElement` 保持 `login-button`，原生 disabled 为 false、busy/disabled ARIA 已存在，取消动作可见且可用；随后关闭标签与本地服务，未读取或输出短码/请求体。
- 连接码到期恢复：Desktop 现在以 Server 截止时间作为唯一有效期；倒计时到 `0:00` 时立即中止仍在等待或断网恢复的旧轮次、隐藏已经失效的码、播报当前语言的过期提示，并把焦点送回可重新开始的连接入口，不再等待最长 15 秒的在途轮询才清理死码。浏览器授权与首次连接使用同一截止语义，PAKE 短码仍不会进入 URL、日志或诊断。
- 原生语言自愈：启动时菜单栏/VoiceOver 文案同步失败会保留待处理状态，并在窗口重新聚焦或网络恢复时按当前窗口语言重试；显式语言切换会先等待旧同步完成，避免较旧命令在稍后把菜单切回去。失败切换回滚后也会用旧语言执行同值核对，修复 AppKit 刷新与回滚同时失败留下的中英混杂。
- 浏览器 handoff 恢复：如果系统未能打开默认浏览器，Desktop 会保留已经生成的有效连接码、等待状态与“重试打开 / 复制链接”动作，不再把一次 Shell 失败误判成配对结束；打开系统浏览器期间两个同义动作使用同步 in-flight guard 与保持焦点的 `aria-busy` / `aria-disabled`，不会因原生 `disabled` 把键盘焦点丢回 `body`，重复点击也不会派发第二个 Shell 请求。首次连接生成短码后的自动浏览器 handoff 也复用同一 helper：焦点刚进入“在这里打开”时按 Enter 或点击只会命中正在执行的门禁，不会与后台自动调用并发打开两个标签；自动成功保持静默，用户主动重试成功才显示提示。两处复制链接动作同样共享单次执行门禁，慢权限响应期间显示当前语言的“正在复制… / Copying…”且保持焦点，完成或失败后恢复原按钮；命令返回且配对仍有效时，焦点回到用户实际触发的动作。Web 登录和配对错误只按稳定 status/code 本地化，不透传 Server message。
- macOS 菜单首次连接：未配对时唯一主动作改为“连接这台电脑… / Connect This Computer…”并恢复唯一主窗口，同时禁用无效的 Web 工作台入口，避免两个动作把用户带向不同路径；配对成功后主动作切回“显示 Relayune”，Web 工作台入口才启用。状态、动作、tooltip、VoiceOver 名称和语言由同一互斥刷新链更新；菜单发起的浏览器启动若失败，会恢复窗口并打开脱敏诊断，不再静默无响应。连接、诊断及浏览器失败恢复入口也会记录共享恢复链返回的稳定错误，且只有窗口确实恢复后才发送诊断事件。
- macOS 原生菜单错误可见性：菜单回调发生浏览器或窗口恢复失败时，不能只更新 Rust 内存日志再打开仍持有旧 Bootstrap 的诊断框；生产 helper 会先记录 allow-listed 稳定码并 emit 最新 `relay-status` snapshot，再触发诊断事件。MockRuntime 对缺失窗口的四个菜单入口实际捕获四份 snapshot，并反序列化最后一份确认含四条 `window_failed`；浏览器失败路径也确认先收到一份新 snapshot，再收到诊断事件。后续对抗审计还发现窗口成功恢复后，`open-diagnostics` / `check-for-updates` 的 runtime dispatch `Result` 被直接丢弃：runtime 拒绝事件时用户只看到窗口，动作和错误都消失。现在共享 helper 检查真实 dispatch 结果，失败分别保留稳定 `window_failed` / `update_failed` 并串行发布 fresh snapshot；纯 Rust 注入回归证明成功不制造日志，两个失败都按顺序保留并发布。最新审计又确认菜单 Quit 的 sidecar 停止失败虽会把 Relay phase 提交为 Error，旧 native-error helper 却只向 WebView emit，隐藏态 NSMenu、tooltip 与 AX 仍可能停在 Connected/Stopping。生产 helper 现在用同一 `tray_update` 快照事务先刷新所有原生表面、再 emit，并沿用一次 AppKit 失败重试；一秒 deadline 的纯 Rust 回归证明原生与 Web 收到同一份含 `relay_stop_failed` 的 Error snapshot。Tauri `emit` 成功只证明 runtime 接受事件，不证明 WebView listener 已执行；本轮 Mac 锁定，真实 Quit 失败注入、状态项变化与 VoiceOver 朗读仍需解锁真机验证。
- macOS 原生回调锁反转：后台 Relay publication 持有 `tray_update` 后，Tauri 的 NSMenu、状态项 tooltip 与 AX setter 会同步等待 AppKit 主线程；旧的 NSMenu、Dock/Finder reopen、single-instance、Close hide 失败、Regular fallback readback 失败或系统退出回调若同时在主线程同步发布诊断，就会反向等待同一锁，冻结菜单与最后窗口。现在菜单/托盘/reopen/second-instance 入口整体调度到 blocking worker；Close hide 与 AppKit policy 读回仍在主线程保证真实 getter 语义，但其稳定错误 publication 离开回调后执行；系统退出先同步 `prevent_exit`，sidecar stop 与失败 publication 都移出原生事件线程。可超时 Rust 回归在持有 `tray_update` 时触发生产 dispatcher，证明 native callback 在一秒内返回、worker 在锁释放前保持等待且释放后恢复；另一阻塞回归证明交互式 Quit 在 stop worker 仍等待时已返回。Node contract 锁定全部原生入口、close reporter 和 ExitRequested stop 都经过该边界。此证据证明锁时序与 MockRuntime 行为，不冒充真机状态项点击、OS 焦点或 VoiceOver 朗读。
- WebView IPC 与原生刷新锁反转：进一步审计 Tauri 2.11.5 的本地 command macro 确认，普通同步 `#[tauri::command]` 使用内联 `body_blocking`；因此即使 native callback 已移出 AppKit 线程，WebView 发起的 bootstrap、Stop、凭据清理、语言/更新核对或 updater Exit/Restart 仍可能占住 IPC/事件线程，再等待后台 publication 已持有的 `tray_update`，而后台同时等待该线程执行 NSMenu/AX setter。上述命令现全部显式使用 `#[tauri::command(async)]`，由 `respond_async_serialized` 调度；Stop/重启失败仍返回原稳定错误与 snapshot，不改变 JS Promise API。新的 MockRuntime 回归持有 `tray_update` 后通过真实 `InvokeRequest` 调用 native update transaction：`on_message` 必须在一秒内返回，100ms 内不得伪造完成，释放锁后命令才完成并验证回滚；若任一 production command 恢复默认 blocking wrapper，Node source contract 直接失败。该证据验证真实 Tauri IPC wrapper、互斥等待和回滚，不访问 Keychain，也不等同于真机菜单点击。
- 后台原生语言迁移事务：窗口仍立即按本地语言渲染，不为 migration promise 留白；但 promise 存续期间登录/配对、设置、快捷偏好、浏览器撤销和退出等 durable 写动作统一使用保持焦点的 `aria-disabled` / `aria-busy`，handler 继续同步拒绝写入，避免原生 `disabled` 把 cold-start 登录 CTA 焦点丢到 body，也避免旧语言迁移与新配置保存互相覆盖。任一写事务结束后都会恢复待完成的 native language reconciliation；迁移成功、失败或重试都不丢失用户较新的 durable config。
- 后台更新可发现性：原生菜单始终提供“检查更新… / Check for Updates…”，后台发现新版本后沿同一串行刷新链切换为“安装更新… / Install Update…”；同一事务只在确有更新时把“有更新 / Update available”追加到状态项 tooltip 与 VoiceOver 名称，无需展开菜单即可发现，也不会给无更新状态制造读屏噪音。更新状态即使与内存值相同也会重新执行串行原生核对；Rust 对抗测试实际模拟首次刷新和回滚都失败，再以同值重试，证明菜单、tooltip 与 AX 可获得自愈机会，且同值核对失败不再被误报为成功。点击菜单项先恢复唯一窗口，再触发检查或聚焦现有更新卡片，窗口恢复失败不会发送失去接收面的事件；用户选择稍后则恢复手动检查动作。更新卡片使用读屏可读的确定/不确定 `progressbar`，失败后清除旧进度；发布清单携带结构化中英文说明，切换语言或原生语言同步回滚时会保持当前下载/安装阶段，不再把中文 release notes 或错误的按钮阶段留在英文界面。实际下载、签名拒绝、安装和重启仍属于发布真机准入。
- 更新卡焦点恢复：用户选择“稍后 / Later”时不再先卸载当前焦点所在的卡片并丢弃 updater `close()` Promise；当前动作保持可聚焦，以 `aria-busy` / `aria-disabled` 呈现单次关闭事务，只有原生关闭成功才隐藏卡片并把焦点送到登录后的状态卡或登录入口。关闭失败会保留更新卡和“稍后”焦点，安装失败则回到“安装更新”重试动作，避免异步失败后焦点落回 `body` 或快速点击重复关闭同一更新对象。该证据为 Desktop 可执行 source contract；真实签名更新关闭与安装失败仍属发布真机准入。
- 发布脚手架隔离：Desktop 视觉 QA bridge 只在 `import.meta.env.DEV` 下动态加载；packaged Vite build 不生成 source map，最终 `desktop/dist` 不再携带 QA harness 名称、mock 实现或原始 TypeScript。生产构建后的标记扫描无命中，避免开发测试入口虽不可执行却仍暴露在发布资源中。
- macOS VoiceOver 与菜单状态读回：生产路径不再只调用 AppKit setter；每次状态或语言刷新都从真实 `NSStatusBarButton` 读回 label、help 和 identifier。语言刷新和其 best-effort 回滚若连续失败，内存与磁盘仍保持旧语言；后续同值语言请求现在会在同一串行锁内重新核对 NSMenu、tooltip 与 AX，而非误报成功并永久保留中英文混杂状态。Rust 对抗测试注入刷新和回滚双失败，再证明同值重试会实际调用一次核对，且同值核对失败返回稳定 `language_failed`。无 harness 主线程探针进一步真实创建系统状态项和 `NSMenu`，验证中英文两组属性、菜单标题、唯一主动作及 Web enabled 状态 round-trip 后移除；SystemUIServer AX 枚举、production 状态项点击和 VoiceOver 实际朗读仍保留为真机准入。
- 首页首屏几何：真实浏览器发现旧产品预览在 1280 / 768 / 360px 下覆盖最长英文 CTA；Hero 空间已按桌面、平板和手机分别调整，回归测试直接比较说明内容底部与预览顶部，防止后续文案或演示尺寸变化重新遮挡操作入口。
- 设置事务：提交处理会在任何异步调用前一次性捕获 Server URL、两个 Agent 路径与登录启动值，再把整个表单置为 `aria-busy`；文本字段只读、开关与保存/关闭/取消禁用，独立 in-flight guard 拒绝重复提交。因此保存期间不会出现用户继续编辑 B、请求却仍提交旧快照 A 的误导。自动启动或新 Relay 启动失败时，前端保留设置窗口，Rust 恢复旧磁盘配置、内存状态和旧 Relay，避免 UI 声称未变而底层已部分生效；`desktop-user-journey` 源码契约锁定“先捕获、后置 busy”和完整字段冻结。
- Durable 配置与语言事务：语言按钮刻意保持可用，使慢设置、退出或撤销授权期间仍能即时重译窗口；旧原生实现却会让 `set_ui_language` 从尚未提交的新状态之前复制整份旧 config。例如 logout 已把 fresh identity 写盘、正在等待远端 revoke 时，语言写入可能把旧 device/browser id 原样写回；远端撤销成功后内存显示已退出，但下次启动又读到被撤销身份。现在设置、清 secret、首次/新增浏览器配对完成、撤销、退出和语言持久化共享独立 async `config_update` 门禁。语言 UI 可立即变化，原生命令在不阻塞 Tauri 事件线程的前提下等待身份事务结束，再读取并保存最新完整配置。阻塞 Rust 回归证明第二个事务在 100ms 内不能越过首事务，释放后看到的是新 device id；独立 Node contract 锁定全部七个 durable 命令都先取得同一门禁。
- 设置与原生呈现原子提交：此前 `save_settings` 写入新配置后会分别更新内存 config、按 device id 决定 paired，再到函数末尾刷新 NSMenu；新 Relay 启动失败的 durable rollback 也重复这组裸写。高频 Relay phase publication 可在中间取得 `tray_update`，把新设备身份与旧 paired=true 的 Show/Web enabled 状态发布到菜单、tooltip、AX 和 WebView，或在磁盘已回滚后继续显示被拒绝的设置。成功保存和成功回滚现在都通过 `reconcile_durable_config_native_presentation`：先失效旧 bootstrap，再在同一个 `tray_update` 临界区提交 config/paired 并刷新全部原生表面；设备未变时保留已有 paired，设备变化时原子切换为 unpaired。阻塞双线程回归把设置 refresh 停在临界区，证明竞争的 Relay publication 在 100ms 内不能越过，释放后只能观察新 device id、paired=false、Connect/Web disabled；Node contract 同时拒绝 `save_settings` 重新出现裸 `set_config` / `set_paired` / generation invalidation。本轮唯一 Computer Use Finder 检查仍为锁屏，随后未启动应用、访问 Keychain 或读取短码；证据属于 Rust 并发、源码契约和既有 AppKit probe，不冒充真实菜单或 VoiceOver。
- 浏览器撤销事务：远端授权撤销成功后不会再次读取安全凭据；Desktop 直接返回刚持久化的 browser list 与已知凭据 presence。这样 Keychain / Credential Manager 瞬时不可用不会把不可重试的成功撤销显示成失败并把确认对话框卡住。后续对抗审计发现撤销请求会先持久化缩短后的 `browser_ids` 再等待远端：如果最后一个浏览器的远端撤销失败并成功恢复旧配置，一个已读取临时空列表的 bootstrap 仍可晚到，重新禁用 Web 菜单并让授权列表与远端事实分裂；本地回滚失败时，较旧请求也可反向恢复磁盘已放弃的列表。撤销成功、恢复旧配置和保留新配置三种 durable 结论现在都通过 `reconcile_durable_config_native_presentation` 失效旧 bootstrap，并在同一 `tray_update` 事务中刷新 config、paired、菜单、tooltip 与 AX。阻塞 Rust 回归先让旧请求读取临时空授权列表，完成失败回滚后再释放，验证旧 refresh 为 0、最终浏览器列表、paired cache 和 Web action 全部恢复；Node source contract 锁定三条分支。本轮 Finder 唯一检查仍为锁屏，未访问真实 Keychain 或远端授权，因此不冒充真实撤销点击、状态项变化或 VoiceOver 朗读。
- Windows 自启动事务：锁定的 `auto-launch 0.5.0` 会先写 HKCU Run、再写 `StartupApproved`。插件 enable 自身失败、启用状态回读失败/不一致、带引号命令回读失败/不一致时，Windows 原生层都会先 best-effort disable 再向设置页报告失败；禁用时即使首次删除报错，也以随后 `is_enabled()` 回读为准，真实已关闭则成功，仍启用或不可读才再次幂等 disable 并报告失败，避免操作系统状态与 UI 结论矛盾。
- 退出事务：退出登录先生成新的本地 device id / state path 并持久化已退出配置，再执行不可逆的远端设备撤销。远端撤销失败时优先恢复旧配置与 Relay；若本地回滚也失败，则 UI 以磁盘中已经持久化的已退出身份为准。远端撤销成功后，旧安全凭据清理变为脱敏诊断级 best effort，最终返回不再依赖 Keychain、配置重读或网络的 signed-out bootstrap，避免用户停在已被撤销却仍显示 Home 的假登录态。
- 退出事务与慢 bootstrap：远端设备撤销等待期间，另一个 bootstrap 可能读到刚持久化的临时已退出身份。此前撤销失败并成功恢复旧配置后，该请求仍可晚到把已恢复的登录状态、Show/Web enabled、tooltip 与 AX 重新覆盖为未登录；反过来，本地恢复失败、磁盘必须保留已退出身份时，一个更早读取旧凭据的请求也可能复活已撤销设备。成功撤销也存在独立窗口：旧 signed-in bootstrap 可在最终内存提交前完成读取并于命令成功后复活已撤销身份。恢复旧配置、保留已退出磁盘配置和成功退出的最终提交现在都先推进 bootstrap generation，再在同一个 `tray_update` 事务内提交 config/paired 和原生呈现；刷新失败只保留稳定诊断并重试，不阻断旧 Relay 恢复或已成功的退出。两条阻塞双线程 Rust 回归分别覆盖失败回滚与成功提交，验证旧 refresh 为 0、最终状态严格服从 durable config；Node source contract 锁定三条分支共用同一门禁。本轮唯一 Finder 检查仍为锁屏，未启动 QA App 或访问 Keychain，因此该证据属于 Rust 并发、源码契约和既有 AppKit probe，不冒充真实退出点击或 VoiceOver 朗读。
- 配对成功与慢 bootstrap：首次 PAKE 或新增浏览器授权完成后，旧实现先裸写 `AppState`，经过 Relay 启动、远端确认和连接等待后才由最终 Bootstrap 失效旧请求；一个更早读取未连接配置或旧 browser list 的 bootstrap 可以在中间覆盖新 durable identity，让本应成功的配对启动旧配置或进入错误回滚。两个配对成功入口现在都在配置落盘后立即复用同一个 durable `tray_update` transaction，先推进 bootstrap generation，再原子提交 config/paired、菜单可用性、tooltip 与 AX；失败路径仍使用对称 rollback transaction。阻塞双线程 Rust 回归让旧 unpaired 请求先完成读取，提交新 paired identity 后才释放，验证旧 native refresh 为 0、最终保持新 device/browser list 与 Show/Web enabled。该证据为状态机和 source contract，不包含真实短码或生产凭据。
- 双语营销性能：`/zh/`、`/en/` 的可见文案、ARIA、平台 CTA、安装 handoff 和 SEO metadata 均来自当前语言字典；字典按入口拆包，交互对比控件支持方向键、Home/End/Page 键，并在 reduced-motion、视口外、悬停和聚焦时正确降级或暂停。官网首个键盘焦点现在是中英文 skip link，可绕过固定导航并把焦点送到可聚焦的主内容首屏；44px 焦点态在 320px 窄屏也不依赖悬停或动效。移动导航展开后把焦点送到首个链接；点击连续性、工作方式或安全锚点时，菜单先卸载，再把焦点送到带 `tabIndex=-1` 的真实目标 section，避免焦点落回 `body`。Node 契约覆盖三个锚点和关闭后的焦点连续性，不冒充本轮真实移动读屏操作。
- 双语登录修正：英文移动端系统分享和邮件草稿现在保持完整英文，只携带公开官网 URL；邮箱和密码表单使用应用内中英文校验，避免浏览器原生语言覆盖。无效邮箱、空密码、错误密码、过短新密码和确认不一致都会把焦点带回对应可修复字段，错误密码会全选便于直接重输。密码登录、设置新密码和 Web 短码失败不再只依赖会消失的 toast：错误持久显示在字段旁或表单内，以 `role="alert"` 立即播报并通过 `aria-invalid` / `aria-describedby` 关联输入；编辑字段时才清除，配对失败或取消也把焦点和选择返回短码字段。启动错误视图只在错误首次出现时聚焦标题，切换语言不重跑 bootstrap 或抢走语言按钮焦点；英文公开链接和懒加载状态不再混入汉字。语言按钮的可访问名称使用当前页面语言，目标语言的 `lang` 只作用于可见字形，保留中英文正确读音。
- 动态认证与 Desktop toast 重译：邮箱、密码、设置密码、过期配对和短码表单错误只保存稳定的本地 copy key，渲染时才使用当前语言；Desktop 瞬时提示同样只保留 `TranslationKey` 或稳定 `DesktopErrorCode`，不缓存原生错误文本。切换语言会就地重译当前 toast，不重新发起配对查询、bootstrap 或登录请求，也不重置 4.2 秒消失计时或抢走语言按钮焦点。真实 520×480 Windows 英文 WebView 旅程已触发默认浏览器打开失败，再切换中英文，确认同一提示即时重译、`html.lang` 同步、焦点保留、原计时到点隐藏，且配对 URL 不含短码。配对链接错误首次出现时仍会把键盘与读屏上下文送到错误标题。
- 授权列表错误重译：Desktop 授权浏览器读取失败只保存失败事实，不再把某一语言的错误句子留在运行时；错误标题、说明和重试按钮每次都从当前 locale 渲染。真实 420×420 Windows WebView 已从英文失败卡切换到中文，确认整卡即时重译、焦点保留在语言按钮、页面无横向溢出且 URL 不含短码。
- 授权列表动作一致性：新增浏览器进入准备、等待、断网恢复或保存阶段后，空列表的“添加第一个浏览器”、错误列表的重载以及已有授权的撤销动作会一起真实禁用，不再留下点击后静默无响应的假按钮；每个撤销按钮还以浏览器名称组成独立中英文读屏名称，例如“撤销 Safari 的授权 / Revoke access for Edge”。取消配对后动作重新启用，既有焦点恢复入口继续落到当前可用按钮。
- 授权列表重试焦点：错误态的“重新加载”会在点击后卸载；此前加载中与再次失败时焦点可能落回页面根节点。列表现在是以授权区标题命名、可编程聚焦并带 `aria-live` / `aria-busy` 的稳定 region；只有显式用户重试会在加载时把焦点保留到该 region，并在失败按钮重建后回到该按钮，后台授权刷新不会抢焦点。Desktop journey 契约同时锁定 focus-visible 边界、generation 失效与重试动作接线。
- Relay 重试状态一致性：手动重试成功返回的 Relay snapshot 现在先写回唯一 bootstrap 状态源，再更新状态卡；切换语言、打开设置或其他完整重渲染不会把已连接界面恢复为重试前的错误状态。重连动作在请求期间保持可聚焦，以 `aria-busy` / `aria-disabled` 和“正在连接 / Connecting”呈现单次请求；Relay 的中间状态事件不会先卸载当前键盘焦点，成功后焦点进入状态卡，失败则回到重试动作。真实 Browser 已从英文错误态点击重试，再点击语言按钮切到中文，前后都保持 success / 已连接，焦点留在语言按钮且 URL 不含短码。
- Desktop 更新焦点连续性：手动检查发现更新后只聚焦当前真正可用的“更新并重启”或“稍后”动作；若其他原生事务暂时阻止安装，不会把焦点送到 disabled 按钮。点击“稍后”使用 single-flight close，按钮在 native close 完成前保持挂载、可感知 `aria-busy` / `aria-disabled`，成功关闭后焦点回到登录或状态卡，关闭失败则回到仍可重试的“稍后”。安装失败同样把焦点送回安装重试动作。该行为由 Desktop source contract 和 production asset 证明，本轮没有重新做原生 WebView 键盘点击。
- Relay 启动 preflight 原子性：Start 现在先预留可取消 generation 并发布 `Starting`，再读取 config 与系统安全凭据。只有 generation 仍为当前且 phase 仍为 `Starting` 的读取失败可以提交 `Error`、稳定 `last_error` 和同一份 NSMenu/AX/Web snapshot；并发 Stop/Quit 会先使旧 generation 失效，晚到错误不能覆盖 `Stopped`，也不能降级已连接或更新一代 Relay。纯 Rust 回归覆盖 idle failure、Connected 保护和 Stop 取消慢 preflight，当前锁屏边界下没有访问真实 Keychain。
- 设置保存与无 PID Start：旧实现只用 snapshot PID 判断是否需要停止 Relay。Start 若已发布 `Starting`、却仍在慢 config / secure-store preflight 且尚无 PID，设置可以先提交新 Server / workspace，随后旧 Start 才按旧配置 spawn，造成磁盘、菜单 / AX、Web snapshot 与实际 sidecar 分裂。设置事务现在先取得原子配置变更门禁；普通 Start 在入口与 runtime 锁内都 fail closed，已预留的 `Starting` generation 则由设置事务 Stop 取消，只有持有门禁的设置路径可按新配置重启。阻塞双线程 Rust 回归覆盖“Start 已通过入口但等待 runtime 锁”与“旧 generation 已预留”两种窗口，并以 1 秒超时证明无死锁；Node source contract 锁定门禁取得早于 runtime 判定、Stop、磁盘写与 owned restart。本轮唯一 Finder 检查仍为锁屏，未启动 QA app、未访问 Keychain 或短码；当前证据为 Rust 并发、源码契约与既有 AppKit probe，不冒充状态项点击或 VoiceOver 朗读。包含该门禁的 binary 已与本轮 production dist 一起重建、ad-hoc deep/strict 验签并静态封存，但没有启动运行。
- 营销与认证焦点连续性：公开 `/en/`、`/zh/` 与根营销页进入登录前会在当前 history entry 写入不含账户、locale 或配对信息的焦点标记；返回时由 React 提交后的统一 hook 消费，并兼容 BFCache `pageshow`，把键盘焦点恢复到可聚焦 Hero，而非落在 `BODY`。真实 320×560 production Browser 先复现旧失败，再验证后退后焦点为 `section#top`、首 CTA 完整可见且无横向溢出。空 `?pair=` 也在登录态探测结束、错误标题真实挂载后聚焦；切换语言不会重复抢焦点，真实复验确认标题中英重译且 URL 无 code/short 参数。
- Web 返回与损坏链接焦点：营销页进入登录后再用浏览器后退，会在营销首屏重新挂载后把焦点送回可聚焦的 Hero，而不是让已卸载的邮箱输入把焦点遗留在 `body`；首屏提供明确的 `focus-visible` 边界。空或损坏的 pair 参数会先完成必要的登录态探测，再把焦点送到本地化错误标题。连接失败页的返回首页入口使用至少 44px 高的真实点击/触控目标，不再只有文字行高；两个焦点 effect 都只依赖稳定旅程状态，切换语言不会再次抢走语言按钮焦点。
- Web 短码提交状态：键盘在短码输入框按 Enter 后，字段在推导、等待与激活阶段保持可聚焦但只读，不再因切为 `disabled` 把焦点退回 `body`。表单用真实 `aria-busy` 表达事务，隐藏的原子 `role="status"` 逐阶段播报当前本地化状态；同步的 in-flight guard 同时拒绝只读字段上的重复 Enter，避免启动第二次 PAKE。取消仍立即中止当前 controller、播报稳定提示并把焦点与选择返回短码字段。
- Web 配对完成交接：成功流程不再在写入 `complete` 后同一个任务里立即 `location.replace`，从而让 React 根本没有机会提交“连接完成”或让读屏播报。现在保留 600ms 的有界终态窗口，再次确认当前 pairing run 仍有效后才进入工作台；可注入调度器的单元测试证明导航在等待释放前不会发生，且未改变 PAKE、短码或确认协议。
- Web 配对输入帮助关联：登录后的连接码输入与直接新增浏览器输入现在始终用 `aria-describedby` 关联各自本地化帮助文字；出现错误时只追加对应 `role="alert"` 的 error id，不会移除使用说明或把两个表单的帮助节点串错。Node accessibility/source contract 同时覆盖正常与错误态；这证明 DOM 语义边界，不等同于 VoiceOver、NVDA 或 Narrator 的实际朗读验收。
- Web 设密要求关联：自动聚焦的新密码字段始终用 `aria-describedby` 关联可见的中英文“8–128 字符”要求；校验失败时只追加 `new-password-error`，不会用错误替换输入约束。Cursor、Linear、v0 与 Lovable 当前登录页都收敛到单一 email/continue 首动作，本轮沿用同样的低认知入口；Replit 被 Cloudflare challenge 阻断，未将其当作视觉证据。
- Web 配对码事实文案：实际配对码允许字母数字字符，英文营销页与登录流程统一称为 “8-character code”，与 `ABCD-EFGH` 占位符一致，不再用暗示纯数字输入的 “8-digit code”；中文继续使用中性的“8 位码”。
- Web 认证慢请求播报：邮箱状态检查、验证邮件发送、密码登录、重设邮件发送和新密码保存期间，各自表单用 `aria-busy` 表达事务；按钮的可见进度之外，稳定挂载的原子 `role="status"` 会用当前中英文播报进行中事实。切换语言只重译当前状态，不重新发送请求；空闲时 live region 保持为空，避免重复朗读默认动作。
- Web 认证失败后的焦点恢复：邮箱状态或验证邮件失败会在下一帧回到邮箱字段；密码失败回到密码字段，只有凭据错误才全选便于重输；忘记密码邮件失败回到真实重试按钮；设密链接过期回到“重新验证”，其他保存失败回到提交按钮。重新发送验证邮件前会清除旧错误状态，避免新的请求或成功页仍展示上一次失败。
- 已登录浏览器缺少本机密钥时的电脑发现：仅在没有显式 `pair` 参数时后台查询当前账户正在等待的电脑；一个候选会安全预选，多个候选必须由用户在具名下拉框中明确选择，零候选和无法确定的多候选都 fail closed。损坏的显式链接不会被自动发现覆盖，发现请求未完成时连接按钮保持禁用，短码仍只留在字段中。
- Web 邮箱验证成功焦点：验证邮件发送成功后，原邮箱表单与提交按钮会被下一步说明替换；页面在新区域提交后只聚焦一次可聚焦的“验证邮箱 / Verify your email”标题，使键盘和读屏上下文不会掉回 `body`。焦点 effect 只依赖稳定的 `sent` 状态，之后切换语言会就地重译标题并保留语言按钮焦点。
- Web 退出慢请求：恢复页文字按钮与工作台头像按钮共用同步 `in-flight` guard；远端退出与本地 IndexedDB 清理期间两处入口都会禁用并标记 `aria-busy`，可访问名称和原子 live status 显示当前语言的“正在退出 / Signing out”。因此慢网下重复点击不会启动第二次退出，切换语言只重译正在进行的事实状态。
- Web 审批决策单次提交：允许与拒绝动作按 `approval_id` 共用同步 single-flight gate，第一次点击在 React 提交 `deciding` 状态前就占用门禁，快速双击或跨按钮点击不会重复发送同一审批决定。动作按钮卸载后，可聚焦的 polite status 接管读屏与键盘上下文；请求失败会立即释放该审批的门禁并把焦点恢复到触发提交的精确动作，发送成功则保持锁定到状态刷新完成，继续复用既有 `aria-busy`、live status 与焦点交接。真实 Browser 对 Cursor、Linear、v0、Lovable 与 Relayune 公开页的审计只提供当前状态/动作命名参考；受保护工作台未登录，因此本条行为由可执行 source contract 证明，不冒充真实审批点击。
- Kimi 命令候选读屏：composer textarea 继续保留键盘焦点，但现在以 `aria-haspopup=listbox`、`aria-autocomplete=list` 和 `aria-controls` 明确声明真实命令列表；上下键改变选中项时，`aria-activedescendant` 同步指向与 option 共用稳定 ID 的当前命令，使读屏能获知 Enter 将执行哪一项，而不依赖仅视觉高亮。真实 Browser 只读对比确认 Cursor、Linear、v0 与 Lovable 都把当前 Agent 状态或主输入动作放在稳定上下文中；Relayune 受保护 Kimi 会话未登录，故本条由 DOM/source contract 证明，不冒充真实读屏朗读。
- Web 认证后退取消：从营销页进入登录后，邮箱状态、验证邮件、密码登录或设密请求尚未完成时浏览器后退，会同步 abort 当前认证 controller，再隐藏登录页；四个请求都携带该 signal，catch 遇到主动取消不会写 toast、字段错误或下一步状态。返回营销页同时清理密码与认证步骤但保留已输入邮箱，晚到响应不会让下次登录直接落入陈旧的密码页或“邮件已发送”页；组件卸载也会中止仍在飞行的请求。
- Desktop 慢事务双语状态：设置保存、退出登录或撤销浏览器授权期间切换语言时，静态字典重译后会立即重新覆盖当前事务的“正在保存 / 正在退出 / 正在撤销”事实；原生语言同步失败回滚时也按旧语言恢复同一进行中状态，不再退回普通“保存 / 退出 / 撤销”按钮文案。DEV-only 慢请求旅程与 source contract 覆盖三条路径，production bundle 继续拒绝 QA harness 标记。
- Desktop 设置草稿双语状态：设置对话框打开且尚未保存时切换语言，只重译界面；Server、Agent 路径和自启动草稿不会被已保存配置静默覆盖。DEV WebView 动作写入非秘密占位 URL、切换语言并核对草稿仍在。
- 浏览器授权列表采用 latest-request generation：旧列表请求即使在网络延迟后才返回，也不能覆盖已经完成的单浏览器撤销或退出登录；committed mutation 会主动失效所有在途列表读取。
- Windows workflow 触发完整性：Windows 原生 workflow 的 PR 与 main path filter 同时监听根 `package.json` 和 `package-lock.json`。sidecar 实际消费根锁定依赖，因此单独升级根依赖也必须重新执行 Credential Manager、PE、NSIS 与安装生命周期准入，不能因只监听 `desktop/package-lock.json` 而绕过。
- Windows GUI 入口：正式 `src/main.rs` 在非 debug 构建显式使用 `windows_subsystem = "windows"`，并只委托共享 `relayune_desktop_lib::run()`；托盘、single-instance 与安装后首次启动不会因另一个 console entrypoint 分叉或闪出控制台。Windows source contract 与 xwin `--tests` 已锁定该入口，真实控制台/Dock 等 OS 表现仍待 Windows Server workflow 和 Win10/11 真机。
- Windows 安装器：CI 在上传前执行独立 PowerShell 验证器，拒绝零个或多个 NSIS、非 PE、小于 1 MB 或无法读取签名状态的产物，并为唯一安装器生成 SHA-256；随后在没有既有 Relayune 安装的 Windows Server 2022 runner 上精确执行 `/S` 安装、合成 0.2.0 → 0.2.2 `/UPDATE`、payload / sidecar 哈希与版本检查、quoted HKCU Run 自启动及 `StartupApproved` 审批保留、快捷方式与用户数据保留、`--background` 存活、二次启动单实例交接、精确 PID 清理和 `/S` 卸载。clean-current 安装及首次 GUI 运行前后都必须保持 Run/`StartupApproved` 不存在，安装器不能静默替用户打开自启动；upgrade 则必须在安装后和完整 UI 旅程后都精确保留合成基线的带引号 `--background` Run 命令与 enabled 审批值。正常卸载的 NSIS hook 只删除 Relayune 自己的审批值，更新模式保留；注册表访问拒绝不会再被误判成值缺失并由清理逻辑删除。含空格路径的自启动命令由原生层校正并回读，连续 Windows 包构建也会清除可能复用旧 sidecar 的无后缀缓存。当前签名检查明确是 `NotSigned`，且 lifecycle 脚本尚待 workflow 实际运行；合成基线只证明安装器机械升级语义，不能据此声称历史真实版本迁移、发布签名、SmartScreen 或 Windows 10 / 11 真机准入。
- Windows lifecycle 进程准入：PowerShell 的精确路径进程枚举不再把任意 `Process.Path` 读取异常当成“进程不存在”。只有候选确实在枚举后退出的竞态可忽略；仍存活但路径不可读或为空会带 PID 立即失败。因此静默安装不得自启、未配对不得启动 sidecar、卸载后无残留等断言不会因权限或 WMI/Process API 异常假绿。此失败关闭分支已经源码与 11 项 Windows 契约锁定，仍须由 Windows Server 2022 workflow 实际执行。
- Windows owned WebView2 精确清理：终止 Relayune GUI 前先从一次 fail-closed `Win32_Process` 快照记录其实际后代 `msedgewebview2.exe` 的 PID、名称与创建时间；进程树终止后只把三者完全相同的原实例视为本轮残留。PID 被复用的新进程或其他应用共享的 WebView2 不会被误杀/误报，Relayune 自己留下的旧实例也不能借共享 runtime 假绿。Windows lifecycle 现在会保留实际 tray GUI 与其 owned WebView2，直接执行 `/S` uninstall，再验证同一 GUI handle 以及同一 WebView2 PID + CreationTime 都已退出；Darwin 没有 PowerShell / Wine，因此该真实运行仍待 `windows-2022`。该边界由当前 11/11 Windows 源码契约证明，仍待 Windows Server workflow 和 Win10/11 真机执行。
- Windows live uninstall 真实配置 SHA 保留：lifecycle 在保留真实 tray GUI 与 owned WebView2 的卸载前，对隔离 durable config 读取 SHA-256；执行 `/S` 并确认安装目录、同一 GUI handle 与同一 WebView2 PID + CreationTime 消失后，配置文件必须仍存在且 SHA 精确不变，不能仅靠相邻 sentinel 假装用户数据已保留。`windows-desktop.test.mjs` 锁定 hash 采样早于 uninstall、验证晚于安装目录消失；Darwin 没有 PowerShell / Wine，本条是可执行 Windows lifecycle 与 11/11 source contract 证据，真实运行仍待 `windows-2022`。
- Windows Credential Manager 原生准入：Windows test target 使用 PID 与纳秒生成唯一 account，经生产 wrapper 写入测试凭据，主动逐出 Relayune 内存 cache 后从 `windows-native-keyring-store` 读取，再精确删除并直接确认 `NoEntry`；Drop 在 panic 路径只清理同一 account，不输出值。macOS 构建确认该 probe 不会误运行，xwin 已证明 Windows tests 可编译；真正的 write/read/delete 行为仍须 GitHub Windows Server 2022 执行，不能替代 Win10 / 11 真机故障注入。
- Windows VC Runtime 准入：锁定 Tauri CLI 在正式 Cargo compile 前设置 `STATIC_VCRUNTIME=true`，`tauri-build` 在 MSVC 链接阶段消费；没有使用当前 schema 不支持的 `bundleVCRuntime`。portable verifier 不再全文件搜索可伪造字符串，而是解析 section/RVA、Import Descriptor 与真实 `RT_MANIFEST` 资源树，拒绝 overlay、大小写变体、越界/未映射 RVA、目录循环、错误架构和未终止导入表。Loader layout 还必须满足非零且完整覆盖映射 section 的 `SizeOfImage`、合法且对齐的 `SizeOfHeaders`、`FileAlignment` / `SectionAlignment` 幂次与 section raw/virtual 边界；入口必须位于 executable section，避免“文件存在但 Windows 无法建立映像”的安装后假成功。它要求 GUI 为 subsystem 2、sidecar 为 subsystem 3，两者架构一致、有资源与 0x8160 安全标志，并拒绝带版本或后缀的 `VCRUNTIME`、`MSVCP`、`MSVCR`、`CONCRT`、`VCOMP`、`VCCORLIB`、ATL 与 MFC 动态导入；Windows Universal CRT API-set 和系统 `msvcrt.dll` 仍允许。正式本地 `desktop:build:windows` 与 CI 都会在 Tauri 构建后运行门禁；即使环境覆盖 `STATIC_VCRUNTIME=false` 也不能留下假成功结论。本机全新 target 交叉 release 产物已满足该契约；这仍不是 Win10 / 11 运行证据。

## 旅程结论

| 旅程 | macOS | Windows | 证据 | 本轮发现 |
| --- | --- | --- | --- | --- |
| 冷启动 | 应显示准备态；超过四秒显示仍在准备与诊断入口，再进入登录或已连接首页 | 同左 | `desktop-user-journey.test.mjs`、Desktop WebView journey；隔离 QA `.app` Computer Use | 启动错误态与慢启动无并发重试已有自动化；隔离包中文首屏和切换英文已真机验证，production identity 签名包未启动 |
| 首次配对 | 点击一次打开浏览器，桌面仅显示 8 位码 | 同左 | `desktop-pairing.test.mjs`、`desktop-repairing.test.mjs`、`desktop-user-journey.test.mjs` | PAKE 与二维码不携带短码；创建请求和等待阶段的短时断网均在 10 分钟运行窗口内恢复；响应丢失只恢复同 pairing id / mode / initiator share 的原会话；默认浏览器打开失败时连接码不丢失，可重试或复制链接；本机落盘失败会尽力撤销已创建的远端设备 |
| 邮箱登录 | 浏览器完成邮箱验证、设置密码或密码登录 | 同左 | `desktop-magic-link.test.mjs`、`web-auth-language.test.mjs` | 成功、错误密码、一次性邮件链接及中英文认证文案已有回归；原生浏览器视觉仍需真机验收 |
| 错误短码 | 浏览器拒绝，桌面可取消并立即重新开始 | 同左 | `desktop-pairing.test.mjs`、`ux-recovery.test.mjs`、`workbench-entry.test.mjs` | 密码学拒绝已证明；Web 错误现为字段旁持久 alert 且回焦输入，仍需真机读屏确认播报顺序 |
| 断网恢复 | 已登录 Relay 自动重连并展示“正在重试” | 同左 | `desktop-user-journey.test.mjs` | 已登录 Relay 和首次配对都能区分首次启动、等待与恢复阶段；真实弱网时序仍需双平台真机验证 |
| 关闭/重开 | 关闭窗口不退出；菜单栏和 Dock reopen 恢复焦点 | 关闭窗口不退出；托盘左键或菜单打开恢复焦点 | `desktop-user-journey.test.mjs`、`windows-desktop.test.mjs`；隔离 QA `.app` Computer Use | 红色关闭后进程驻留已真机验证；所有源码恢复入口已收敛到唯一 focus 链。macOS 菜单栏 AX 与 Windows OS 实际抢焦点限制仍需真机验收 |
| 退出登录 | 确认后撤销设备、清凭据、返回首次连接 | 同左 | `desktop-logout.test.mjs`、`desktop-user-journey.test.mjs` | 已退出身份先持久化，再进行不可逆撤销；失败时恢复旧 Relay 或同步到真实磁盘状态，成功与失败两条 durable 结果都会先失效已加载相反身份的 bootstrap，再原子提交菜单/tooltip/AX；不会因二次 Keychain / 配置读取失败留在假 Home；需真机检查慢网下按钮忙碌态 |
| 再次使用 | 重新配对得到新设备和独立浏览器密钥 | 同左 | `desktop-repairing.test.mjs`、`multi-browser-authorization.test.mjs` | 原连接回滚和浏览器隔离已有自动化覆盖 |

## 本轮发现与修复状态

### P1：冷启动失败进入假登录态

`bootstrap()` 失败时，旧实现直接显示登录页，但 `bootstrap` 仍为 `null`。用户点击“打开浏览器连接”不会发生任何事，也没有显式重试入口。正确行为是显示独立、可聚焦的启动错误态，保留错误原因与“重试”，网络恢复时可再次初始化。

状态：已修复并由 `desktop-user-journey.test.mjs` 锁定。失败态保留在 loading surface，提供真实重试按钮，并在网络恢复时自动重试。

### P1：设置“取消”和关闭会走保存

设置对话框位于 `method="dialog"` 表单内，旧实现的 × 和“取消”没有 `type="button"` / `formnovalidate`，同时自定义 submit handler 拦截所有提交并保存。用户编辑到无效 URL 后尤其可能无法取消。取消必须无条件关闭且不调用保存 API。

状态：已修复并回归。两个按钮均为独立 button，显式关闭 dialog，不再触发保存或 HTML URL 校验。隔离 QA `.app` 还以无效 URL 草稿真机验证了 Cancel 后没有保存；× 关闭仍保留在后续完整真机清单中。

### P2：设置保存期间仍可修改字段

旧实现只锁定保存、关闭和取消按钮；原生校验、登录项写入与 Relay 重启期间，Server URL、命令路径和“登录时启动”仍可编辑。请求保存的是点击瞬间的值，用户后续输入却会在成功关闭时消失，形成“看起来保存了 B，实际提交 A”的错觉。

状态：已修复。提交处理在任何异步调用前一次性捕获全部字段，并用独立 in-flight guard 拒绝重复提交；整个事务期间 form 暴露 `aria-busy`，文本输入保持焦点但只读，启动开关与三个动作按钮禁用。成功、校验失败或回滚完成后统一解除锁定。

### P1：桌面和认证主路径曾缺少完整中英文状态

旧实现的 `desktop/index.html` 固定为 `zh-CN`，桌面 HTML、运行时错误和 Rust 菜单栏固定中文。完整适配至少要求：

- 根据系统语言选择 `zh-CN` 或 `en`，并同步 `<html lang>`；
- 桌面登录、配对、设置、更新、诊断、退出和动态 toast 使用同一语言；
- macOS 菜单栏、Windows 托盘、状态 tooltip 与窗口语言一致；
- 英文长文案在最小窗口宽高和 125% / 150% Windows 缩放下不截断；
- 日期时间格式随语言变化，不能只翻译静态标签。

状态：桌面窗口、macOS 菜单栏、Windows 托盘、Web 邮箱/密码/短码认证以及配对成功后的 Web 工作台均已完成中英文接线。语言选择保存在本地，不进入配对 URL；窗口切换会同步 native tray。工作台使用单一双语字典，状态、抽屉、Agent / Approval、附件、历史、错误和辅助技术名称均复用当前语言，日期时间也按 locale 格式化。

后台 bootstrap 与语言切换还通过窗口侧修订号仲裁：切换开始前或进行中取得的旧 native config 不会在晚到时把窗口切回旧语言，也不会在切换仍待定时再发第二次原生语言写入；语言写入失败时会同步恢复内存 config，避免下一次设置保存再次把窗口与菜单栏拆成两种语言。

隔离 QA `.app` 已真机验证中文首屏、切换英文及英文设置页。此证据证明同一 macOS 运行环境中的窗口语言切换，但尚不等同于中文 / 英文系统 locale 各自冷启动，也不证明当前 AX 无法访问的菜单栏状态项已同步语言。

原生命令错误已收敛为稳定错误码。Keychain / Credential Manager、文件选择、sidecar、Relay、配对、浏览器授权、退出、托盘和更新等错误在 UI 边界按当前语言映射；原始 OS / sidecar 文本不再进入英文 toast、状态或诊断。未知旧错误会降级为安全的本地化通用错误。动态用户消息、Agent 输出或远端业务内容仍按内容原文展示，这不属于 UI chrome 的翻译缺口。

### P1：重连事实存在，但用户不可见

Relay 进程会把断线状态发布为 `Starting` 并附带“正在自动重试”的 `last_error`。旧 UI 对所有 `Starting` 都显示“通常只需要几秒钟”，用户无法判断是初次启动还是网络中断。重连应明确告诉用户正在自动恢复；仅在不可自动恢复的错误上显示手动“重新连接”。

状态：已修复。`Starting + last_error` 会展示自动重试事实并保留手动重连动作；连接恢复后回到正常状态。

### P1：签名后的 universal sidecar payload 偏移损坏

`pkg` 把 payload / prelude 的位置写进可执行文件；`lipo` 后必须把每个 thin slice 的相对位置换成 fat Mach-O 中的绝对位置。旧流程只按 ad-hoc 签名布局修复偏移，Tauri 随后换成体积不同的 Developer ID + hardened runtime 签名时又移动了 slice 内 payload。产物仍能通过 `file`、签名、公证和 `lipo` 检查，但真正启动时会把任意字节当作 JavaScript。

状态：已修复。正式 universal 构建会先用与 Tauri 相同的 Developer ID、identifier、entitlements、hardened runtime 与时间戳稳定最终 slice 布局，再修复偏移并复签。发布脚本还会从最终签名 `.app` 内分别强制启动 arm64 / x86_64 sidecar；任一架构未进入 Relayune 业务入口都会在 DMG 公证前失败。本轮重建产物的两种架构均通过。

### P2：对话框和动态状态的辅助技术语义不足

需保证每个 `dialog` 有 `aria-labelledby` 或 `aria-label`，连接状态使用克制的 `aria-live="polite"`，新增浏览器的连接码也可被读屏感知。连续 spinner、pulse 和品牌动效应在 `prefers-reduced-motion: reduce` 下停止或改为静态状态。

状态：已修复并回归。所有 dialog 有可访问名称，关键状态和连接码有 live region，连续动画在 reduced-motion 下关闭；分段控件支持方向键，配对支持 Escape 取消。macOS 菜单栏图标另有本地化的原生 VoiceOver label/help/identifier，连接阶段变化与语言切换会同步刷新该名称；实际 VoiceOver 朗读仍列为真机准入项。

不可逆的退出与撤销授权在命令进行期间使用同步 in-flight guard 锁定语义；确认按钮保持在 DOM 和焦点顺序中，以 `aria-busy` / `aria-disabled` 呈现当前中英文动作，取消按钮与 dialog Escape 则真实禁用，避免对话框消失后操作仍在后台完成。这样慢请求失败后不会把原确认按钮的焦点丢到 `body`：仍需重试时会移除 busy 属性并显式回到“退出登录 / 撤销授权”，权威状态已经改变则关闭对话框并进入对应登录或授权入口。本轮真实 Desktop WebView 浏览器旅程此前已观察到英文退出和中文撤销的慢请求保持 dialog 打开；新的失败焦点恢复由可执行 source contract 证明，尚未作为原生 WebView 键盘真机证据。

### P2：一次性浏览器连接已确认后仍能复制链接

浏览器完成确认、Desktop 正在把独立凭据写入安全存储时，旧界面只禁用了“在这里打开”，两个“复制链接”入口仍可点击。该连接此时已经进入一次性消费的收尾阶段，再交给另一浏览器只会制造无效重试和状态歧义。

状态：已修复。打开与复制共用同一阶段门禁，仅在等待浏览器或网络恢复、且仍有有效随机配对编号时可用；进入保存阶段会同步禁用两个 surface 的四个入口，程序化 click 也会在写入剪贴板前返回。

### P2：快速取消并重连时旧二维码可能覆盖新会话

旧实现让 QR 库直接异步绘制到可见 canvas。用户取消一次连接并立即重试时，旧任务可能比新任务更晚完成，把上一条随机配对 URL 的二维码覆盖到新短码旁边，造成两种连接事实混在同一屏幕。

状态：已修复。二维码先绘制到离屏 canvas，提交前再次核对当前随机配对 URL；取消、过期或完成会清除会话标记并使所有晚到绘制失效。可见 canvas 只接收仍属于当前会话的完整图像。生成期间 canvas 同步暴露 `aria-busy`，并在紧邻的原子双语状态中说明正在生成；只有当前会话完整提交后，图像才进入无障碍树并恢复为可扫描图片。生成失败时空白 canvas 会从无障碍树移除，失败原因持续显示在原位置并指向仍有效的复制链接入口，不再只依赖 4.2 秒 toast 或把空白图像谎报成可扫描；旧任务也不能清除新任务的 busy 状态。

### P1：配对已经成功，辅助列表请求仍阻塞进入主页

Desktop 已完成 PAKE、远端确认和安全凭据写入后，旧流程还会同步等待一次“授权浏览器列表”请求。慢网或 sidecar 响应迟缓时，用户会继续停在不可取消的“正在完成”，虽然核心登录事实已经成立。

状态：已修复。提交成功后在同一渲染任务中先清除配对状态、显示已连接主页和浏览器列表加载态，并将键盘焦点移到连接状态；授权列表随后后台刷新。辅助请求失败只影响列表自身的可重试错误面，不再延迟或回滚已经完成的首次登录，同时不会闪现错误的“尚无浏览器”提示。

### P1：快捷配置与语言切换会并发覆盖原生状态

主页的 Agent、默认 Agent 等快捷按钮会立即保存配置；旧实现没有跨入口的 in-flight 门禁。快速点击两个选项，或在保存过程中切换语言，可能同时进入两次原生设置事务；较晚完成的旧响应会覆盖新选择，Relay 重启与磁盘回滚也可能交错。

状态：已修复。所有快捷配置共用同步事务门禁，在第一次异步调用前立即禁用快捷设置、浏览器授权、工作目录、设置、退出和语言动作；语言写入同样拒绝与配置保存重叠。事务成功或失败后统一从真实 bootstrap 状态恢复可用性。“正在保存 / 已保存”现在是原子 polite live region，读屏可感知保存事实而不移动键盘焦点。源码与 Desktop 可执行契约同时锁定程序化重复调用不能绕过门禁。

保存反馈不再把已经翻译的文字本身当作计时器标识，而是保留稳定状态键与单调修订号。保存后立即切换语言会重译当前事实；上一笔保存的延迟清理也不能提前擦除下一笔保存的结果。

### P1：更新重启会打断尚未提交的首次连接或设置

旧更新卡只在下载本身进行时禁用按钮；首次配对、快捷保存、设置保存、语言切换、撤销浏览器或退出正在进行时，用户仍能点击“更新并重启”。下载完成后的 `relaunch()` 可能直接终止尚未提交或正在回滚的原生事务。反向也成立：更新下载期间仍能开始新的配对或设置写入。

状态：已修复。更新安装与全部原生 onboarding 事务使用同一可执行门禁；任一操作进行中，“更新并重启”禁用并以中英文说明先完成当前连接或设置，仍保留可聚焦的“稍后”动作。更新开始后，首次连接、Relay 重新连接、快捷设置、工作目录、浏览器授权、退出和语言切换同步不可启动；失败恢复后统一重新开放。后续对抗审计发现 Relay `start` 命令和系统工作目录选择器此前仍在门禁之外：前者可能在下载期间启动 sidecar，后者可能在原生选择窗口仍打开时被重启截断。现在两者都有同步 in-flight 状态；重连期间状态卡暴露 `aria-busy`，目录选择期间冻结当前 config/locale 快照，并在选择器关闭后先释放选择事务、再同步进入配置保存事务，中间不产生可插入的异步间隙。程序化调用也在 `relaunch()`、重连、选择目录和首次配对之前重复验证同一门禁，不能绕过 disabled UI。

## 原生真机准入清单

### macOS 13+

- 已完成此前发布流程产物准入：production identity universal `.app` 的 Developer ID 签名、Apple notarization `Accepted`、`stapler validate`、`spctl accepted`，以及该包内 arm64 / x86_64 sidecar 双架构业务入口 smoke；当前共享树仍须在正式发布时重新走完整流程。
- 已完成隔离交互：unsigned debug QA `.app` 的中文首屏、英文切换、英文设置、首次连接页 Tab 顺序、设置 dialog 初始焦点与 Escape 回焦、无效 URL 草稿 Cancel 不保存、红色关闭后进程驻留。
- 未启动 production identity 签名 `.app`，以免打断正在连接的生产 Relayune；该包的运行行为仍不能用隔离 QA 包替代。
- 在中文和英文系统各冷启动一次；确认窗口语言、菜单栏语言和 VoiceOver 名称一致。
- 早先隔离 QA 原生 binary 已实际确认红色关闭后窗口消失但主进程驻留，显式 Quit 后进程结束；当前哈希对应 binary 只完成构建、签名和原生 probe。最近一次主 Agent 运行尝试已确认进程启动，但 Computer Use 应用状态读取超时，未继续 UI 点击。仍需在已配对状态确认 Relay 持续连接，并从菜单栏“显示 Relayune”恢复，同一时间只有一个主窗口。当前 Computer Use AX 无法访问菜单栏状态项。Accessory 模式不应常驻 Dock 或 Cmd-Tab。
- 在窗口隐藏期间断网 30 秒再恢复，确认菜单栏状态和窗口状态从重试回到已连接。
- 无效 URL 草稿点 Cancel 后不保存已通过；仍需补测 × 关闭，并确认两种动作重新打开后都是原值。
- 错误短码、过期链接、取消配对、正确短码各跑一次；短码不得出现在 URL、日志或诊断信息。
- 开启 VoiceOver 和“减少动态效果”，Tab 遍历登录、设置、诊断、退出确认；焦点不逃出 modal。

### Windows 10 / 11

- 已完成源码/交叉编译准入：三档 DPI 逻辑视口契约、托盘左键恢复、single-instance、防控制台窗口、`ShellExecuteW` 浏览器失败检查、Windows sidecar 业务入口 smoke、NSIS 完整性 / SHA-256 验证器、静态 VC Runtime 最终 PE verifier 和 Rust Windows MSVC cross-check。
- 在中文和英文系统、100% / 125% / 150% 缩放下重复冷启动、首次配对和再次登录。
- 关闭窗口后确认托盘仍在且无控制台闪窗；分别用托盘左键和菜单“打开”恢复并聚焦原窗口。源码已证明两者共用 focus 链，但 Windows 前台激活策略必须真机确认。
- 退出 Relayune 后确认 sidecar 进程树结束；普通关闭窗口不得杀掉 sidecar。
- 验证 Credential Manager 中只有对应设备/浏览器的独立凭据项，退出后精确清除本设备项。
- 安装、覆盖升级、稍后更新、更新失败继续使用各跑一次；英文 NSIS 与桌面文案不混用中文。

## 回归命令

```bash
node --test tests/web-workbench-language.test.mjs tests/web-auth-language.test.mjs
node --test tests/marketing-i18n.test.mjs tests/marketing-platform.test.mjs tests/workbench-entry.test.mjs
node --test tests/desktop-native-error-language.test.mjs tests/desktop-user-journey.test.mjs tests/windows-desktop.test.mjs
node --test tests/desktop-signing.test.mjs tests/desktop-user-journey.test.mjs tests/windows-desktop.test.mjs
node --test tests/*.test.mjs
npm run desktop:test
npm run desktop:check
cargo test --manifest-path desktop/src-tauri/Cargo.toml
npm run typecheck
npm run build
git diff --check
```

发布前仍须执行`docs/production-release-lessons.md` 规定的对应发布门禁；本报告中的合成 Mach-O、源码和逻辑 DPI 契约不能替代每次发布的 macOS universal 双架构业务入口 smoke、Windows 原生 CI 或最终真机验收。
