# 依赖安全审查与剩余公告

本次准备在 2026-10-15 对锁定依赖做了官方 npm 审计，以及 Cargo/Pub 的 OSV 版本查询。
它们检测已知公告，不证明软件没有漏洞；开发依赖也可能进入浏览器构建产物，不能仅用
`npm audit --omit=dev` 的结果代表整个项目。

## 已应用的修复

- Node 邮件链升级到 Nodemailer 10.1.1，并移除不再适用的独立类型包；SMTP 仍要求 TLS
  与有效证书，显式禁止从文件或 URL 读取邮件内容。qs 更新到修复版本。
- Web 构建链升级 Next/ESLint 配套版本、PostCSS 和 sharp，以及可兼容的转依赖补丁。
- Desktop 开发链升级 Vite/Vitest 和存在公告的转依赖。Vitest 3.x 的未维护版本没有被
  用作最终修复，采用官方已修复的 4.1.11 并验证现有测试。
- 浏览器 Mermaid 升级到 11.17.2；KaTeX 0.18.2、DOMPurify 3.4.17 从实际锁定依赖
  重新打包进 Web/Flutter 两份离线 runtime。不能把 npm override 当作上游预构建 JS
  已经更新的证据；实际输入由 `public/mermaid/BUILD.json` 记录，并保留独立许可。
- Rust updater TLS 链的 rustls 0.23.43 升至 0.23.46，同时 rustls-webpki 0.103.13
  升至 0.103.15。未关闭 TLS、证书或更新签名检查。

版本、许可与校验和快照见 [dependency-licenses.json](dependency-licenses.json)。

## 尚未消除的公告

| 项目 | 证据与影响范围 | 当前处理 |
| --- | --- | --- |
| `braces` 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)；公告暂无修复版本。npm 将同一问题沿 `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` 链计为 5 项 high | 保留告警，没有降级 Next/ESLint、禁用公告或伪造“全树零漏洞”。该链用于开发 lint，生产依赖树不包含它；开发工具处理不受信任模式仍有风险。CI 不注入生产秘密并限制执行时长，但这不是漏洞修复 |
| `glib` 0.18.5 | [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html)，`VariantStrIter` 的迭代器 unsoundness，修复在 0.20；Tauri 的 Linux GTK 0.18 链仍锁定旧 API | 对 macOS arm64 / Windows x64 的实际 `cargo tree -i glib` 均为空，Linux target 则存在该链。项目当前仅承诺 macOS/Windows Desktop；未验证或认可 Linux Desktop 发行。不能强行跨不兼容 glib 主线覆盖原生依赖 |
| `proc-macro-error` 1.0.4 | [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)，上游不再维护 | 维护状态风险，不能与已证实可利用漏洞混为一谈；仍需随上游依赖迁移 |
| `unic-char-range` / `unic-common` / `unic-char-property` / `unic-ucd-version` / `unic-ucd-ident` 0.9.0 | RustSec [0075](https://rustsec.org/advisories/RUSTSEC-2025-0075.html)、[0080](https://rustsec.org/advisories/RUSTSEC-2025-0080.html)、[0081](https://rustsec.org/advisories/RUSTSEC-2025-0081.html)、[0098](https://rustsec.org/advisories/RUSTSEC-2025-0098.html)、[0100](https://rustsec.org/advisories/RUSTSEC-2025-0100.html) 均为不再维护通知 | 保留透明记录，不能把“没有修复版本”或“当前未发现调用攻击面”写成公告已清除 |

上述剩余项仍需维护者在最终公开审查中确认接受范围；本文件不代替该决定。
公开源码不会自动表示承诺零已知公告或所有平台通过生产安全验收。

## 重复审查

```sh
npm audit --registry=https://registry.npmjs.org
npm audit --prefix desktop --registry=https://registry.npmjs.org
python3 scripts/audit-osv.py
```

`audit-osv.py` 使用 Python >=3.11 标准库读取 Cargo 和三个 Pub 锁，只向 OSV 发送公开包名、
生态和版本，不发送源码、路径或运行时内容。结果保存到被 Git 忽略的
`.public-prep/osv-current.json`，含输入锁哈希；使用 `--fail-on-findings` 会在存在公告时返回失败。
默认输出是公告清单，不代表“通过”。查询失败会报错，不能使用上次报告冒充本轮成功。

源码 CI 对根与 Desktop 都运行完整 npm 审计，开发依赖不再被排除。Desktop 要求零命中；
根审查器 `scripts/check-npm-audit.mjs` 只识别上表中五个精确版本、开发节点和单一 GHSA 的
已知未解决链，并明确输出 warning 和 `riskAccepted:false`。任何新公告、运行时节点、
改变的版本/关系、审计接口错误或陈旧报告均失败。这个门禁表示“没有新增或改变的风险”，
不表示维护者已接受剩余风险，更不表示根全树零漏洞。CLI 要求本轮 npm 退出码、开始时间及
锁哈希；workflow 使用独立临时报告文件，不能借旧的空数组通过。

首次查询覆盖 672 个去重后的 Cargo/hosted Pub 版本；rustls 修复后尚有 7 个 Cargo 包命中，
其中包含上述 unsoundness 和维护状态公告，hosted Pub 没有命中已知公告。
Flutter SDK、原生预编译库、实际应用打包物、密码学侧信道和软件使用配置不在该查询覆盖内。

参考修复来源：
[Nodemailer 官方说明](https://nodemailer.com/)、
[Vitest 安全公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9)、
[RustSec TLS 公告 0285](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)、
[0346](https://rustsec.org/advisories/RUSTSEC-2026-0346.html)、
[0348](https://rustsec.org/advisories/RUSTSEC-2026-0348.html)、
[0349](https://rustsec.org/advisories/RUSTSEC-2026-0349.html)。
