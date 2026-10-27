# 依赖安全审查与剩余公告

更新：2026-10-27。按当前锁文件重新查询 npm 官方审计与 OSV。此前已用 `cargo tree --locked`
核对 macOS arm64/x64、Windows x64 和 Linux x64 的依赖图。公告命中、实际目标依赖、
调用条件和最终二进制是不同证据；本页不声称全项目零漏洞或已经通过密码学审计。

## 2026-10-27 当前公开前待处理

本轮只更新查询、调用范围复核与文档，没有修改依赖或锁文件。根完整 npm 审计有
**3 个包命中：1 critical、1 high、1 moderate**；Desktop 完整 npm 审计零命中。
不能沿用下文 2026-10-22 的旧审计计数或把本次发现写成已经修复。

| 包与当前锁定版本 | 本轮证据与范围 | 处理要求 |
| --- | --- | --- |
| `next@16.3.8` | critical，含图像优化及 `use cache`/Server Actions 公告。项目使用 `output: export`、`images.unoptimized: true`；线上是 Nginx 静态文件与独立 Node API，没有运行 Next 请求服务器 | 先升级到兼容的修复版本并验证构建；不能仅凭锁命中声称线上已存在可利用 RCE，也不能不处理构建工具依赖 |
| `nodemailer@10.1.1` | moderate，收件地址解析公告；`server/email-auth.ts` 实际导入，Server bundle 许可输入也包含此包 | 补丁升级并回归邮箱地址校验、投递及恢复流程；公告修复边界为 10.1.4，本轮 npm 建议 10.2.1，具体目标仍需兼容验证 |
| `zod@4.4.3` | high，过大集合校验的内存耗尽；本项目通过 `eslint-plugin-react-hooks` 的开发 lint 链引入，不是当前 Server bundle 输入 | 更新兼容转依赖并验证 lint；公告修复版本为 4.6.6 |
| `tokio@1.53.1` | OSV 新命中 `RUSTSEC-2026-0386`，涉及 Unix `AsyncFd` 构造器的 I/O safety；macOS 目标实际经 Tauri/reqwest/updater 选中，项目源码未直接调用 `AsyncFd` | 复核间接调用范围并更新兼容补丁；当前主线修复边界为 1.53.3。不把包命中直接写成会话内容泄漏 |
| `block-buffer@0.10.4` | OSV 新命中 `GHSA-qwgh-2vcv-g2f7`，涉及捕获 panic 后的缓冲区状态；macOS 图上经 `digest → sha2 → tauri-codegen → tauri-macros` 用于构建。公告标示修复 0.12.1，跨主版本 | 核对精确受影响版本及构建调用条件；这条依赖图不是会话加密运行时证据，不直接跨主版本覆盖或宣称已修复 |

来源：[Next 图像优化](https://github.com/advisories/GHSA-2464-fhr4-w9xw)、
[Next use cache](https://github.com/advisories/GHSA-673q-mjm6-r5xr)、
[Next Server Actions](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)、
[Nodemailer 地址解析](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8)、
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、
[Tokio](https://rustsec.org/advisories/RUSTSEC-2026-0386.html)、
[block-buffer](https://github.com/advisories/GHSA-qwgh-2vcv-g2f7)。

本次 OSV 查询仍覆盖 672 个去重 Cargo/hosted Pub 版本，13 个 Cargo 包命中，hosted Pub 未命中。
除新增两包外，其余包仍是下文记录的 Windows 解压、Linux GTK/D-Bus 与跨目标维护状态项。
当前 npm 报告未再列出此前 braces 五包链；这是本轮审计接口返回结果，不代表源码已修补该链。
现有 `check-npm-audit.mjs` 已实际拒绝本轮根报告；没有扩大豁免或关闭门禁。
依赖修复及受影响验证完成前，不能把该候选写成“全部公开门禁通过”。

## 2026-10-22 已完成的源码整改

| 事项 | 当前源码结果 | 验证范围 |
| --- | --- | --- |
| 飞书运行时依赖 | 删除飞书 connector、专用运行路径、配置及界面残留；根锁移除 SDK 和其独有的 26 个包，包括 `axios`、`follow-redirects` | 不再保留该 SDK 引入的重定向凭据泄漏攻击面；不是给原漏洞增加豁免 |
| Desktop 测试工具 | Vitest 及同版本组件由 4.1.11 升至 4.1.12 | 修补 mock 注册代码注入及 Windows 路径处理公告；Desktop 完整 npm 审计零命中 |
| Desktop TLS 验证 | `rustls-webpki` 0.103.15 → 0.103.16 | macOS 两架构、Windows、Linux 依赖图均使用该包；修补不受信中间证书路径问题 |
| 其他目标的根证书集 | `webpki-root-certs` 1.0.9 → 1.0.10 | 当前核对的四种 Desktop 目标图均未选中该包，仍修补锁文件中的跨平台组件；不把锁中存在说成 macOS 已使用 |

修复依据：[follow-redirects 公告](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8)、
[Vitest mock 注册](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)、
[Vitest Windows 路径处理](https://github.com/advisories/GHSA-xp26-3454-mjgp)、
[rustls-webpki](https://rustsec.org/advisories/RUSTSEC-2026-0382.html)、
[webpki-root-certs](https://rustsec.org/advisories/RUSTSEC-2026-0383.html)。

这些变更目前属于源码准备，未据此重签、安装、上传客户端或重新部署正式服务。
之前发布的 0.3.33 安装包不能当作本轮补丁的已发行证据；后续发行应使用新的版本化产物并重新验证。

## 2026-10-22 的剩余项分类（保留历史证据）

### 1. 仅开发 lint 链：保留明确告警

当时根完整 npm 审计有 **5 项 high**，全部来自同一条
`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces@3.0.3`
开发链与 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。
它们是一个问题沿依赖链计数，不能说成五个独立漏洞，也不能说已经修复。
当时报告未命中生产依赖，Desktop 完整依赖树为零命中；不能将该历史结果用于 2026-10-27 的新查询。

该 braces 公告没有可采用的修复版本。npm 提议降级 `eslint-config-next` 到 14.2.35，
不是修补当前 braces 版本；本轮不采用该跨主版本降级。开发工具处理不受信任模式仍有风险，
CI 不注入生产秘密、限制权限和时间不等于漏洞消失。

`scripts/check-npm-audit.mjs` 仅识别精确版本、开发标记、单个 GHSA 和同一依赖关系，
输出 `riskAccepted:false` 及 warning。新公告、运行时节点、修复建议或版本变化、无效或陈旧报告均失败。
没有扩大扫描例外，也没有把风险披露当作维护者接受风险的替代。

### 2. Windows 更新解压链：发行 Windows 前处理

锁定的 `zip@4.6.1` 命中
[RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html)、
[0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html)、
[0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html)，涉及解压权限及符号链接边界。
当前 `cargo tree` 仅在 Windows x64 目标选中该包；macOS 两架构和 Linux x64 没有选中。
`tauri-plugin-updater@2.10.1` 的 Windows ZIP 路径实际调用 `ZipArchive::extract`，
因此不能仅凭平台过滤就声称所有源码路径不受影响。

上游公告修复版本为 9.0.0，跨越当前依赖的主版本约束；不能直接强制覆盖不兼容版本。
Windows 不在本轮安装包发行范围，保留这一未修复项；恢复 Windows 分发前必须升级兼容上游
或修补并验证提取实现。现有更新签名验证仍保留，签名先于安装不等于解压实现本身已修复。

### 3. Linux GTK/D-Bus 链：不扩展为当前 macOS 风险

| 包 | 公告类型 | 目标与处理 |
| --- | --- | --- |
| `glib@0.18.5` | [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)，`VariantStrIter` unsoundness，修复在 0.20 | 仅 Linux x64 目标选中；Tauri GTK 链仍使用旧主线，不能强行跨 API 覆盖。Linux 发行前处理并验证 |
| `proc-macro-error@1.0.4` | [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)，不再维护 | 仅 Linux x64 目标选中；随上游迁移，不标作已证实可利用漏洞 |
| `zbus_names@4.3.4`、`zvariant@5.13.1`、`zvariant_derive@5.13.1` | RustSec [0371](https://rustsec.org/advisories/RUSTSEC-2026-0371.html)、[0370](https://rustsec.org/advisories/RUSTSEC-2026-0370.html)、[0372](https://rustsec.org/advisories/RUSTSEC-2026-0372.html)，不再维护 | 仅 Linux x64 目标选中；保留维护风险和后续替换任务 |

### 4. 跨目标维护状态：继续跟踪

`unic-char-range`、`unic-common`、`unic-char-property`、`unic-ucd-version`、`unic-ucd-ident`
的 0.9.0 均在四种已核对的 Desktop 目标图出现。RustSec
[0075](https://rustsec.org/advisories/RUSTSEC-2025-0075.html)、
[0080](https://rustsec.org/advisories/RUSTSEC-2025-0080.html)、
[0081](https://rustsec.org/advisories/RUSTSEC-2025-0081.html)、
[0098](https://rustsec.org/advisories/RUSTSEC-2025-0098.html)、
[0100](https://rustsec.org/advisories/RUSTSEC-2025-0100.html) 是不再维护通知。
它们不能被归成“只影响 Linux”，也不能仅凭维护通知断言存在可利用的会话解密漏洞。
保留上游迁移与替换任务，后续新安全公告仍须重新评估。

## 重复检查与限制

```sh
npm audit --registry=https://registry.npmjs.org
npm audit --prefix desktop --registry=https://registry.npmjs.org
python3 scripts/audit-osv.py
cargo tree --manifest-path desktop/src-tauri/Cargo.toml --locked --target aarch64-apple-darwin -i rustls-webpki
```

OSV 查询只发送公开包名、生态和锁定版本，不发送源码或运行时内容。
2026-10-22 查询 672 个去重 Cargo/hosted Pub 版本，当时 11 个 Cargo 包命中，
hosted Pub 未命中；维护状态通知包含在该计数内。最新计数见本页顶部。
结果保留输入锁哈希；查询错误不是零命中，不能借旧报告通过。
`cargo tree` 是目标依赖图证据，不是最终链接二进制或漏洞利用证明。
Flutter SDK、Pods/Gradle 下载的原生预编译库、设备侧信道与整应用协议不在该查询覆盖内。
会话保密结论、Web 代码分发和专业独立审计的未完成状态见
[密码学安全审查](crypto-security-review.md)。

此前 2026-10-15 的 Nodemailer、Next/ESLint、Mermaid、DOMPurify/KaTeX、Rust TLS 等修复仍保留；
本次结果取代此前“Cargo 仅 7 包命中”等历史计数。依赖及许可哈希见
[dependency-licenses.json](dependency-licenses.json)。
