# Relayune 多语种适配调研与实施规范

> 调研基线：2026-09-02。本文同时是 Web、macOS Desktop、iOS、Android 的
> 多语种改造清单、实现约束和发布验收标准。

## 1. 结论

Relayune 原有的多语种能力是四套彼此独立的中英双语实现：Web 使用 TypeScript
对象，Desktop WebView 使用另一套 TypeScript 对象，macOS 原生菜单使用 Rust
枚举，Flutter 大部分页面则直接写中文或中英双写。它们不能只靠增加语言代码扩展：

- 中英二元切换必须改成显式语言选择器；系统语言、用户选择、持久化值和服务端
  `Accept-Language` 必须使用同一套 BCP 47 归一规则。
- 阿拉伯语和乌尔都语是 RTL。布局、箭头、抽屉、表格、弹窗和焦点顺序需要镜像，
  但连接码、邮箱、URL、文件路径、命令、哈希、版本号和 Agent 原始输出必须保持 LTR。
- 日期、时间、数字、复数和相对时间必须由 locale 格式化，不能继续用
  `locale === "en"` 分支拼接。
- 安全协议名、算法名、Provider 名、模型名、用户输入、Agent 输出和代码块不翻译。
  特别是 8 位连接码只能原样显示，不得改数字形态、插入分隔符、进入 URL、日志或分析。
- App 内文案、原生权限说明、通知、菜单、安装与更新文案、商店元数据、网页 metadata
  和邮件是不同交付物，必须分别覆盖。

### 1.1 本轮实施状态

截至本调研基线，仓库内已完成以下工程覆盖：

| 端/交付物 | 已实施范围 | 可核验覆盖 |
| --- | --- | --- |
| Web | 语言检测与持久化、10 语路由/metadata、营销、登录、工作台、定价、版本记录、404、RTL 与技术字段隔离 | Auth `179/179`；Workbench `425/425`；Marketing `382/382` |
| macOS Desktop | WebView、原生 Rust 菜单/状态/辅助功能、系统语言检测、选择器、日期、RTL、`InfoPlist.strings` | 10 个 locale 均为 `300/300` key |
| iOS / Android Flutter | gen-l10n/ARB、登录与配对、工作台、审批、错误恢复、通知、更新、设置内语言切换、RTL 技术文本 | 10 个目标 locale 均为 `471/471` key |
| iOS 原生 | 应用显示名、相机/相册权限说明、通知动作分类与 bundle locale 声明 | 10 个 `.lproj` |
| Android 原生 | string resource、RTL、Android 13 App language config、通知与更新说明 | locale config 列出 10 语；当前 update manifest 含 10 语 |
| Server / 交付链 | 验证邮件、`Accept-Language`、发布说明实际内容语言、安装链接分享/邮件、Android/Desktop 更新文案 | 10 语；未知 locale 明确回退 `en` |

法律正文是有意的例外：尚未获得目标法域专业审校的版本继续显示英文正文，
页面会用当前语言明确告知用户，并把正文标记为 `lang=en` / `dir=ltr`。App Store
Connect 与 Play Console 中的商店文案、截图和法律译文不在 Git 仓库内，仍需上架前的母语与
专业审校；这些外部交付物不应因应用内 key 覆盖率达标而被宣称已完成。

## 2. 支持的 10 种语言

本项目把“世界上最常用”定义为 **第一语言与第二语言使用者总数（L1+L2）**，而不是
母语人口、互联网内容占比或商业收入。口径取自 Ethnologue 2026 排名；人数是估算值，
且语言/方言边界与第二语言熟练度没有唯一标准，因此名单要按年度复核。

| 顺位 | 产品 locale | 语言 | 2026 总使用者（约） | 方向 | 本项目约定 |
| --- | --- | --- | ---: | --- | --- |
| 1 | `en` | English | 14.93 亿 | LTR | 默认与最终回退语言 |
| 2 | `zh-CN` | 简体中文（普通话） | 11.83 亿 | LTR | `zh`、`zh-CN`、`zh-Hans-*` 归一为此值；繁体标签不误映射 |
| 3 | `hi` | हिन्दी | 6.11 亿 | LTR | 天城文；代码和英文模型名保持原样 |
| 4 | `es` | Español | 5.61 亿 | LTR | 使用中性国际西班牙语 |
| 5 | `ar` | العربية الفصحى | 3.35 亿 | RTL | 使用现代标准阿拉伯语 |
| 6 | `fr` | Français | 3.34 亿 | LTR | 使用中性国际法语 |
| 7 | `bn` | বাংলা | 2.74 亿 | LTR | 使用标准孟加拉语 |
| 8 | `pt` | Português | 2.69 亿 | LTR | 当前产品文案采用巴西葡萄牙语风格，匹配所有 `pt-*` |
| 9 | `id` | Bahasa Indonesia | 2.55 亿 | LTR | 使用印度尼西亚语标准拼写 |
| 10 | `ur` | اردو | 2.46 亿 | RTL | 使用标准乌尔都语；技术 token 保持 LTR |

参考资料：

- [Ethnologue 200 的 L1+L2 统计口径](https://shop.ethnologue.com/products/2025-ethnologue-200)
- [Ethnologue 2026 排名与人数汇总](https://en.wikipedia.org/wiki/List_of_languages_by_total_number_of_speakers)

2025 榜单及更早的二手资料常把俄语列入前十；2026 口径下印尼语约 2.55 亿、乌尔都语
约 2.46 亿，均高于俄语约 2.10 亿，因此本轮选择印尼语与乌尔都语，不选择俄语。

## 3. 跨端 locale 合同

### 3.1 选择与回退

所有端统一使用以下优先级：

1. 用户在应用内明确保存的 locale；
2. 操作系统/浏览器的首个受支持首选语言（尊重 `q` 权重）；
3. `en`。

归一规则：下划线转连字符；忽略大小写；仅 `zh`、`zh-CN`、`zh-Hans` 及
`zh-Hans-*` 明确归一为 `zh-CN`；`zh-Hant*`、`zh-TW`、`zh-HK` 等尚未支持的繁体
标签不得误映射为简体中文，应继续检查下一个语言偏好，最终回退 `en`；
`pt-BR`、`pt-PT` 先归一为 `pt`；其他语言先精确匹配，再匹配 language subtag。
不受支持、损坏或旧版本值不能导致启动失败。切换语言不得重新登录、撤销授权、重建内容密钥
或改变配对状态。

### 3.2 文案与数据边界

必须翻译：

- 按钮、标题、帮助、占位符、表单校验、空状态、Toast、错误恢复动作；
- 权限用途说明、通知标题/正文/动作、菜单栏和文件选择器标题；
- 登录验证邮件、更新提示、发布说明、营销与 SEO metadata；
- VoiceOver/TalkBack/ARIA 标签及隐藏辅助说明。

不得翻译：

- 用户与 Agent 产生的消息、项目/分支/会话/文件名；
- 命令、路径、URL、邮箱、哈希、协议、算法、模型与 Provider 标识；
- Server 返回的稳定错误码、事件名、API 字段和密文 envelope。

插值只能使用具名参数，例如 `{count}`、`{agent}`、`{version}`。翻译不得修改、删除或新增
占位符。句子不能拆成“前缀 + 动态值 + 后缀”让译者拼装。

### 3.3 双向文本

`ar`、`ur` 时根文档/Flutter `Directionality` 为 RTL。下列内容使用 `dir="ltr"`、`<bdi>`、
CSS `unicode-bidi: isolate` 或 Flutter `Directionality(textDirection: TextDirection.ltr)`：

- 8 位连接码和二维码旁的备用码；
- 邮箱、URL、文件路径、命令、代码、版本号、SHA-256 摘要；
- Agent 原始消息和本地工具输出（除非内容本身声明方向）。

CSS 新代码使用 `margin-inline-*`、`padding-inline-*`、`inset-inline-*`、
`border-inline-*`、`text-align: start/end`，不使用 left/right 表达语义。图标只有在代表
方向或顺序时镜像；品牌标记、播放图标、勾选、下载和二维码不镜像。

## 4. Web 调研清单

### 4.1 应用 UI

| 区域 | 现有位置 | 必须改造 |
| --- | --- | --- |
| locale 类型、检测与持久化 | `app/auth-locale.ts`、`app/auth-locale-write.ts` | 10 语白名单、BCP 47 归一、cookie/localStorage 安全解析 |
| 登录、邮箱验证、配对、兑换、邀请 | `app/auth-language.ts`、`app/workbench-page.tsx` | 全部状态与错误码翻译；语言选择不进入配对 URL |
| 工作台、审批、子 Agent、附件、预览 | `app/workbench-language.ts`、`app/inline-agent-status.tsx`、`app/system-reminder-content.tsx` | 统一 key、占位符校验、复数、日期与相对时间 |
| 营销首页 | `app/marketing-copy-*.ts`、`app/marketing-home.tsx` | locale 字典、语言菜单、RTL、设备 CTA |
| 定价、法律、更新记录 | `app/pricing/`、`app/legal/`、`app/changelog/` | locale 路由、metadata、法律译文审核、发布说明回退 |
| 页面语言与错误页 | `app/layout.tsx`、`app/document-language.tsx`、`app/not-found*.tsx` | `html[lang][dir]`、加载/404 文案、字体 fallback |
| 样式 | `app/globals.css`、`app/workbench.css` 及页面 CSS module | 逻辑方向属性、长文本、Devanagari/Bengali/Arabic 行高 |

### 4.2 路由、SEO 与 PWA

公开内容应逐步收敛到 locale segment，而不是复制 `app/en`、`app/zh`：
`/[locale]/...` 在构建时为 10 个 locale 生成静态参数，非法 locale 返回 404。每个公开页面要有：

- 正确的 `lang`、`dir`、canonical；
- 10 个 `hreflang` alternate 和 `x-default`；
- 本地化 title、description、Open Graph/Twitter 文案；
- 本地化 Web App Manifest 名称、快捷方式和截图说明（添加 manifest 后）；
- 从任一 locale 登录时只把 locale 存储在同站 cookie/storage，登录、桌面回跳、配对 URL
  仍只携带随机请求编号，绝不携带语言、连接码或其他凭据。

Next.js 官方建议在 App Router 中使用 locale segment、字典和 `generateStaticParams`：
[Internationalization](https://nextjs.org/docs/app/guides/internationalization)。metadata alternate 由
[Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata) 生成。

### 4.3 服务端相邻文案

- `server/email-auth.ts`：验证邮件 subject/plain/html、`lang`、`dir` 和 10 语协商；安全提醒必须
  保留“一次性、10 分钟、不会索要密码或 8 位码”。
- `server/release-notes.mjs`：10 语请求协商；历史记录没有目标翻译时回退英文，新记录应提供
  全部 10 语并在发布前做占位符与长度校验。
- API 业务错误继续以稳定 `error.code` 为权威，客户端按 key 翻译；Server 的 message 只是英文
  诊断 fallback，不把客户端 locale 变成安全或授权判断条件。

## 5. macOS Desktop 调研清单

| 区域 | 现有位置 | 必须改造 |
| --- | --- | --- |
| WebView 字典 | `desktop/src/i18n.ts` | 10 语类型、完整字典/英文回退、占位符一致性 |
| UI 与语言选择 | `desktop/src/main.ts` | 二元按钮改选择器；设置 `html.lang/dir`；切换事务失败可回滚 |
| 日期与路径展示 | `desktop/src/format.ts`、`desktop/src/startup-diagnostics.ts` | 使用 locale formatter；原始路径 LTR isolate |
| 浏览器授权与配对 | `desktop/src/browser-access.ts`、`desktop/src/pairing-*.ts` | 安全动作、倒计时、取消/重试全部翻译；短码不翻译 |
| 原生 locale | `desktop/src-tauri/src/model.rs`、`state.rs`、`config.rs` | Rust 枚举与系统 locale 检测支持 10 语；旧值安全回退 |
| 菜单栏与辅助功能 | `desktop/src-tauri/src/lib.rs` | tray 菜单、状态、tooltip、AX label/help、更新状态翻译 |
| 原生系统面板 | `desktop/src-tauri/src/lib.rs` | 默认工作目录选择器及原生错误标题翻译 |
| Bundle 与安装器 | `desktop/src-tauri/Info.plist`、`tauri.conf.json`、DMG/更新脚本 | 声明 bundle localizations；本地化权限/安装/更新说明 |

Desktop 的 native config 是语言持久化权威。切换动作需要同时更新 WebView、磁盘 config、tray
菜单、tooltip 与 VoiceOver 文案；任一步失败必须恢复到旧 locale，不能出现“WebView 是阿拉伯语、
菜单仍是中文”的混合提交。macOS 用户还可以在系统设置为单个 App 选语言，系统 locale 检测必须
尊重该结果。Apple 推荐用 String Catalog 管理翻译、复数与设备变体：
[Apple Localization](https://developer.apple.com/documentation/xcode/localization)。

## 6. iOS 调研清单

### 6.1 Flutter 共用 UI

`mobile/lib/main.dart` 原先没有 `supportedLocales`、`localizationsDelegates`；主要页面的文案散落在
`mobile/lib/src/ui/*.dart`，`workbench_screen.dart` 与 `app_controller.dart` 还有大量中文状态文本。
需要：

- 使用 Flutter gen-l10n/ARB 作为单一 key schema，接入 `flutter_localizations` 与 `intl`；
- `MaterialApp.supportedLocales` 明确列出 10 语，delegate 提供 Material/Cupertino/Widgets 翻译；
- 设置页提供“默认（跟随系统）”和 10 个显式语言选项；默认模式跟随可用的系统语言，
  系统语言不可得或不受支持时回退英文，手动选择持久化后不再随系统变化；
- Auth、配对、扫码、兑换、设置、工作台、审批、通知权限、发布说明、错误恢复和更新弹窗全部取 key；
- controller/model 只保存稳定状态与错误 kind，不保存已经渲染的中文句子；
- 切换 locale 后正在运行、已送达、审批等待等事实重新渲染，不清空业务状态。

Flutter 官方说明 `supportedLocales` 会限制 locale 匹配，而 Widgets delegate 会设置 LTR/RTL：
[Internationalizing Flutter apps](https://docs.flutter.dev/ui/internationalization)。

### 6.2 iOS 原生资源

| 位置 | 适配点 |
| --- | --- |
| `mobile/ios/Runner/Info.plist` | 相机、照片权限用途说明不得只写中文 |
| `mobile/ios/Runner/*.lproj/InfoPlist.strings` 或 String Catalog | 10 语 `NSCameraUsageDescription`、`NSPhotoLibraryUsageDescription`、显示名 |
| `mobile/ios/Runner.xcodeproj/project.pbxproj` | `knownRegions`/资源引用包含所有 locale |
| Flutter local notifications | 通知类别、动作、标题、正文使用触发时 locale；已排队通知需定义切换策略 |
| App Store Connect | 名称、副标题、描述、关键词、截图、隐私政策与更新说明分别本地化 |

权限用途说明属于审核与隐私内容，不能用未审核的机器翻译直接发布。Apple 明确要求用途说明等也要
本地化，并允许用户为 App 单独选语言：
[Apple Localization overview](https://developer.apple.com/localization/)。

## 7. Android 调研清单

| 位置 | 适配点 |
| --- | --- |
| `mobile/android/app/src/main/AndroidManifest.xml` | `android:label` 引用 string resource；声明 `supportsRtl` 与 locale config |
| `mobile/android/app/src/main/res/values*/strings.xml` | 默认英文资源完整；10 语 App 名称、原生 channel/安装错误等 |
| `mobile/android/app/src/main/res/xml/locales_config.xml` | Android 13 系统 App language 菜单列出 10 语 |
| Flutter 通知实现 | channel 名称/描述、通知标题/动作不可写死中文；channel 创建后不可改名需版本化策略 |
| Android 自动更新 | 只显示当前 locale 的发布说明；按钮、安装失败、权限引导翻译 |
| Play Console | 商店名称、短/长描述、截图、隐私政策和 release notes 本地化 |

Android 要求默认 `res/values/strings.xml` 包含完整 fallback，语言资源只覆盖差异；硬编码 UI
文本应移出代码：[Localize your app](https://developer.android.com/guide/topics/resources/localization)。
Android 13 的 per-app language 通过 locale config 暴露：
[Per-app language preferences](https://developer.android.com/guide/topics/resources/app-languages)。

## 8. 翻译质量与安全词库

以下术语固定不翻译或按产品词库处理：

| 源词 | 规则 |
| --- | --- |
| Relayune、Codex、Kimi Code、Claude Code | 品牌/Provider 名不翻译 |
| Agent | 当前保留 `Agent`，解释性长文可用目标语言说明 |
| Relay | 指组件名时保留；描述“转发”动作时可翻译 |
| end-to-end encrypted | 翻译为目标语言的行业标准“端到端加密”表述 |
| 8-character connection code | 必须表达“8 个字符”而非“8 位数字”；码本身不翻译 |
| Server | 架构边界语境保留 `Server`，避免误译为拥有密钥的“云端” |
| A256GCM、SPAKE2-P256-SHA256-HKDF-HMAC | 永不翻译或断行 |
| approval | 根据语境翻译为操作审批，不译成账户授权 |

涉及“Server 看不到明文”“短码不上传”“浏览器不会因 Desktop 登录自动获权”等安全承诺，翻译
必须由熟悉本仓库 E2EE 不变量的人复核。法律条款、隐私政策和软件许可需要目标法域专业
审核，不能把 UI 文案通过测试等同于法律文本可发布。

## 9. 发布门禁

### 9.1 自动检查

- 每个 locale 与英文基线 key 集合完全一致；占位符集合完全一致；值非空。
- 搜索新增的用户可见硬编码字符串；允许项必须有注释或白名单理由。
- 10 个 locale 的检测、显式选择、持久化、损坏值回退和切换中失败回滚测试。
- `ar`、`ur` 检查 `dir=rtl`；连接码、邮箱、路径、命令、哈希检查 LTR isolate。
- `en-XA` 长文本伪本地化与 `ar-XB` RTL 伪本地化；Android 官方说明见
  [pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales)。
- 每个 locale 构建 Web 静态页面；Flutter widget test 至少覆盖 Auth、配对、审批与设置；
  Rust 测试覆盖系统 locale、菜单与 AX 文案。
- 日志与网络断言保证 locale 切换不会把短码、token、密钥、请求体或业务明文写入 URL/日志。

### 9.2 人工矩阵

至少选 5 组代表性环境：

1. `en`：英文基线与未知 locale 回退；
2. `zh-CN`：现有主路径回归；
3. `es` 或 `fr`：长拉丁文案与复数；
4. `hi` 或 `bn`：复杂文字、字体 fallback、行高和输入法；
5. `ar` 与 `ur`：两种 RTL 字体、镜像、技术 token 混排和读屏顺序。

每组执行：首次启动、邮箱登录、验证邮件、Desktop 登录（浏览器不得自动获权）、8 位码/扫码
配对、错误短码、撤销单个客户端、离线队列、消息/图片/文件、审批、子 Agent、通知、更新、退出、
重启后的 locale 保持。移动端还要检查动态字体 200%、横竖屏和窄屏；macOS 检查菜单栏与 VoiceOver。

## 10. 完成定义与后续维护

“支持某语言”只有在以下条件全部满足时才能对外宣布：

- 高频任务和安全关键路径没有中文/英文泄漏；高级诊断若使用英文回退，必须在发布说明中明确；
- App 内字典、原生系统文案、通知、邮件与商店元数据的覆盖率有可核验报告；
- RTL、长文本、占位符、复数、日期数字与读屏通过自动和人工验收；
- UI/安全文案经母语审校，法律与商店文本完成相应专业审核；
- 新增 key 的提交同时更新 10 语，CI 不允许静默缺失。

每年复核一次语言人口排名，但已发布 locale 不因跌出前十而直接删除。删除 locale 会影响用户保存
偏好、系统 App language 列表、旧通知、URL、SEO 与商店页面，必须走迁移和弃用流程。
