# 依赖安全审查与剩余公告

更新：2026-10-27。按当前锁文件重新查询 npm 官方审计与 OSV。此前已用 `cargo tree --locked`
核对 macOS arm64/x64、Windows x64 和 Linux x64 的依赖图。公告命中、实际目标依赖、
调用条件和最终二进制是不同证据；本页不声称全项目零漏洞或已经通过密码学审计。

## 2026-10-27 修复后结果

本轮已完成兼容补丁升级。根与 Desktop 的**完整 npm 审计均零命中**，原严格审计 CLI 的
退出码、捕获时间和锁哈希验证通过，没有扩大例外。修复前根报告的 3 个命中包已经消除；
这不是全项目无漏洞或整应用密码学审计结论。

| 包与版本变化 | 本轮证据与范围 | 本轮处理 |
| --- | --- | --- |
| `next` / `eslint-config-next` 16.3.8 → 16.4.3 | 项目使用静态导出与未优化图像，不运行 Next 请求服务器；修补的是构建依赖，不能把旧锁命中直接等同线上 RCE | 升级配套版本；类型、lint、静态构建及严格来源/许可验证通过 |
| `nodemailer` 10.1.1 → 10.2.1 | 实际用于服务端邮件，旧版本存在收件地址解析公告 | 邮件/TLS/隔离 Mongo 定向回归 33 项通过；3 个真实 envelope 反例在旧版均失败、新版均通过，零网络验证未增加隐藏收件人 |
| `zod` 4.4.3 → 4.6.6 | lint 传递依赖，不是当前 Server bundle 输入 | 使用兼容精确 override，lint 和完整 npm 审计通过 |
| `tokio` 1.53.1 → 1.53.3 | macOS 实际 Tauri/reqwest/updater 链，修补 Unix I/O safety 公告 | 精确新版本 OSV 无该命中；Rust check 与 lib 183 项通过，1 项既有 packaged-sidecar 探针忽略 |

完整 Node 1,433 项、Desktop 132 项通过，Node 无跳过；自托管 Web/API 构建通过。
Next 16.4 新增的固定 Turbopack 内联数据描述采用精确 wrapper、canonical JSON、已审查本地 chunk
和整数模块编号验证；未知脚本、追加代码、路径跳转及过期证据仍拒绝，不以宽泛例外绕过产物门禁。

### 仍保留的 Rust 公告

本次 OSV 覆盖 672 个去重 Cargo/hosted Pub 版本，**12 个 Cargo 包仍命中，hosted Pub 未命中**。
Tokio 命中已消除；其余包含下文记录的平台漏洞、维护状态通知以及 `block-buffer`：

- `block-buffer@0.10.4`：当前 macOS 图经 `digest → sha2 → tauri-codegen → tauri-macros` 用于构建，
  不是会话加密运行时。已读取实际源码：此版本使用独立 `pos` 字段，没有公告描述的内嵌 cursor 或
  `ReadBuffer`；2,305 个合成 caught-panic 用例未复现该机制。OSV 宽版本命中仍保留，未添加忽略，
  不以未复现宣称整库安全。已核对的新旧 Tauri codegen 仍依赖 `sha2 ^0.10`，不能直接强制替换为
  不兼容的 block-buffer 0.12。后续跟踪准确受影响版本与上游迁移。
- `zip@4.6.1`：仅当前 Windows 更新目标使用。已核对官方 updater 2.12.0 和 2.14.0，仍使用
  zip 4 和 `ZipArchive::extract`；普通框架升级不能闭环，未作无收益升级。Windows 分发前仍须处理。
- Linux GTK/D-Bus 与跨目标 unic 的已披露项继续保留，下文按目标分类；维护通知不等于已证实可利用漏洞。

本轮只更新源码、锁文件和材料，没有发布新安装包或修改线上服务。已发布 0.3.33 产物
不自动包含本次补丁，后续正式发行必须重新构建验证。

来源：[Next 图像优化](https://github.com/advisories/GHSA-2464-fhr4-w9xw)、
[Next use cache](https://github.com/advisories/GHSA-673q-mjm6-r5xr)、
[Next Server Actions](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)、
[Nodemailer 地址解析](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8)、
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、
[Tokio](https://rustsec.org/advisories/RUSTSEC-2026-0386.html)、
[block-buffer](https://github.com/advisories/GHSA-qwgh-2vcv-g2f7)。

修复前的 2026-10-27 查询为根 npm 3 包及 Cargo 13 包命中，原门禁正确拒绝当时的根报告。
本节顶部是升级后的最新结果；不得用该历史失败记录或此前 braces 计数替代当前审计。

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
