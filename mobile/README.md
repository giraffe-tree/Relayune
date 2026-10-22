# Relayune Mobile

## 官方与自建实例

登录页和设置中可选择服务实例，按服务能力显示邮箱或用户名密码登录。
自建服务必须是 HTTPS 来源地址；私有 CA 可通过高级设置导入单张公开 PEM，核对 SHA-256 后
仅用于该实例的 HTTP/WSS，仍检查主机名、签名和有效期。
切换会明确要求重新登录配对，并关闭旧链路、清理旧实例凭据/缓存、拒绝迟到的旧代次写入。
自建实例停止官方自动推送与更新访问，反馈、社区和公开说明跟随当前实例。
后台通知与原生平台证书行为仍需真机验证；具体安装与恢复见[自托管说明](../docs/self-hosting.md)。

Relayune 的 Flutter iOS / Android 客户端。默认官方入口为
`https://relayune.giraffetree.cn`，也可在运行时选择自建实例；两者使用相同 Node + MongoDB API
与协议 v2，不引入新的 Server 数据通道。

移动端界面、iOS AppIcon、Android legacy/adaptive launcher icon 统一使用
[Eclipse Relay 品牌系统](../docs/brand-system.md)。修改 SVG 母版后从仓库根目录运行
`npm run brand:generate`，不要单独覆盖某个尺寸的 PNG。

Android 8+ 的 adaptive icon 把图形限制在 108 dp 画布中央的 66 dp 安全区，分别提供
普通与圆形入口；Android 13+ 另有单色 alpha mask，适配系统 themed icon。旧系统继续
使用全密度 legacy PNG，圆形入口使用透明外角，避免 Launcher 二次裁切或生成白底。
修改 Android 原生图标资源后运行 `node --test tests/relayune-brand.test.mjs`，确保四种
入口仍使用同一 Eclipse Relay 月面与开放中继通道。

## 已实现的主要功能

- 邮箱状态检查、密码登录、首次验证邮件和安全退出；
- Android / iOS 相机直接扫描电脑端二维码、手动连接兜底、8 位短码 RFC 9382 SPAKE2
  配对和电脑端双向确认；
- 会话目录、Codex / Kimi / Claude 会话创建、历史分页和实时增量消息；
- 电脑在线时发送、离线时只读手机缓存、任务 steering 与停止；
- 会话时间线内的命令、文件、工具和选择题审批；
- 子 Agent 状态、历史与最多四项并行委派；
- Kimi 会话配置；
- 端到端加密图片附件读取；
- 设备在线、ack 序号、离线队列和加密状态诊断。

## 安全边界

- Flutter 与 Desktop Relay 是业务明文端点。会话业务载荷经 Server 转发时只包含协议 v2
  `A256GCM` envelope 和经过认证的路由 AAD；账户、路由元数据及用户主动提交的可读反馈
  遵循[架构与安全约束](../docs/security-and-architecture.md)中的独立规则。
- 配对实现与 Web 的 RFC 9382 `SPAKE2-P256-SHA256-HKDF-HMAC` profile 字节级兼容。
  扫码 envelope 是非 URL
  的本地屏幕到相机通道，只携带一次性配对编号与桌面端已显示的短码；扫码后短码只在
  手机内存中参与握手，不进入 URL、请求、日志或持久化。
- SPAKE2 transcript、HKDF-SHA256 与 HMAC-SHA256 双向确认严格遵循 RFC 9382；
  RFC 会话密钥再经 HKDF-SHA256 扩展为 32 字节内容密钥，验证电脑确认后才持久化。
- 登录会话、手机独立内容密钥和 `X-Relay-Browser-Token` 写入 iOS Keychain 或
  Android Keystore-backed encrypted storage。
- 每台手机是独立的 `web_…` 授权和独立内容密钥；不会导入或复用其他浏览器密钥。
- 与 Web 端相同，当前 SPAKE2 跨语言依赖链在扩大正式使用前仍需独立密码学审计，
  并需重点复核纯 Dart P-256 标量乘法的侧信道边界。测试向量不等同于生产安全审计。

## 手机通知

- App 仅对已在手机端通过 E2EE 验证并解密的实时事件生成系统本地通知，当前覆盖审批请求、
  提问和根任务正常完成。手机连接成功后会展示一次图形化价值说明，只有用户点击“开启任务
  通知”才申请系统权限；拒绝后可从同一入口直达系统通知设置。
- 普通低/中风险审批可从 iOS / Android 通知操作中“允许一次”或“拒绝”；高风险审批不提供
  锁屏盲批，只有安全的拒绝操作；带策略选项的审批和提问会打开对应会话，由用户查看完整
  上下文后处理。通知操作只携带不透明的 `session_id`、`approval_id` 和动作标识。
- 完成通知区分 Codex、Kimi、Claude，显示会话名称，并从紧邻该完成事件的已解密最终回复
  中提取首段、清理格式后展示最多 96 个字符的摘要。摘要会隐藏链接、绝对路径、常见令牌和
  8 位连接码；点击通知直接打开对应会话。
- 正在前台查看同一会话时静默；事件按 `event_id` 去重，超过 5 分钟的恢复事件不会补发
  通知，避免重连产生通知风暴。
- App 进入后台后会保留现有加密实时连接，在 iOS / Android 允许进程继续运行的短暂窗口
  内可以通知。系统挂起或终止 App 后不保证送达，重新打开时通过原有游标追赶事件。
- 代码已有可选 APNs 与 Android JPush 后台通知及设备注册；未配置供应商凭据时不启用。
  供应商通道只允许受约束的通用通知、opaque receipt 或认证密文，不能发送会话业务明文、
  配对码或内容密钥。配置与当前官方包名/topic 限制见[自托管说明](../docs/self-hosting.md)。
  后台或系统终止后的通知送达，仍需在自己的供应商配置、签名和真实设备组合下验收。

### 持续任务卡片

开启任务通知后，主任务开始时自动展示持续状态卡片。iOS 16.2+ 使用锁屏实时活动与灵动岛，
Android 使用系统持续通知，并在支持且符合条件的系统上请求 Live Updates。卡片跟随工作、
审批、回答及结束状态，点击进入原有会话。内部设计图与真机验收截图未随公开源码提供。

卡片留在系统界面不等于后台能收到新事件。前台由本地已解密事件更新；配置 APNs 后还可使用
现有后台更新路径，未配置时不能保证系统挂起后更新。iOS 超过新鲜期显示待同步，Android 显示最近同步时间。用户关闭通知、解除连接
或退出账户会清理持续卡片。

## 开发与验证

Windows 的安全启动器、Flutter SDK 初始化要求及不经过命令解释器的参数传递，见
[移动工具入口](tool/README.md)。

需要 Flutter 3.32 / Dart 3.8 或兼容版本、Xcode + CocoaPods，以及 Android SDK 35+
和 JDK 17。

```bash
flutter pub get
flutter analyze
flutter test
```

仓库根目录也可以运行：

```bash
npm run mobile:check
npm run mobile:build:ios
```

`tool/build_metadata.mjs` 包装入口需要可读取的 Git HEAD 来记录来源。source ZIP 或尚无提交的
本地目录可使用 Flutter 原生命令检查源码；这类构建保留缺失的提交元数据，不应伪造来源信息
或当作正式发行包。

iOS 模拟器需要开发者自己的 Flutter/Xcode 环境；仓库根目录提供
`npm run mobile:simulator` 和 `npm run mobile:simulator:install` 入口，参数见
[模拟器工具](../scripts/ios-simulator-lease.mjs)及[安装工具](../scripts/install-ios-simulator.mjs)。
Android release 构建会在缺少生产签名环境变量时主动失败；使用自己的签名材料，保留现有签名校验，
发行验证见下方额外准入项。

官方版本通过版本化 OSS 对象分发，当前入口由
[Android 更新清单](../public/updates/android.json)维护。该清单属于官方发行渠道，
覆盖 `RELAYUNE_ORIGIN` 不会自动切换到自己的更新源。

生产服务地址可以在开发构建时覆盖：

```bash
node tool/flutter.mjs run --dart-define=RELAYUNE_ORIGIN=https://relayune.example
```

官方发行使用 `https://relayune.giraffetree.cn`。自托管构建还需核对 Deep Link、邮件、
推送及更新配置，不能仅凭覆盖这一参数认定整条链路已完成适配。

## Deep Link

- Android 接收 `https://relayune.giraffetree.cn/?pair=…` 和
  `relayune://pair?id=…`；HTTPS filter 仅匹配根路径，不会截获邮箱验证路由。
- iOS 已注册 `relayune://pair?id=…`。启用正式 Universal Link 前，还需用最终 Apple
  Team / bundle ID 生成并部署 `apple-app-site-association`；在此之前可直接粘贴桌面端
  连接链接。
- 桌面端二维码使用 `relayune-pairing:v1:` 本地 envelope，不是 Deep Link，也不会被
  浏览器或操作系统作为 URL 打开。Android / iOS 客户端只接受严格格式的 Relayune
  QR，并在识别后立即从相机页退出并发起现有 PAKE。

## 发行前额外准入

1. 使用自己的长期签名身份，核对包名、keystore 映射和最终 APK 证书 SHA-256；
   不得启用 debug 签名回退。此核验不依赖维护者的私人 skill。
2. 在 iPhone / iPad 与至少一个 Android 真机完成登录、配对、错误短码、授权撤销、
   离线队列、审批和附件往返。
3. 对最终 IPA / AAB 检查没有明文令牌、内容密钥、测试服务地址或调试日志。
4. 完成 SPAKE2 / P-256 跨语言实现和移动端密钥生命周期的独立安全审计。

Android SDK 的公开核验入口如下，仅用于开发者检查自己准备的产物：

```sh
apkanalyzer manifest application-id /absolute/path/to/app.apk
apksigner verify --verbose --print-certs /absolute/path/to/app.apk
```

核对实际 application ID 和证书 SHA-256 与自己保存的签名身份记录一致，并在原更新路径上
验证升级兼容。以上命令读取已有 APK，不创建或导出私钥；签名密钥和密码仍应保留在仓库外。
工具说明见 [apkanalyzer](https://developer.android.com/tools/apkanalyzer) 和
[apksigner](https://developer.android.com/tools/apksigner)。

## 在手机上核对构建

「设置」底部的「版本信息」显示 App 版本、构建时间（手机当地时区及 UTC 偏移）和
Git 提交号。时间是构建命令开始时写入 APK/App 的固定值，打开页面不会改变；它不是
安装时间或 Git 提交时间。代码版本可与 `git rev-parse --short=7 HEAD` 对照。
有未提交或未跟踪文件的工作树会标注「含未提交改动」，不能仅凭提交号认为与该提交完全一致。

手机构建统一使用 `node mobile/tool/flutter.mjs build ...`（仓库根目录）或
`node tool/flutter.mjs build ...`（mobile 目录）。该入口自动注入
`RELAYUNE_BUILT_AT`、`RELAYUNE_SOURCE_COMMIT`、`RELAYUNE_SOURCE_DIRTY`，并把同一份
非敏感元数据保存在被 Git 忽略的 `mobile/build/relayune-build-info.json`，用于核验构建产物。
Android 签名工具应执行以上 Node 入口；iOS 模拟器安装脚本及 npm 的构建入口已接入。
直接运行 Flutter/Xcode 而未注入这些编译参数时，页面明确显示「未记录」，不伪造时间或提交。
正式发行应从已审查、可追溯的干净工作树构建；仍可通过 APK SHA-256 比对手机内
安装包与本地构建产物，确认实际安装了哪一个包。
