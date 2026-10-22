# Windows Desktop 开发与验收

自托管配置入口、官方更新 feed 与自定义 Server 的独立关系，以及推送和链接的适配边界，
见[自托管与贡献者构建](self-hosting.md)。Windows 源码可不依赖作者的 Apple Developer ID
构建；NSIS 安装包仍继承官方 application ID、默认 Server、更新公钥与 feed。
在隔离 Windows 环境中设置自己的 Server 并重新授权前，不应把它视为独立发行包。

## 当前实现

- Tauri/Rust 代码支持 `x86_64-pc-windows-msvc`，并预留
  `aarch64-pc-windows-msvc` sidecar 映射。
- 设备令牌、每浏览器独立内容密钥和飞书密钥写入 `%APPDATA%` 应用目录内的
  AES-256-GCM 认证加密 vault；不使用 Windows Credential Manager，配置与 outbox
  不保存这些秘密。vault 缺失表示未配对；密文损坏、wrapping key 丢失或访问被拒会传播为
  本地化的 `credential_access_failed`，不再误导用户重新配对。正常 Relay publication
  只读取启动时缓存的非秘密配对状态，不重复解密 vault。
- sidecar 以 `.exe` 打包，Tauri 启动时不显示控制台窗口；停止 Relay 或退出应用时
  使用隐藏的 Windows 进程树终止，避免遗留 Codex/Kimi/Claude 子进程。`taskkill.exe` 通过
  `GetSystemDirectoryW` 解析为系统目录内的绝对路径，不依赖可能被精简或劫持的 PATH / 当前
  工作目录。每次 Windows sidecar
  构建还会精确删除 Cargo target 内由 Tauri 生成的无后缀 `relayune-core.exe` 缓存副本，
  防止连续构建两个版本时 NSIS 错把上一版本 sidecar 再次打包。
- 正式 `tauri build` 会在调用 Cargo 编译前设置 `STATIC_VCRUNTIME=true`，锁定的
  `tauri-build 2.6.3` 再把 MSVC VCRuntime 静态链接到 GUI；这不是 bundler 完成后的
  DLL 复制，也不依赖当前 schema 不支持的 `bundleVCRuntime`。Windows CI 直接读取最终
  GUI 和 sidecar 的 PE32+ 头、普通导入表与 delay-load 导入表，要求 GUI 为 Windows
  GUI subsystem、sidecar 为 CUI subsystem、两者都不以立即或延迟方式导入
  `VCRUNTIME*`、`MSVCP*`、`MSVCR*`、`CONCRT*`、
  `VCOMP*`、`VCCORLIB*`、ATL 或 MFC 等 VC Redistributable DLL 家族，并要求 x64、
  资源目录、High Entropy VA、ASLR 和 DEP。这样 current-user NSIS 不需要为了 VC++
  Redistributable 请求管理员权限；Windows 10/11 自带的 Universal CRT API set 仍属于
  最低系统版本前提。Tauri 会尊重构建环境显式提供的 `STATIC_VCRUNTIME=false`，所以
  正式 `desktop:build:windows` 在 NSIS 生成后也必须运行最终 PE 门禁；不能只相信 CLI
  默认值或 Cargo 日志。该命令随后还会验证最终目录只有一个合理大小的 NSIS PE，拒绝
  `HashMismatch`、`NotTrusted` 等异常 Authenticode 状态，并生成对应 SHA-256 清单；未签名
  内测包与签名有效的发布包都可进入后续验收。正式本机构建按 GUI 的 PE machine 自动选择
  x64 或 arm64 sidecar；Windows CI 则显式钉住并验证 x64，避免文件名正确但架构错误的假绿。
  Windows CI 的 baseline/current 构建共用 Cargo target，因此 current 构建开始前会另写
  freshness marker；最终 GUI 与 sidecar 的文件时间都必须不早于该 marker。PE verifier
  同时输出实际解析字节的两个 SHA-256。这样旧产物即使 subsystem、manifest、导入表与
  安全标志全部正确，也不能冒充本轮 current build，后续 NSIS 安装哈希对比还能把同一组
  已证明 freshness 的 payload 一直追踪到安装目录。
- PATH 会合并 `%APPDATA%\\npm`、WindowsApps、Node.js、Cargo、Kimi 和现有 PATH；
  npm 的 `.cmd` Agent 启动器通过隐藏命令宿主运行。
- 登录启动、系统托盘、浏览器打开、配置原子替换、按平台更新目标和 NSIS 当前用户
  安装均已有 Windows 分支。登录与配对链接直接交给 Windows Shell 的默认浏览器并检查
  `ShellExecuteW` 返回码；系统拒绝 URL 时会保留当前界面并显示可恢复错误，不把仅创建
  `rundll32.exe` 进程误判为浏览器已打开。
- Windows 登录启动注册值会把完整 exe 路径放在双引号内，再附加 `--background` 并精确
  回读。锁定依赖中的 `auto-launch 0.5.0` 默认写法没有给路径加引号，会让含空格的用户名
  或 `%LOCALAPPDATA%` 路径启动失败，也会触发 Windows 的不安全可执行文件路径解析；
  Relayune 在插件写入后立即校正，校正失败会撤销本次启用。
  锁定依赖会先写 Run、再写 `StartupApproved`，所以插件的第二步失败也可能已经部分生效；
  Relayune 会对插件启用失败执行 best-effort 撤销。启用后的插件状态或带引号命令只要
  无法回读、与请求不一致，也会按同一事务撤销启用；设置界面不会在报告失败的同时遗留
  一个下次登录仍会执行的 Run 值。禁用则以最终回读为准：即使删除操作因 Run 值已被
  系统策略提前移除而返回错误，只要实际状态已经关闭，就不会向用户显示虚假的失败。
  正常卸载还会通过精确的 NSIS post-uninstall hook 删除 Relayune 自己的
  `StartupApproved\\Run` 值；`/UPDATE` 路径保留它，且不会触碰其他启动应用的审批值。
- NSIS 保持 Tauri 的 `downloadBootstrapper` WebView2 默认策略：只在缺少 Runtime 时下载
  Microsoft bootstrapper，安装器本身维持 `currentUser`。这符合 Windows 10/11 在线用户的
  低摩擦路径，但不等于离线安装保证；离线、LTSC 和受策略限制的设备仍必须真机验证。
  安装器不额外弹出语言选择器，按系统语言自动选择中文或英文；不在支持列表内的系统
  现在明确回退英文，不再因语言数组顺序误回退中文。
- 官方 single-instance 插件在任何 Relay 或窗口初始化前注册；交互式二次启动恢复既有
  窗口，登录自启动的 `--background` 二次启动不抢焦点，也不会启动第二份 sidecar。
- Windows 托盘左键一次恢复既有窗口，右键打开菜单；恢复统一执行
  `unminimize → show → set_focus`。Windows 专属窗口配置为 `520×480`、最小
  `420×420` 逻辑像素，窄窗内容可滚动并在 125% / 150% 缩放下进入紧凑布局。
  短高度模式会为 Windows 原生标题栏预留空间，让首次连接按钮保持在首屏；设置和
  诊断对话框受当前 WebView 高度约束并可滚动。浅色界面显式请求浅色系统控件，避免
  Windows 深色模式把系统输入框前景色套到白色输入框背景上。
- 保存设置时会锁定保存、关闭和取消操作；本机设置保存失败时窗口保持打开，且已先行
  修改的“登录系统时运行”会恢复到原值。配置落盘失败会恢复原 Relay，使用新配置
  重启失败则会同时恢复磁盘配置、内存配置和原 Relay，避免 Windows 自启动、界面和
  后台进程出现部分成功。
- `.github/workflows/windows-desktop.yml` 在原生 Windows runner 先构建一个版本号较低、
  sidecar 带不同无害 PE overlay 的合成基线包，再构建无 updater 签名的当前 x64 NSIS
  测试包；root `package-lock.json` 也属于 workflow 触发范围，因为 sidecar 打包会直接消费
  root 锁定依赖，不能让只更新锁文件的依赖变化绕过 Windows 准入。构建前运行 Desktop
  测试、Windows Rust 单测和源码准入契约，构建后验证唯一
  当前安装器的 PE `MZ` 头、最低合理大小、内嵌 `ProductName` / `ProductVersion` 与
  “未签名”状态；合成基线显式要求旧版本资源，避免错误产品或陈旧安装器仅凭文件名、大小
  和签名状态通过门禁。基线与当前包每次安装后还会从实际 GUI PE 回读
  `ProductName` / `ProductVersion` 并与该轮期望值比对，避免卸载项版本和 payload 哈希
  都正确、但 Explorer 与诊断所见的应用版本资源仍陈旧。同时验证实际 GUI/sidecar
  PE 的 subsystem、manifest 资源、安全标志和静态 VC runtime。真实 normal/delay import
  table 还必须全部属于审核过的 Windows 系统 DLL 或 Windows API-set；未随安装包提供的
  `WebView2Loader.dll`、OpenSSL/MinGW 等构建机依赖不能因 runner 的 PATH 恰好可解析而通过
  clean-machine 门禁。由于当前 `downloadBootstrapper` 与静态链接产物不需要 app-local
  DLL，基线、升级后 current 与 clean-current 三次实际安装目录也都必须不存在顶层
  `*.dll`；陈旧升级残留或误打包 DLL 不能进入 Windows 优先的应用目录搜索路径。随后在没有既有 Relayune
  安装的 Windows Server 2022 runner 上执行基线静默安装和当前包 `/UPDATE` 升级，校验
  注册版本、固定 `%LOCALAPPDATA%\Relayune` 路径、桌面/开始菜单快捷方式、用户数据、
  带引号登录启动值和 sidecar 哈希替换。两轮安装都会把解包后的 GUI 与 sidecar 分别和
  当前编译/打包源 PE 做 SHA-256 对比，防止 NSIS 缓存旧二进制却因旧版本仍能启动而假绿。
  快捷方式不只通过 COM 回读目标和空参数：后台首启后的交互二启必须由 Windows Shell
  实际激活桌面 `.lnk`，关闭到托盘后的恢复则必须实际激活开始菜单 `.lnk`；两次返回的进程
  都必须正常完成 single-instance handoff。损坏或仅元数据看似正确、实际无法打开的入口
  不能由直接执行安装目录 EXE 掩盖。锁定 Tauri NSIS 生成的 `.lnk` 必须保持空
  WorkingDirectory；Shell 激活会临时从干净的 `System32` CWD 发起，且不向
  `Start-Process` 注入 WorkingDirectory，证明 Explorer 的真实空-CWD 快捷方式无需 CI
  代填安装目录也能恢复应用。Windows Shell Property System 还会从桌面与开始菜单 `.lnk`
  原生回读 `System.AppUserModel.ID`，并要求精确等于 bundle identifier；仅能启动但丢失
  任务栏分组、通知与 Shell 身份的快捷方式不能通过。直接 GUI 探针仍固定到真实安装目录；两类启动都只向子进程
  提供标准 Windows 系统 PATH，因此 GitHub workspace 或 toolcache 中偶然存在的 DLL/工具
  不能替 clean Win10/11 补齐运行时依赖。启动 helper 还会临时清除
  所有继承的 `WEBVIEW2_*` 与 `__COMPAT_LAYER` 覆盖并在创建子进程后恢复；两条 native
  lifecycle 都故意注入不存在的 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`，防止 runner 上的
  fixed Runtime 或兼容层替代安装器应提供的真实系统行为。
  每次解析 baseline/current 安装布局时还会用 Windows SID 审查安装目录、GUI、sidecar
  与 uninstaller 的 ACL；`Everyone`、`Authenticated Users`、`BUILTIN\Users` 或
  `BUILTIN\Guests` 的写入、删除、改权限或取得所有权权限都会失败。这样已安装 PE
  即使在安装瞬间与构建源哈希一致，也不能因可被其他本机普通账户替换而通过准入。
  Windows “应用和功能”元数据也必须精确指向带引号的真实 uninstaller 和 GUI 图标，
  `MainBinaryName` 必须对应已安装 GUI，`NoModify`/`NoRepair` 必须为 1，且
  `EstimatedSize` 非零。生命周期不能再抽出一个看似存在的 EXE 自行卸载，从而掩盖
  用户从 Windows 设置实际触发时会失败或出现无效维护入口的注册表命令。
  安装完成后立即检查登录启动状态：clean-current 轮必须仍没有 Relayune 的 Run 与
  `StartupApproved` 值，不能让安装器静默替用户启用自启动；upgrade 轮则必须精确保留
  合成基线的带引号 `--background` Run 命令和已启用审批值。首次后台启动、真实登录
  Invoke/Cancel、关闭到托盘及重开全部完成后会再次执行同一断言，避免首次 GUI 启动偷偷
  改变状态、随后卸载又清理而让 lifecycle 假绿。
  正常生命周期之前还会用进程级测试路径写入只含单个 `{` 的非秘密损坏配置，真实启动
  已安装 GUI。UIA 必须先在系统 UI 语言下同时看到固定的启动失败说明，以及已启用、屏幕内、
  获得键盘焦点并支持 Invoke 的“重新尝试”/`Try again`；仅等待四秒后出现的慢启动提示不能
  代替失败态。脚本随后从进程外替换为完整隔离配置并 Invoke Retry，要求同一个 HWND
  恢复到持久 `ui_language` 对应的可聚焦登录 CTA、配置逐字段保持一致、未配对 sidecar 未启动。
  在替换之前还会重新检查损坏文件仍存在且 SHA-256 与写入时一致；应用不能一边展示
  “可重试”，一边删除或用默认值覆盖用户尚待修复的原配置。
  Retry 恢复后不会立即杀进程并用下一次冷启动掩盖内存状态：CI 会先向这个同一 PID/HWND
  发送 `WM_CLOSE`，要求它继续驻留，再实际激活已安装桌面快捷方式完成 single-instance
  handoff；恢复后必须仍是原 HWND、可聚焦登录入口、单一 GUI 且没有未配对 sidecar。
  因此“Retry 看似成功，但该恢复进程无法关闭到托盘或二次唤回，重启后才正常”也会失败。
  结束该 GUI 及其 owned WebView2 进程树后才开始后台/二启旅程。因此“按钮存在但未调用”、
  Retry 仍读旧配置、恢复时另开窗口或只在内存里假装成功，都不能通过 Windows Server 准入。
  当前版本再执行后台隐藏启动、single-instance、`WM_CLOSE` 驻留、再次恢复，并通过
  完整五秒观察窗同时要求零可见顶层窗口、foreground PID 始终不是 Relayune、未配对
  sidecar 始终缺席；随后最多十秒的 WebView2 readiness 等待复用完全相同的 fail-closed
  采样，直到确认 owned WebView2 后代才允许交互二启。后台首启若在第六秒才弹窗、抢焦点
  或启动 sidecar 也会失败，不存在观察期与 WebView readiness 之间的空窗。随后通过
  fail-closed 的 `Win32_Process` 快照证明隐藏首启的 GUI PID 实际拥有
  `msedgewebview2.exe` 后代，其他应用或 runner 自己的 WebView2 进程不能代替；再通过
  Windows UI Automation 从主窗口句柄读取 WebView 可访问树，要求首次交互显示及关闭后
  恢复都存在已启用、屏幕内且支持 Invoke 的登录按钮；首次显示时不只读取
  `InvokePattern`，还会真实 Invoke 登录按钮。脚本通过进程级测试配置把配对 API 固定到
  随机 `127.0.0.1` 端口；本机 stub 以流式字节比较只接受固定
  `POST /api/pairings/start HTTP/1.1` request line，不保留请求 header、不读取 request body，
  只返回固定可重试 503 并记录匹配请求的聚合次数；其他 loopback 请求不能替代真实 CTA
  触发而假绿。清理时不仅停止 listener，还会在锁内关闭唯一 active client，以中断只发送
  半截 header 的连接；后台 worker 在 5 秒内未退出会进入 cleanup error 汇总，不能因
  `Thread.IsBackground` 或忽略 `Join` 结果而假称清理完成。因此登录操作必须进入可恢复状态，显示可用的双语
  “取消连接”操作；CI 再真实 Invoke 取消并要求原登录操作恢复。固定失败响应也保证这段
  自动化不会到达打开默认浏览器的成功分支，且脚本从不查询、保存或输出短码、token、
  request body 或动态状态文案。UIA oracle 不再跟随可能被线程设置覆盖的 PowerShell
  `CurrentUICulture`，而是和锁定的 `sys-locale` Windows 实现一样调用
  `GetUserPreferredUILanguages(MUI_LANGUAGE_NAME)`，查询失败即中止：clean-current 轮保持
  `ui_language=null`，验证 runner 系统语言 fallback；
  upgrade 轮在独立配置中持久化 `ui_language=zh-CN`，即使 runner 是英文也必须显示简中。
  两轮都严格要求对应的单一语言，`zh-CN` 使用“在浏览器中登录并连接”，英文使用
  `Sign in & connect in browser`，不允许错误语言靠“中英文任一存在”假绿。脚本在取消后及
  同 HWND 关闭/重开后再次回读非秘密测试配置，不仅验证语言 override，还精确验证
  `server_url`、设备编号、adapter、provider、workspace、CLI/state 路径、Relay 启动偏好和空的
  browser 列表均未被失败流程改写。随后会结束首个 GUI 及其 owned WebView2 进程树，再从
  磁盘配置做一次真正冷启动；新进程必须重新显示相同语言、可获得键盘焦点的登录入口，且
  仍只有一个 GUI、没有未配对 sidecar。这样配置损坏不能被首个进程的内存 bootstrap 和
  同进程 HWND 恢复掩盖到用户下次启动。取消恢复初始 CTA 后还会跨越 2.5 秒、覆盖多个一秒重试周期，
  要求 stub 的精确 pairing-start 聚合计数保持不变；只重置界面却继续后台请求会失败。
  UIA 还要求取消完成及同 HWND 关闭/重开后，这个已启用、屏幕内的本地化登录按钮具有
  `HasKeyboardFocus`；仅 `GetForegroundWindow` 返回 Relayune PID、但键盘焦点停在 WebView
  body 或已隐藏的取消按钮，不能冒充键盘可用。
  因此空白
  WebView、内置错误页或仅标题正确的壳窗口也不能冒充可用登录入口。关闭后恢复会重新
  枚举当前可见窗口，要求其 HWND 与关闭前主窗完全一致，并在这个实际可见句柄上重新验证
  标题、DPI 与 UIA 登录操作；另一个错误窗不能借旧主窗的可访问树假绿。最后通过
  `GetForegroundWindow` 校验交互二启和关闭后重开都真正把既有窗口带到前台，而非仅变为
  可见；登录 CTA 的 UIA 键盘焦点断言再覆盖窗口内部焦点。DPI 准入不再把粗粒度
  `DPI_AWARENESS=2` 同时接受的 Per-Monitor v1/v2 混为一谈，而是从三个真实窗口句柄读取
  `DPI_AWARENESS_CONTEXT`，通过 Microsoft 的
  [`AreDpiAwarenessContextsEqual`](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-aredpiawarenesscontextsequal)
  精确要求
  [`DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2`](https://learn.microsoft.com/en-us/windows/win32/hidpi/dpi-awareness-context)。
  同时验证静默卸载。卸载后安装目录、快捷
  方式、登录启动值与 Relayune 的 `StartupApproved` 审批值必须消失，静默卸载应保留
  用户数据。两轮 lifecycle 都会在 GUI 与 owned WebView2 完全退出后，分别向
  `%APPDATA%` 配置目录和 `%LOCALAPPDATA%` WebView2 profile 写入固定、非秘密 sentinel；
  产品卸载断言必须在 finally 清理之前回读相同内容。因此 clean install 轮也覆盖配置保留，
  且升级/干净安装都不能只保留配置却误删 WebView2 用户数据。Tauri 还会保留 Publisher/Product
  安装器元数据；CI 在安装前确认该精确键不存在，结束时只清理该产品键，不删除 Publisher
  父键。安装器和 SHA-256 清单仅留在该临时 runner 内用于验证，不自动上传或分发。
  以后分发安装器前必须单独完成签名、实际打包物的第三方 notices 和许可审查。

上述配置选择依据 Tauri 的官方
[Windows Installer](https://v2.tauri.app/distribute/windows-installer/) 文档；WebView2
Runtime 的在线/离线分发差异以 Microsoft 的
[WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
说明为准。`ShellExecuteW` 只证明 Shell 接受启动请求，其返回值语义以 Microsoft
[ShellExecuteW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew)
文档为准。CI 对 `/S`、`/UPDATE`、快捷方式、卸载和 WebView2 注册表位置的断言同时对照
锁定 CLI 版本的 Tauri
[NSIS installer template](https://github.com/tauri-apps/tauri/blob/tauri-v2.11.4/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi)，
升级 Tauri CLI 时必须重新审计这些模板契约。
VC runtime 策略对应锁定 Tauri CLI 2.11.4 在真正调用 Cargo 前设置环境变量的
[desktop build implementation](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.4/crates/tauri-cli/src/interface/rust/desktop.rs#L152-L154)，
以及锁定 `tauri-build 2.6.3` 在 MSVC 链接阶段消费它的
[build implementation](https://github.com/tauri-apps/tauri/blob/tauri-build-v2.6.3/crates/tauri-build/src/lib.rs#L708-L710)。

## Windows 开发命令

在 64 位 Windows 10/11 的 PowerShell 中运行：

```powershell
npm install
npm run desktop:install
npm run desktop:dev
```

生成内测 NSIS 安装包：

```powershell
npm run desktop:build:windows
```

输出目录：

```text
desktop\src-tauri\target\release\bundle\nsis\
```

成功返回前会同时验证最终 GUI、sidecar 和 NSIS 安装器，并在安装器旁生成同名
`.exe.sha256` 清单；命令失败时不得把目录中的半成品用于内测或发布。

## 当前自动化证据

- Rust 单测模拟未登录/凭据不完整/凭据完整的前台与 `--background` 冷启动决策，以及
  交互式和后台二次启动的聚焦差异。vault 单测实际执行写入、进程级重新打开、逐客户端
  精确删除、幂等删除、篡改拒绝和 wrapping key 丢失拒绝，并扫描持久化文件，确认设备
  token 与内容密钥原文均未落盘。Windows 原生构建继续验证相同 Rust vault 实现可编译，
  真机准入负责验证 `%APPDATA%` ACL、原子替换和异常断电恢复。
- Windows 源码契约逐项串联首次显示、单实例准入、关闭到托盘、左键恢复、显式退出、
  进程树清理、加密 vault 隔离、设置事务回滚、短时断网恢复和 100% / 125% /
  150% DPI 最小窗口。
- 原生 Windows Server 2022 安装 smoke 先覆盖基线 `NSIS /S` 干净安装与当前包
  `NSIS /S /UPDATE` 合成升级；完成精确清理后，还会用当前安装器重新执行一次无 baseline
  的 `NSIS /S`，因此当前版本的非升级安装路径及首次后台/交互启动不会被“升级后启动”
  替代。两轮共同验证注册版本/位置、实际 GUI 与 sidecar payload、快捷方式、
  用户数据和自启动值保留、WebView2 安装前后状态、`--background` 隐藏启动、未配对
  sidecar 缺席、交互式二次启动、唯一窗口显示、系统英文 fallback 与持久简中 override、
  loopback 隔离的首次连接 Invoke →
  可重试恢复 → Cancel → 回到初始操作且停止重试、`WM_CLOSE` 后关闭到托盘、再次启动
  恢复、精确 Per-Monitor DPI Awareness v2、单一 GUI 进程及 `NSIS /S` 卸载。基线 GUI/sidecar
  与当前 GUI/sidecar 的对应哈希都必须不同；如果合成基线误用了当前 GUI 缓存，`/UPDATE`
  后等于当前源不能再冒充“GUI 已被替换”。升级与 clean-current 两轮安装目录都必须精确匹配当前 GUI
  与 sidecar 源哈希，避免只看 DisplayVersion 或窗口可启动而遗漏陈旧二进制。脚本在发现
  已有安装目录、卸载项、Roaming
  配置、Local WebView 数据、Publisher/Product 元数据、快捷方式、同名 Run 值或同名
  `StartupApproved` 审批值时会
  拒绝运行；ARP 枚举和每个卸载项读取都 fail closed，访问拒绝或读取失败不能伪装成
  “尚未安装”或“卸载已完成”。快捷方式不仅要存在，其 COM 解析出的目标也必须是本轮安装的唯一 GUI，
  且不能夹带 `--background` 等启动参数。安装后还会确认 Publisher/Product 键记录了
  精确的当前用户安装目录。测试会写入与锁定 autostart 依赖一致的二进制审批值，确认
  `/UPDATE` 保留它；升级前还会写入无秘密、有效 schema 的真实 `config.json` fixture，
  更新后必须仍存在且 SHA-256 不变，避免只保留邻近 sentinel 却删除/改写用户配置。
  fixture 随后被精确删除，后续 first-run 仍从缺失 config 开始，哈希与内容均不输出。
  正常卸载 hook 删除 autostart 审批；静默卸载按锁定 NSIS 模板保留 Publisher
  元数据后才由 CI 精确清理。卸载成功还必须在进入 finally 前确认整个 Relayune uninstall
  key 已消失；只删掉 DisplayName 而留下空键或残余值会失败，不能由 CI 兜底清理掩盖。
  除目录内固定 retention sentinel 外，卸载前后还会比较已逐字段验证的真实
  `%APPDATA%/<bundle-id>/config.json` 是否仍存在且 SHA-256 不变；只保留测试 sentinel、
  却删除或改写用户配置不能冒充“用户数据已保留”。哈希和配置内容都不会输出。
  最终 post-cancel cold restart 不会先被 CI 强制结束：真实 GUI、托盘与其 owned WebView2
  进程树会保持运行并直接进入 `uninstall.exe /S`。uninstaller 必须自行结束当前用户的
  Relayune GUI，owned WebView2 实例必须全部退出，且精确安装路径不能留下 GUI 进程；
  这样 NSIS 的 running-app 处理或锁文件失败不能被测试预先 kill 进程所掩盖。
  失败清理逐项捕获，
  不用清理错误覆盖原始失败，并只终止/移除本轮创建的精确进程、目录、注册值和快捷
  方式。首次启动探针拒绝继承 `AGENT_RELAY_TEST_MODE` 或 `AGENT_RELAY_CONFIG_PATH`，
  非秘密 loopback 配置直接写入预检确认为空的真实 `%APPDATA%/<bundle-id>/config.json`；
  malformed Retry、后台启动、取消、关闭重开和 cold restart 因而都会经过 release 使用的
  默认 `app_config_dir`，而不是由 `%TEMP%` 重定向掩盖路径或权限问题。该精确目录由独立
  cleanup action 删除；失败只加入汇总，不会跳过后续 uninstaller、注册表和目录清理。
  在写入 loopback 配置前，已安装 release 还会先以 `--background` 从完全不存在的该目录
  启动：应用本身必须创建 `config.json`；默认 `server_url` 必须精确是唯一生产入口
  `https://relayune.giraffetree.cn`，且该检查发生在 loopback 隔离配置覆盖前，不会让本地
  UIA pairing stub 掩盖旧域名或 staging 默认值。默认配置还必须实际包含
  `ui_language: null`，保证 clean install 服从 Windows 系统语言；测试随后持久化的简中或
  system 隔离值不能掩盖错误的首次默认语言。默认 `browser_ids` 必须为空，`state_path` 必须是
  同一真实 app-data 目录内的绝对路径，配置目录与文件不得向广域 SID 授予写权限，并且
  进程仍须满足 hidden/WebView2/无 sidecar 契约。
  在这次显式启动之前，脚本会重新断言 `config.json` 与该应用的 WebView2 user-data 目录
  均不存在；`NSIS /S` 若短暂拉起 GUI 后进程已经退出，也不能用预建运行时数据冒充真正
  的 first run。系统共享 WebView2 Runtime 的正常 bootstrapper 安装不属于该应用目录。
  探针随后精确结束 GUI 与 owned WebView2；CI 不能通过预建 `%TEMP%` 文件冒充默认首次保存。
  Run、`StartupApproved` 与 WebView2
  Runtime 版本的精确值读取只把确实缺失解释
  为 null；访问拒绝会中止预检，不能伪装成空状态、伪称 bootstrapper 路径已执行，或在
  finally 中删除既有值。进程终止通过 `Process` 句柄执行整棵
  进程树 Kill，不在进程退出后重新按 PID
  查找，避免 PID 被复用时误杀无关进程。按 exe 路径枚举残留进程时只容忍候选进程已经
  退出的竞态；仍存活但因权限或系统错误无法读取路径的候选会让 smoke 失败，不能伪装成
  “没有 GUI/sidecar”。终止 GUI 前还会从一次 fail-closed `Win32_Process` 快照记录该
  GUI 实际拥有的每个 `msedgewebview2.exe` PID 与创建时间；进程树 Kill 后，只有同 PID、
  同名称且同创建时间的原实例才算残留并必须退出。这样不会把 PID 复用的新进程或其他
  应用的共享 WebView2 误杀/误报，也不会让 Relayune 的孤儿 WebView2 在 GUI 消失后假绿。
  WebView2 是共享系统依赖，即使本轮
  bootstrapper 安装了它也不会由脚本卸载。
- 构建完成后的便携 Node PE 验证器不依赖 Visual Studio `dumpbin`：它解析 DOS/COFF/
  PE32+ optional header 和 section table，把 RVA 映射回节内文件范围，再沿 Import
  Descriptor 表读取大小写不敏感的真实 DLL 名，并沿资源目录树读取真正的
  `RT_MANIFEST` 数据。COFF header 必须设置 `IMAGE_FILE_EXECUTABLE_IMAGE` 且不得设置
  `IMAGE_FILE_DLL`，避免只有 PE 外形、实际无法由 `CreateProcess` 作为 GUI/sidecar EXE
  启动的 payload 混过安装准入。`AddressOfEntryPoint` 还必须非零、映射到实际节内文件
  数据并带 `IMAGE_SCN_MEM_EXECUTE`，避免安装成功后入口无效或被 DEP 阻止执行才在首启
  暴露损坏。Optional header 的 `FileAlignment` / `SectionAlignment` 必须是合法的二次幂
  组合，headers/节文件范围必须按其对齐，`SizeOfImage` 必须对齐且覆盖每个映射节；不能让
  Windows loader 无法建立映像的安装 payload 通过静态门禁。`NumberOfRvaAndSizes` 不得
  超过 PE32+ 的 16 个标准目录，且全部目录项必须落在 `SizeOfOptionalHeader` 声明的范围
  内；验证器不能越界把 section table 或 padding 当成 import/resource 元数据。Common
  Controls 必须来自注释外真实的
  `assemblyIdentity`；XML
  注释内的伪标签、未闭合注释或孤立注释结束符都会 fail closed，不能用字符串命中伪造
  manifest 合规。overlay、无关字符串、越界/未映射 RVA，或混合大小写及换成
  `MSVCP140_2.dll` / `CONCRT140.dll` / MFC 等名称的动态 VC Runtime 导入都不能伪造通过；
  Windows 10/11 系统 Universal CRT API-set 与 `msvcrt.dll` 仍明确允许。它会阻止
  `windows_subsystem`、Tauri 静态 VCRuntime
  或打包 sidecar 发生静默回归；GUI 的 manifest 资源还必须包含 Common Controls
  identity。GUI 与 sidecar 的真实 manifest 都不得请求 `requireAdministrator`、
  `highestAvailable` 或 `uiAccess=true`；否则 current-user 安装可能在首启或 Relay 启动时
  弹 UAC，或因用户目录不满足 UIAccess 的签名/安全位置要求而无法执行。DPI Awareness
  当前由 Tauri/tao 运行时 API 设置，原生 lifecycle 再用窗口
  句柄读取并精确比较 Per-Monitor DPI Awareness v2 context，不能用 manifest 字符串或
  只区分 unaware/system/per-monitor 的粗粒度枚举代替该运行证据。
- `cargo xwin check --target x86_64-pc-windows-msvc` 只证明 Rust 与 Windows API 能按
  MSVC x64 ABI 编译；原生 workflow 进一步在 Windows runner 执行 Rust 单测、sidecar
  smoke 和 NSIS 构建/静态校验。两者都不能代替下面的 Windows 10/11 人工验收。

## 真机验收清单

1. 在干净 Windows 10 和 Windows 11 x64 用户中完成安装、启动、退出和卸载；窗口、
   系统托盘菜单、关闭后驻留以及“退出 Relayune”行为一致。
   同时分别在前台与登录自启动场景重复启动，确认始终只有一个主进程和一份 sidecar；
   前台二次启动恢复并聚焦既有窗口，`--background` 不抢焦点。
2. 首次连接只要求点击、邮箱登录和 8 位码；错误码被拒绝，短码和密钥不出现在 URL、
   配置、日志、MongoDB 或截图中。
3. `%APPDATA%` 应用目录中只能看到认证加密 vault、随机 nonce 和 wrapping key，不能
   搜索到设备 token、浏览器内容密钥或飞书密钥原文；取消一个浏览器只删除对应 vault
   条目，退出登录撤销设备并清理本机秘密。
4. 重启 Windows 后登录启动生效；Relay 只主动发起 HTTPS polling，系统防火墙无需
   开放入站端口。
5. 分别验证原生 `.exe` 和 npm `.cmd` 形式的 Codex/Kimi/Claude；路径包含空格、中文和非
   ASCII 用户名时仍能启动、列出会话、发送消息、审批和停止任务。
6. 断网后产生的密文 outbox 可在联网后重放；反复保存设置不会丢失配置，磁盘只出现
   A256GCM envelope 和必要路由元数据。
7. 停止 Relay、退出应用和注销 Windows 时检查 `relayune-core.exe`、`codex`、`kimi`、`claude`
   是否遗留；发现遗留进程不得进入公开测试。
8. 验证 `windows-x86_64` 更新目标：无 Windows 更新条目时静默继续运行；正式签名
   更新发布后再验证下载、签名拒绝、安装和重启。
9. 正式分发前接入受信任的 Windows 代码签名证书，验证时间戳、SmartScreen、升级
   覆盖安装、降级拒绝和卸载后的用户数据策略。
10. 临时移除默认浏览器关联或让 Shell 拒绝测试 URL，确认 Relayune 显示可恢复错误且
    连接码仍留在界面；恢复关联后重试能打开用户选定的默认浏览器。不得用
    `rundll32.exe` 是否出现来代替这一验收。
11. 在缺少 WebView2 Runtime 的 Windows 10/LTSC 虚拟机与受企业下载策略限制的设备上
    分别测试 bootstrapper 成功、拒绝和断网路径。CI runner 通常已经具备 Runtime，应用
    会明确记录安装前后版本；只有日志显示安装前缺失时才证明本次执行经过 bootstrapper
    路径。已有 Runtime 时，应用能启动不能证明缺失 Runtime 时的下载、UAC、错误文案或
    重试体验。
12. 人为拒绝应用数据目录访问、篡改 vault 密文或移走 wrapping key 后重新启动，确认
    空 vault 显示未配对，而已有 vault 的读取失败显示双语可恢复错误且不清理现有配置。

## 已知验证边界

macOS 可以交叉生成 Windows x64 PE32+ sidecar，并使用 `cargo xwin check --target
x86_64-pc-windows-msvc` 验证 Rust / MSVC 依赖入链；本地也能交叉生成 release GUI 并
静态检查 GUI subsystem、sidecar CUI subsystem、资源目录、导入表和安全标志。直接运行
`cargo xwin build` 不会自动模拟 Tauri CLI 的 `STATIC_VCRUNTIME` 设置，判断分发产物依赖
时必须使用正式 `tauri build` 路径或显式复现该变量，并检查最终 PE。上述交叉产物仍无法
提供 WebView2、应用数据目录 ACL、NSIS 安装或 Windows 前台激活等真实系统行为。因此仍以原生 Windows
workflow 和上述真机清单作为最终准入条件。Windows Server 2022 CI 的安装 smoke 也
不能替代 Windows 10/11 真机：它不点击托盘；虽然会验证前台焦点并真实 Invoke/取消
loopback 隔离的 WebView 首次登录操作，但不验证默认浏览器页面加载、邮箱登录/8 位码、
加密 vault 内容与 ACL、显式“退出 Relayune”
或历史发布包的真实数据迁移。合成基线使用当前源码，只验证 Tauri `/UPDATE` 的文件、
注册表和保留语义；用户手工运行新版 setup 的交互式升级也不等同于该路径。CI 无法安全
卸载 hosted runner 的共享 WebView2，因此没有模拟“缺少 Runtime 且断网”的离线路径；
只有安装前确实缺少 Runtime 的 runner 才会经过在线 bootstrapper。CI 只验证当前 runner
的 Per-Monitor DPI Awareness v2 context；100% / 125% / 150%
布局仍是源码几何契约而非三档系统缩放实测。脚本为了安全卸载会精确终止本次启动的
测试进程，因此不能把它当成显式退出链验收。测试配置只隔离 Relayune 配对 API；应用
启动时独立执行的 updater 检查仍使用正式更新端点，所以该 smoke 不能宣称整个 GUI 进程
是零生产网络访问。loopback 首次连接断言本身不会把配对数据发送到生产。hosted runner
仍是英文 Windows Server 2022：持久简中 override 的原生 WebView/UIA 证据不能替代简中
Windows 10/11 上“未保存语言时跟随系统”的 fallback、字体、输入法和布局真机验收。
