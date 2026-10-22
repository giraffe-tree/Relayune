# Relayune Desktop（macOS / Windows）

## 官方与自建实例

登录前和设置中均可选择服务实例。自建服务填写不带路径或凭据的 HTTPS 地址，先进行无令牌连接检查；
私有实例 CA 需先核对指纹并由用户加入系统信任，不能忽略证书验证。
切换需明确确认，会停止 Relay、清理旧加密 vault 与投递/附件状态、创建新设备身份并要求重新登录配对。
旧实例上的授权不会随本机清理自动远程撤销，必要时应先在旧实例撤销。
业务实例与官方更新信任分开，自托管不自动访问官方更新；主动检查仍使用受信官方渠道。
完整首次准备见[自托管说明](../docs/self-hosting.md)。原生应用、系统信任和打包 sidecar 仍需实机验收。

> 品牌从 Agent Relay 更新为 Relayune。为保证已安装客户端、本机加密 vault 和签名更新链
> 连续，`cn.giraffetree.agent-relay`、旧 URL scheme、更新签名密钥名称及生产域名
> 仍作为兼容性标识保留。

`desktop/` 是跨平台 Tauri 桌面宿主：

- Rust 管理托盘、非敏感配置、应用数据目录内的加密 vault、登录启动和 Relay sidecar；
- TypeScript/Vite 提供首次连接、状态、偏好和脱敏诊断界面；
- `relay/*.mjs` 在构建时打包为自包含 sidecar，最终用户无需安装 Node.js。

窗口内联标志、macOS/Windows 应用图标和系统托盘统一使用
[Eclipse Relay 品牌系统](../docs/brand-system.md)。修改母版后从仓库根目录运行
`npm run brand:generate`，不要单独替换 `.icns`、`.ico` 或托盘 PNG。

macOS 与 Windows 都使用应用数据目录内的 AES-256-GCM 认证加密 vault，不使用
Keychain 或 Credential Manager。设备令牌和内容密钥只在桌面进程内解密，再通过瞬时
进程环境传给内置 sidecar；秘密不进入配置、日志或明文文件。

## 首次登录与客户端授权

macOS 首次登录不做客户端配对：

1. 用户点击“登录 Relayune”；Desktop 在本机生成随机设备令牌，只把摘要发给 Server
   并发起一次性登录请求，然后打开 Server 返回的 `/?desktop_login=<随机请求编号>`。
2. 用户复用 Web 邮箱登录并确认这台 Mac。承载登录的浏览器不会获得浏览器授权记录或
   内容密钥。
3. Desktop 使用只保存在内存中的独立轮询秘密取得确认，把原始设备令牌写入加密 vault。
   `relayune://desktop-login-complete?request=…` 只负责唤醒应用，不携带任何凭据；实际结果
   始终由 HTTPS 轮询确认。
4. 登录提交成功后，Desktop 先说明本机 Agent 为什么需要访问任务文件；只有用户点击
   “继续”才枚举“文稿”目录并触发对应的 macOS 系统权限弹窗，不会主动枚举“桌面”或
   “下载”。“稍后”或系统拒绝都不会撤销已经完成的账户登录。
5. 登录后界面等待用户“连接新客户端”，此时才显示 8 位码并执行 RFC 9382 SPAKE2，
   为该手机或浏览器生成独立内容密钥。首个客户端授权完成后自动启动 Relay。

Windows 当前首次连接仍通过原有的一次性短码 PAKE 同时创建设备与首个客户端授权；
后续客户端与 macOS 一样逐个独立授权。

新增客户端的取消/过期会同步撤销 Server 上同一设备仍未完成的随机配对会话；清理只使用
设备 bearer 与 pairing id，并在晚到的创建命令结束后幂等重试。首次配对、已完成授权、
短码和 PAKE 秘密不属于该删除路径。macOS 登录取消还会同时使用一次性登录轮询秘密与
内存中的设备 bearer 做双重回滚，覆盖 Web 已确认但登录文档恰好过期的竞态。立即清理与
晚到清理之间保持一个有界事务；窗口显示
“正在清理已取消的连接… / Cleaning up the cancelled connection…”，并暂时阻止重新配对、
修改 Server 配置、退出登录、撤销授权和更新重启，避免旧会话与新会话或新 Server URL
交错。最终清理结束后这些动作自动恢复；失败仍由 Server 的 10 分钟 TTL 兜底。

短码、PAKE 输出、内容密钥、桌面登录轮询秘密和原始设备令牌不得写入日志或应用配置。
自定义 URL 只是无凭据的唤醒信号，不是 PKCE 或凭据回调；旧的 PKCE、ECDH 包装密钥和
手工复制长密钥流程已经移除。

## macOS 保持电脑唤醒

在“设置 → 通用 → 保持电脑唤醒”单击并排的“关闭 / 仅插电 / 始终”档位，默认关闭。
运行状态和使用说明收在问号按钮内；发生错误时显示感叹号，点击查看详情。
选择立即保存，下次启动自动恢复；不重启 Relay，不要求管理员、辅助功能或录屏授权。

- 使用 IOKit `PreventUserIdleSystemSleep` 断言，只阻止电脑闲置休眠，允许显示器按系统设置熄灭。
- 关闭窗口或网络暂时断开时继续生效，退出应用时释放；进程异常退出由 macOS 回收断言。
- “仅插电时”由原生后台每 2 秒检查供电状态；供电状态未知时释放该模式的断言并报告错误。
  系统调用失败会重试，界面根据实际持有状态显示生效、等待电源或错误。
- 独立保存在配置目录的 `keep-awake.json`，不修改 Relay 配置、`pmset`、屏保或密码策略。
- “希望熄屏后不锁定？”提供系统锁定屏幕设置入口。用户自行将熄屏后需要密码设为“永不”；
  这是系统全局设置，退出 Relayune 后仍生效，受设备管理限制。应用不自动解锁。
- 不阻止合盖睡眠、手动睡眠或系统低电量保护。Windows 暂不提供此功能。

不启动或安装 App 的相关验证：

```bash
npm --prefix desktop run check
npm --prefix desktop test -- src/keep-awake.test.ts src/i18n.test.ts src/api.test.ts src/webview-journey.test.ts
npm --prefix desktop run test:rust:lib
```

原生测试仅在独立测试进程内短暂申请/释放防休眠断言，并用 `pmset -g assertions` 验证，
不修改系统设置，不触碰正在运行的 Relayune。供电切换和错误恢复使用可控假后端，不能替代实机拔插电源或隔夜验收。

## 开发

共同要求：Rust 1.88+、Node.js >=22.13.0。

- macOS：macOS 13+ 与 Xcode Command Line Tools。
- Windows：64 位 Windows 10/11、WebView2、Visual Studio 2022 Build Tools 的
  “Desktop development with C++”工作负载，以及 Rust MSVC toolchain。

```bash
npm run desktop:install
npm run desktop:dev
```

`desktop:dev` 会自动按宿主平台选择开发流程：

- macOS 默认生成由配置中的 Developer ID 签名的 debug `.app`，不执行 Apple 公证。
  该入口依赖维护者的签名身份；没有该证书的贡献者使用下面的显式开发构建。
  不要直接运行 `tauri dev`，临时开发身份可能与现有应用争用同一应用数据目录。
- Windows 生成 `relayune-core-<target>.exe`，再运行 Tauri 开发窗口；npm 安装的
  `.cmd` Agent 启动器会由隐藏的系统命令宿主解析。

平台选择入口通过当前 Node 原生进程调用 `npm_execpath` 指向的已验证 npm JavaScript
入口，执行固定的开发或构建脚本，不直接 spawn `npm.cmd`。请从 `npm run desktop:dev`
或 `npm run desktop:build` 进入；直接运行 dispatcher 而没有 npm 上下文会明确报错。
这也支持 Node/npm 安装路径含空格的 Windows 环境。Flutter 的 Windows 初始化和
无 shell 启动方式另见 [Flutter 命令入口](../mobile/tool/README.md)。

### 无 Developer ID 的 macOS 贡献者构建

从仓库根目录安装根依赖和 Desktop 依赖后执行：

```bash
npm ci
npm --prefix desktop ci
npm --prefix desktop run check:development-build
npm --prefix desktop run desktop:build:macos:adhoc
```

最后一条显式选择 ad-hoc 签名，仅生成本机架构的 debug 应用
`desktop/src-tauri/target/debug/bundle/macos/Relayune Development.app`，验证 GUI 与
内嵌 Relay 的签名并执行不联网的 CLI 帮助检查。它不会自动打开或安装 App，不公证、
不生成 updater 产物。构建依赖下载可能访问 npm、Cargo 和 pkg 的二进制分发源。

开发覆盖配置使用独立 `cn.giraffetree.agent-relay.development`，使应用配置和加密 vault
与正式版分离；禁用更新 feed，也不注册正式版的 URL scheme。macOS 登录完成后仍可用
HTTPS 轮询返回结果，浏览器唤醒开发包的回跳不可用。首次运行前请按
[自托管配置](../docs/self-hosting.md)准备自己的 Server；默认 Server 地址仍是官方地址。
ad-hoc 身份仅供本机开发，macOS 文件夹权限可能重新询问，不能作为受信任的分发签名。

`check:development-build` 只检查构建计划和隔离约束，不调用打包、签名或应用启动。
这些检查不证明最终 `.app` 已能运行；仍需开发者在独立环境手动验收。

## 构建

在对应操作系统运行：

```bash
npm run desktop:build
```

macOS 日常构建默认使用项目配置的固定 Developer ID 签名（包括嵌入的 Relay），
验证签名及核心启动后才成功退出；签名失败不降级为临时签名。只生成本地 App，
不公证、不上传、不发布。`desktop:dev:macos` 也遵循同一签名规则。
缺少证书或签名失败时不会自动切换到 ad-hoc；贡献者必须主动选择上述开发入口。

脚本让 Tauri 仅组装中间产物，然后显式签名，避免发布环境中的凭据触发自动公证。
首次从临时签名切换可能需要再授权一次；后续保持同一身份有利于复用 macOS 文件夹权限。

macOS 内部验证应用位于：

```text
desktop/src-tauri/target/release/bundle/macos/Relayune.app
```

Windows NSIS 安装包位于：

```text
desktop/src-tauri/target/release/bundle/nsis/
```

也可以在 Windows 上显式运行 `npm run desktop:build:windows`。当前 Windows 构建是
开发/内测构建；对外分发前仍需接入 Windows 代码签名证书并完成真机安装、升级、卸载
和 SmartScreen 验证。

开发/内测构建通过 `tauri.local-build.conf.json` 关闭 updater artifact，避免在没有
发布私钥时生成伪更新包；正式 `desktop:release` 不使用这个覆盖配置，仍强制 updater
签名、公证与完整发布检查。

macOS 对外发布继续使用 Universal DMG：

```bash
npm run desktop:release
```

该命令同时打包 Apple 芯片与 Intel sidecar，构建 Universal 应用，并在存在
`APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID` 和 Developer ID 证书时由 Tauri
提交 Apple 公证和装订票据。输出位于：

```text
desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/
```

发布命令还要求仓库外存在 `~/.tauri/agent-relay.key`（`0600`）。它是自动更新
私钥，必须离线备份；客户端只内置对应公钥。构建会生成签名的 `.app.tar.gz`、
`.sig` 和静态 `latest.json`，并连同 DMG 复制到生产静态目录。
发布说明分别通过 `RELEASE_NOTES_ZH` 与 `RELEASE_NOTES_EN` 提供；旧的
`RELEASE_NOTES` 只作为中文兼容输入。清单会把两种语言编码在同一 `notes` 字段中，
客户端只显示当前界面语言，缺失或旧清单语言不匹配时回退到内置安全更新说明。

应用启动后自动检查与当前系统匹配的更新目标，并每 6 小时重试。发现新版本时由用户
点击一次下载、验签、安装和重启；不会在 Relay 可能处理任务时突然自动重启。
原生菜单常驻“检查更新… / Check for Updates…”；发现版本后切换为“安装更新… /
Install Update…”，点击会恢复唯一窗口并聚焦现有更新卡片。仅在确有更新时，状态项
tooltip 与 VoiceOver 名称也追加“有更新 / Update available”，无需展开菜单即可发现。
更新状态即使与内存值相同也会重新核对原生菜单和辅助功能属性，因此一次瞬时 AppKit
刷新及回滚双失败不会让过期的“有更新”提示永久残留；核对失败会返回稳定更新错误。

## 运行边界

- 新安装会在首次启动时创建默认工作目录：macOS 为 `~/Relayune`，Windows 为
  `%USERPROFILE%\Relayune`；升级不会覆盖用户已经保存的工作目录；
- 非敏感配置位于系统应用配置目录：macOS 的 `~/Library/Application Support/…`
  或 Windows 的 `%APPDATA%\\cn.giraffetree.agent-relay\\config.json`；
- 设备令牌、每浏览器内容密钥和飞书密钥只保存在加密 vault；vault 位于应用数据目录，
  密文使用 AES-256-GCM 认证，每次写入使用随机 nonce，文件原子替换；
- outbox 只保存 A256GCM envelope；
- macOS 不会在未登录启动阶段探测文件夹。账户登录提交成功后先显示用途说明，只有用户明确继续
  才探测系统保护的“文稿”目录；启动流程不会枚举“桌面”“下载”、网络盘、移动磁盘或其他自定义
  位置。其他位置只在用户稍后通过系统文件夹选择器主动选择工作目录时处理。探测仅打开“文稿”并
  读取至多一个目录项，不读取文件内容、不保存或记录路径；尚未决定时由 macOS 显示系统授权弹窗，
  拒绝时写入无路径诊断。已授权的目录不会重复弹窗；
- 远程 Server 必须使用 HTTPS，HTTP 只允许 loopback 开发地址；
- 窗口关闭后应用留在菜单栏或系统托盘；显式 Quit 与系统退出会先在 runtime 锁外停止
  sidecar，避免终止进程时冻结菜单。若 child handle 终止失败会再按已记录 PID 尝试，
  两种方式都失败时保留 PID 和稳定诊断、阻止可取消的退出，让用户能够重试而不是留下
  被错误标记为“已停止”的孤儿进程；失败后菜单、tooltip 与 VoiceOver 会离开无期限的
  “正在停止 / Stopping”，改为明确的“需要处理 / Needs attention”，第二次 Quit 仍会
  使用保留的 PID 重试。Cmd-Q / 系统 Quit 会先同步阻止退出，再把可能等待 generation
  或进程终止的工作移出原生事件线程；快速重复 Quit 复用唯一 stop worker，成功后才恢复
  退出，失败则解除门禁并发布稳定诊断，停止期间 NSMenu、窗口和 AX 仍可响应；
- 退出门禁的完成态只证明某一个 owner 已选择并提交了 Quit 或 updater restart，不再把
  随后到达的另一种进程转场误报为幂等成功。完成 owner 会在释放 in-flight 前发布 ready，
  contender 取得原子位后必须复核 ready 并只释放自己的位；因此菜单 Quit 不能让 updater
  得到“已重启”的假成功，更新重启已提交后并发 Cmd-Q 也会被同步阻止，不能把 relaunch
  降级成普通退出；
- Stop、Quit 和 updater relaunch 也覆盖 Relay 已进入 `Starting`、但 child/PID 尚未登记
  的窄竞态。未提交的 generation 会先被原子取消；若系统 spawn 已经开始，退出会等待
  child/PID 在同一 runtime 临界区登记后再认领并终止，不能先报告 Stopped 或重启 GUI、
  再让后台线程留下孤立 sidecar。macOS 也不会再把 `CommandChild::kill()` 或
  `kill -KILL` 返回成功等同于进程已经消失；两条终止路径都会有界确认 PID 不再存在，
  超时继续保留 `relay_stop_failed` 与原 PID 供 Stop/Quit 重试，updater 不会在旧 Relay
  仍存活时启动新应用；
- updater 安装后的 relaunch 不直接使用会忽略 `prevent_exit` 的 Tauri 重启入口；兼容现有
  process client/ACL 的原生命令会先完成同一 `stop_for_exit`。终止失败时不会设置 restart
  flag，而是保留当前应用、PID 与稳定诊断供用户重试；只有确认 sidecar 已停止才请求重启，
  避免更新后遗留旧 Relay 并启动冲突的新实例；
- macOS 同时通过 `LSUIElement` 和 `Accessory` 策略避免启动时短暂进入 Dock / Cmd-Tab；
  菜单栏图标有随连接阶段和中英文变化的原生 VoiceOver 名称与帮助文本；每次写入
  label、help 和稳定 identifier 后会从真实 `NSStatusBarButton` 读回校验；首次读回若
  因 AppKit 瞬时失败，会记录诊断且不让 Tauri setup 崩溃，但该状态项不能作为唯一后台
  恢复面；应用会请求 Regular Dock/Cmd-Tab 身份并显示登录窗口。后续 bootstrap、Relay
  或语言刷新若同时确认具体状态项可见且 AX 属性可读，会重新准入 close-to-menu；较晚失败
  的 Regular readback 不会再抹掉这个已修复的状态项恢复面。关闭前后仍实时复核 AppKit，
  所以状态项再次消失时不会仅凭历史成功隐藏最后窗口；
- 若 Accessory 已启用但原生状态项创建失败，或 Tauri 对象创建成功但 AppKit 读回的
  `NSStatusItem.isVisible()` 为 false，或初始 VoiceOver 属性读回失败，启动不会退出或
  留下不可达后台进程；应用会记录
  无参数稳定诊断、best-effort 恢复为 Regular，并强制显示唯一主窗口。登录启动
  也不例外。Tauri 的 activation-policy setter 只表示消息已排队，因此应用默认禁止隐藏，
  等该消息执行后再从真实 `NSApplication.activationPolicy()` 读回；只有状态项真实创建
  成功，或 AppKit 确认已经切回 Regular，才允许关闭时隐藏。两种恢复面都失败时保留最后
  一个窗口并发布稳定启动诊断，避免 Accessory 进程彻底失去可操作入口。启动成功不是
  永久凭证：每次关闭还会重新读回实际 `NSStatusItem.isVisible()`、button 与当前
  activation policy；若状态项后来不可见且 Regular identity 也已失效，就拒绝 hide 并
  发布稳定窗口诊断。菜单、Dock/Finder reopen、single-instance 与冷启动共用的窗口恢复
  链会 best-effort 解除最小化，但不会让这一准备步骤的瞬时失败阻断后续仍可成功的
  show/focus；真正的显示或聚焦失败仍返回稳定窗口诊断。Dock/Finder 与 second-instance
  回调虽然为避免锁反转在 worker 中执行恢复，但失败后的 `NSStatusItem` 可见性和
  activation policy 核对会重新调度到 AppKit 主线程；不能因为后台线程无法取得
  `MainThreadMarker` 就把仍健康的菜单栏恢复面误判为丢失、无故切换成 Regular Dock；
- 未完成首次配对时菜单栏显示“尚未连接 / Not connected”；已配对后主动停止仍显示
  “已停止 / Stopped”。高频 Relay 状态发布只读内存中的非秘密 paired 标志，不访问
  加密 vault；配对、退出、撤销最后授权和事务回滚会同步该标志。
  每次发布会在同一个串行事务中只捕获一次 snapshot，用它同时刷新 NSMenu、tooltip、
  VoiceOver 和 WebView 事件。若原生刷新失败，会在释放当前事务后记录稳定诊断，立即
  以最新 snapshot 开启第二个串行事务重试并再次通知 WebView；因此瞬时 AppKit 失败可
  自愈，连续失败也可见，且并发连接/重连不会被旧 phase 回放覆盖；
- 冷启动时加密 vault 暂时不可访问，菜单保持“需要处理 /
  Needs attention”和“显示 Relayune”，不会把安全存储读取失败误当成首次连接或诱导用户
  重复配对；这也覆盖配置尚无 `browser_ids` 的旧版授权。只有磁盘确认存在浏览器授权时
  Web 入口才保留启用；凭据重试成功后，bootstrap 会在原生刷新串行锁内同时提交 paired
  cache、recovery flag 与持久语言，再按真实安全存储状态执行完整语言刷新；Show、Web、
  Update、诊断、退出、tooltip 与 VoiceOver 不会出现一半新语言、一半 fallback 语言。
  瞬时刷新失败会记录稳定诊断并同锁重试，避免并发 Relay publication 看见旧恢复状态与
  新凭据状态的混合菜单。成功的
  首次配对、浏览器授权或退出登录也属于权威凭据提交：返回新 Web surface 前会通过同一
  事务清除旧 recovery flag，并同步菜单 enabled、状态、tooltip 与 VoiceOver；即使 AppKit
  连续刷新失败，凭据事实仍保留且错误可诊断，不会永久停在“需要处理”。该事务只提交
  paired/recovery，不重放命令开始时的 config 快照；因此配对期间完成的语言切换不会被
  较晚返回的凭据命令覆盖，磁盘、Web、NSMenu 与 VoiceOver 保持同一语言；
- 未配对时菜单只有“连接这台电脑… / Connect This Computer…”这一项可操作的主动作，
  会恢复唯一主窗口继续生成短码；Web 工作台入口保持禁用，避免给出两个同义窗口入口
  或绕到公共网页。配对后主动作变为“显示 Relayune”，并启用“打开 Web 工作台”。若
  原生浏览器启动失败，应用会恢复窗口并打开脱敏诊断，不会让菜单点击静默失效；若窗口
  恢复或聚焦本身失败，会记录稳定错误且不会向仍隐藏的窗口发送诊断事件。原生回调记录
  错误后会先推送最新脱敏 Relay snapshot，确保随后打开的诊断框不是旧日志；窗口成功
  恢复后，诊断或更新事件若被原生 runtime 拒绝也不再吞错，会分别保留稳定的
  `window_failed` / `update_failed` 并推送新 snapshot，供下一次聚焦或 bootstrap 恢复；
- 用户选择的中英文属于本机非敏感配置，隐藏登录启动会在 WebView 加载前直接采用，
  避免窗口与原生菜单短暂使用不同语言；即使请求语言与内存、磁盘值相同，也会重新
  核对 NSMenu、tooltip 和 VoiceOver 属性，使一次 AppKit 刷新及回滚双失败可重试自愈。
  语言仍可在慢设置保存、退出和撤销授权期间立即重译窗口，但所有整份 durable config
  写入共享异步事务门禁；语言持久化会等身份事务提交后读取最新配置，不能用旧内存快照
  把刚删除的 device/browser id 重新写回磁盘；
- 设置保存还会在读取旧 runtime 状态前取得独立 Relay 配置变更门禁。普通 Start 会在进入
  和持有 runtime 锁后各核对一次门禁；因此已经通过入口、却仍等待锁或仍在无 PID preflight
  的旧配置 Start 不能在新 Server / workspace 落盘后迟到 spawn。设置事务会取消并认领
  `Starting` generation，再只允许自身用最新配置重启；保存失败与回滚同样在门禁释放前
  恢复旧配置，避免磁盘、菜单 / AX、Web snapshot 与实际 sidecar 使用不同配置；
- LaunchAgent / Run 项的启用状态只是辅助偏好；冷启动回读失败会记录稳定的
  `autostart_failed` 诊断并暂时显示为关闭，不会阻断登录、配对、诊断或 Relay 主界面；
- 主窗口关闭仍先阻止进程退出再调用原生 hide，Relay 继续驻留；若系统拒绝 hide，窗口
  保持可用并记录稳定的 `window_failed` 诊断，同时串行推送最新 Relay snapshot，使随后
  打开的帮助与诊断立即包含原因，不再让“关闭无响应”静默发生。若 setup 尚未证明存在
  状态项或 Regular 身份，close-to-background 不会调用 hide，同样推送该稳定错误；即使
  状态项在关闭前核对成功、却在原生 hide 执行期间消失，也会在 hide 后再次核对真实
  状态项/Regular 身份，立即恢复并聚焦同一窗口。若这次 show/focus 救援也失败，会先
  清除已失效的状态项准入，再请求并读回 Regular Dock/Cmd-Tab 身份，避免仅把诊断写进
  已隐藏的 WebView 后留下无法重开的 Accessory 进程；
- NSMenu、Dock/Finder reopen、single-instance 和系统托盘事件回调不会在 AppKit/Tauri
  事件线程等待菜单刷新串行锁；窗口 hide 与 Regular policy 读回仍留在主线程，但失败诊断
  会离开回调后再发布。这样后台 Relay snapshot 已持有刷新锁并等待主线程写 NSMenu/AX 时，
  用户同时点击菜单、关闭/重开窗口或退出也不会形成锁反转并冻结所有恢复入口；
- WebView 的 bootstrap、Stop、凭据清理、语言/更新原生核对及 updater Exit/Restart 命令
  显式使用 Tauri async IPC wrapper；安全凭据读取、sidecar 终止或 `tray_update` 等待不会
  内联占住 Tauri 事件线程。后台 NSMenu/AX 刷新因此仍能回到主线程完成，不会在启动重试、
  切换语言、停止 Relay 或安装更新时形成另一条锁反转；
- 应用全程保持单实例：交互式二次启动恢复既有窗口，`--background` 自启动不抢焦点，
  两种情况都不会启动第二份 sidecar；交互式二次启动以及 macOS Dock / Finder 的恢复
  失败都会记录稳定 `window_failed` 并串行推送最新 Relay snapshot，使隐藏 WebView 随后
  打开的诊断框不会停留在恢复失败前的旧状态。若 show/focus 失败时状态项与 Regular
  identity 也都不可达，这些主动恢复入口会申请并读回 Regular fallback；状态项仍可用时
  则保持纯菜单栏形态，不增加 Dock 视觉噪音；
- Windows 托盘左键一次恢复窗口，右键显示菜单；专属最小窗口为 `420×420` 逻辑像素，
  支持窄窗滚动和 125% / 150% 缩放；
- macOS 检测到旧 LaunchAgent 时拒绝启动第二份 Relay，避免重复消费命令。

## 验证

```bash
npm run desktop:check
npm run desktop:test
npm --prefix desktop run test:rust:lib
cargo check --manifest-path desktop/src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

`desktop:check` 通过 `desktop/scripts/check.mjs` 执行 TypeScript 与 Rust 静态检查；
`test:rust:lib` 使用同一入口执行 `cargo test --lib --locked`。仅这两个入口的子进程通过
固定 `TAURI_CONFIG` 覆盖将 `bundle.externalBin` 设为空，忽略继承的 Tauri 覆盖及发布凭据，
因此干净源码目录无需先生成 sidecar，也不会用空文件伪造二进制。正式开发、构建和发布配置
仍要求真实 sidecar。静态检查或 Rust lib 测试通过只证明对应源码编译/测试，不验证
sidecar 的打包、签名、启动或 GUI 用户旅程。
依赖 `RELAYUNE_TEST_SIDECAR_PATH` 的打包核心运行探针仍显式标记为 ignored；
准备真实产物后需要单独运行，静态入口不会把它替换为模拟二进制。

上面最后一条原生跨目标命令及下面完整 Rust 回归需要先在相应开发环境准备真实 sidecar；
它们不属于干净源码的静态检查入口。需要运行 AppKit 状态项探针时，再显式执行完整
`cargo test --manifest-path desktop/src-tauri/Cargo.toml`；`test:rust:lib` 不运行该独立探针。

在 macOS 上，Rust 回归还会运行无 harness 的 `macos_menu_ax_probe`：它在主线程真实
创建系统状态项和 `NSMenu`，分别写入英文未连接、英文需要处理和中文已连接的辅助功能
属性、菜单标题与 enabled 状态并从 AppKit 读回，随后立即移除状态项。该探针验证原生
属性和菜单状态链，但不能替代 VoiceOver 实际朗读和状态项点击。

Rust 单元回归还会用 Tauri `MockRuntime` 直接调用生产菜单回调：缺少 `main` 窗口时，
“连接/显示”、未连接 Web 入口和诊断入口必须记录稳定恢复错误且不得发送诊断事件；存在
`main` 窗口时，安全注入的浏览器校验失败必须先成功执行共享恢复链，再发送诊断事件。
这项运行探针不访问默认浏览器、生产配置或生产加密 vault。

最后一条必须在安装了 MSVC、Windows SDK 与对应 C 工具链的 Windows 环境运行；仅
安装 Rust Windows target 的 macOS 主机仍会在目标 C 依赖处失败。WebView2、
加密 vault、托盘、自启动、Agent 进程和 NSIS 行为也必须在 Windows 真机
验证。

`.github/workflows/windows-desktop.yml` 会在 `windows-2022` 上构建 x64 NSIS 测试
安装包，仅在该临时 runner 内进行安装生命周期验证，不上传安装器。
CI 明确关闭 updater 产物签名。对外分发安装器需要另行授权，并先完成实际打包物的
第三方 notice、许可与签名检查。

## 视觉测试字体

`mobile/tool/render_local_web_loading_test.dart` 从当前 Flutter package 定位 SDK 的
Material Icons，不依赖作者的 SDK 安装目录。中文截图还需要本机可用的 CJK 字体：
macOS 默认尝试系统 Arial Unicode，其他系统或该字体缺失时，设置 `RELAYUNE_QA_FONT`
为本机 CJK TrueType 字体路径。字体不会复制到仓库；重新分发字体前须另行核对许可。
