# Relayune 多端生产发布经验

公开副本中的主机地址 `192.0.2.10`、账户目录和命令路径均为配置示例；实际生产主机、凭据入口、发布与验收记录留在私有维护仓库。维护者专用发布 skill 不随本源码提供，执行前须替换成自己的工具、域名和配置。

本文记录 Relayune 正式发布中可复用的操作边界和故障经验。它是发布流程的规范，不是某次
发布的流水账。仅在用户明确要求对应平台发版、部署或公证时启用；日常开发遵循根目录
`AGENTS.md`，架构与加密约束见 [架构与安全约束](security-and-architecture.md)。

## 1. 先固定发布输入

- 区分候选构建与正式发布。候选构建只编译和测试，不公证、不上传、不更新公开清单，
  也不切换生产服务。
- 全端发布统一取当前最高已发布版本的下一个补丁版本，iOS / Android 构建号也同步递增。先核对所有 immutable 目标及 Apple build number；若有冲突，在上传前统一调整，不能只顺延某一端。源版本、官网产物信息和公开清单须保持一致。
- 先确定版本号、移动端构建号、发布说明和目标平台，再开始正式构建。每个正式产物都必须
  能追溯到一个已提交、可复现的源提交。
- `publishedAt` 使用实际 UTC 时间并核对不晚于当前时间，不能把北京时间日期直接写成
  当天 `00:00Z`。未来时间会使已经上线的版本暂时不出现在发布记录 API 中。
- 不从包含无关用户改动的 dirty worktree 发布。需要保留现场改动时，从目标提交创建隔离
  worktree；版本、锁文件、签名配置或相关源码变化后，旧门禁和旧产物立即失效。
- 保留 npm、Flutter、CocoaPods、Gradle、Cargo 和 Tauri 缓存。只有证据指向缓存故障时
  才清理，不把 `flutter clean`、`cargo clean` 或删除 DerivedData、Pods、Gradle 缓存
  当作常规步骤。
- 完成的源码和公开清单改动必须提交 Git。提交不等于推送；只有用户明确要求时才推送远端。

## 2. 多 Agent 与并行边界

- 由一个协调者统一修改版本配置和 `release-notes/<version>.json`，提交后再分配各平台
  产物，避免多个 Agent 重复加版本或覆盖清单。
- macOS 构建、服务器只读预检和一个移动平台构建可以并行；Apple processing、公证等待、
  OSS 验证也可以与不共享构建目录的步骤并行。
- iOS 与 Android 默认共享 `mobile/build`，因此必须串行。只有各自在隔离 worktree 和
  隔离构建目录中运行时才能并行。
- Agent 按产物划分所有权，不同时编辑版本文件、发布说明、公开更新清单或同一构建目录。
  最终由协调者核对提交、版本、哈希和公网指针的一致性。

## 3. 平台发布顺序

### iOS / TestFlight

1. 对目标提交只运行一次 `npm run mobile:check`。
2. 使用 `release-apple-apps` 生成导出配置并直接构建正式 IPA；不要先进行一次等价的无签名
   完整构建。
3. 每次上传使用 App Store Connect 尚未使用的 build number。已明确授权上传时直接运行
   上传入口，因为它会再次执行 preflight 和最终 IPA 验证，不要紧邻重复运行等价 verify。
4. Apple 接受上传后只能记录为 `uploaded-processing`；processing 完成、测试员可用、送审和
   公开发布是不同状态，不得混称“已发布”。用户明确要求跳过 TestFlight 可用性和加密合规核验时，
   记录为“按用户要求跳过”，不再以这两项阻塞上传收尾和官网构建信息更新；保持真实
   上传/二进制处理证据，不自动填写合规声明或把未核验状态写成已验证。
5. 浏览器或 Xcode 未登录时，先只检查既有上传凭据是否存在，并用 Apple CLI 的只读查询验证
   team/provider 和精确 bundle 的 App 记录。没有 API key 不等于没有上传通道；已认证的
   `altool --upload-package --wait` 可上传已严格验证的三 Bundle IPA，避免重新导出和构建。
   密码只通过子进程环境引用，不写入参数、输出或仓库。`VALID_BINARY` 表明二进制处理完成，
   仍需在 App Store Connect 核对合规和测试可用状态；不自行推断加密声明，不重复上传同一 build。

### Android 直装包

1. 默认只构建生产签名 APK；只有用户明确要求 Google Play 时才额外构建 AAB。
2. 使用 `manage-android-signing-keys` 临时注入已登记生产密钥，禁止 debug fallback，
   且不得把密码或私钥路径写入仓库、日志或产物元数据。
3. 运行 `prepare-android-update-manifest.mjs --production` 核对包名、版本、现代签名方案、
   生产证书、大小和 SHA-256。生成器已覆盖的检查不要手工重复，除非正在诊断失败。
4. 先上传版本化 APK 并完成匿名下载验证，再提交 `public/updates/android.json`，最后构建和
   部署 Web；不得让公开清单提前指向不存在或未经验证的对象。

### macOS 直发

1. 正式直发只运行一次 `npm run desktop:release`。不要先运行 `desktop:build` 再完整重建，
   也不要在流水线外重复执行 lipo、签名或公证。
2. 最终 `.app` 必须通过 Developer ID、hardened runtime、Universal 架构、签名验证、
   notarization、staple 和 Gatekeeper；必须从最终签名包内分别以 arm64 和 x86_64 启动
   sidecar，并确认进入 Relayune 业务入口。
3. 上传版本化 DMG 和 updater 压缩包并验证后，才更新 `public/updates/latest.json`。公证完成
   记录 `notarized`，公网分发验收完成后再用 `release-apple-apps` 记录 `public`。
4. 本地启动验收应先优雅退出旧调试版，再按最终签名 `.app` 的完整路径启动。多个 Relayune
   包共享 bundle identifier，不能只用 bundle id 判断启动的是哪一个；同时核对界面版本、
   连接状态以及主进程和 sidecar 的实际路径。
5. `notarytool` 在取得 submission ID 后仍可能上传失败。只有明确出现成功上传的证据，才进入
   公证等待；不要反复等待一个未完成上传的 ID。若证据是 S3 加速连接超时，保留同一个 DMG，
   以 `--no-s3-acceleration` 重试上传，不重新签名、打包或构建；新请求 Accepted 后继续 staple
   和原有产物准备流程，分别记录未完成与成功的请求 ID。

## 4. OSS 分发

- 使用 `manage-aliyun-oss-public-assets`，正式对象固定写入
  `open-chen/apps/relayune/<version>/`，版本化对象不可覆盖。
- DMG、updater、APK 等大文件不得由生产 Web 服务器分发；官网和公开清单只能指向已经验证
  的 OSS HTTPS 地址。
- 上传后核对匿名 HTTPS、Content-Length、SHA-256 元数据和
  `Cache-Control: public, max-age=31536000, immutable`。
- 每个 immutable 对象只进行一次公网完整下载和本地哈希比对；成功后不重复消耗带宽，后续
  验收使用 HEAD、对象元数据和公开清单。
- 自定义 CNAME 只有在 TLS 主机名校验通过后才能使用。若证书不匹配，继续使用已验证的
  `open-chen.oss-cn-hangzhou.aliyuncs.com`，不能绕过 TLS 校验。

## 5. Web 与 API 部署

1. 所有平台公开清单提交后，再从干净提交运行本文第 9 节规定的完整门禁和
   `npm run build:self-hosted`。确认产物只包含 `dist/self-hosted/` 和
   `dist/self-hosted-server/` 所需内容。
2. 按自己的服务器管理流程预检示例主机 `192.0.2.10` 的 SSH、磁盘、证书、
   Nginx、端口、systemd、目录、MongoDB 和 DNS。主机登录必须使用
   `/home/developer/.ssh/id_ed25519`、`IdentitiesOnly=yes` 和自己的维护账户，
   不依赖默认 SSH identity。
3. 静态与 API 上传到同名时间戳 release 目录，设置最小权限，并保留上一份健康 release。
   上传后先比对 `index.html`、公开清单、`server.cjs` 和发布说明 CLI 的哈希。
4. 在未占用的 loopback 端口（例如 `127.0.0.1:3193`，使用前必须重新确认）以
   `agent-relay` 用户、生产 env 文件和新 API bundle 启动候选服务。CentOS 7 的旧 systemd 不支持部分现代
   transient `WorkingDirectory=` 属性；候选验证应在 release 目录直接启动 Node，不要临时
   改写正式 service。
5. 候选 `/health` 必须返回 `ok=true` 和 `server_blind=true`。服务启动后的短暂
   `connection refused` 是轮询中的预期状态，不能让首个失败请求立即触发回滚。
6. 候选健康后原子切换 Web 和 API 的 `current` 软链接，运行 `nginx -t`，只重启
   `agent-relay.service`，等待 `127.0.0.1:3192/health` 恢复，再通过
   `curl --resolve relayune.giraffetree.cn:443:127.0.0.1` 验证 HTTPS 源站。
7. 健康检查脚本不要在多层 SSH 单引号中手写 JSON 字面量匹配；引号可能被本地 shell 改写。
   使用可靠 JSON 解析，或匹配无需嵌套引号的固定字段，并把“服务未就绪”和“内容错误”分开。
8. 切换成功后，以现有最小权限 MongoDB 账户运行打包后的
   `publish-release-notes.cjs`，再验证中英文公开发布记录。

## 6. 公网验收

- 用 AliDNS DoH 和 Google DoH 确认 `relayune.giraffetree.cn` 指向 `192.0.2.10`，不使用
  可能受本机 Fake-IP 影响的普通 DNS 结果作为唯一证据。
- 验证 HTTP 到 HTTPS 的 301、HTTPS 首页、中文页、英文页、深层 SPA 刷新和 `/health`。
- 对比公网 `index.html`、`updates/latest.json`、`updates/android.json` 与本地产物的版本、
  URL 和哈希；可变清单必须返回 `Cache-Control: no-store`。
- 验证中英文首页包含正确下载地址，发布记录 API 和 changelog 包含本次平台，并检查服务、
  Nginx 日志没有持续错误。
- 生产入口固定为 `https://relayune.giraffetree.cn`；应用内链接、更新元数据和验收均使用该域名。

## 7. 回滚与数据边界

- 在切换前记录上一份 Web/API `current`。健康检查失败时同时恢复两个指针，然后只重启
  Relayune 服务；健康轮询必须允许合理启动时间。
- 常规代码回滚不得删除 MongoDB、持久化 blob、本机 vault 或任何用户数据。
- 只清理本次发布精确创建且确认未使用的临时文件或 release，不改动其他服务、Nginx、
  防火墙、证书、端口、域名和 DNS 记录。
- 周期性 Android 构建是候选健康检查，不是自动发版器；`npm run mobile:periodic:prepare`
  生成的候选不得上传 OSS、更新公开清单或切换生产 `current`。

## 8. 完成标准

只有以下条件同时满足，才能把正式发布报告为完成：

- 源码与公开清单已提交，所有正式产物可追溯到精确提交；
- 各平台签名、版本、大小和 SHA-256 已验证，移动端关键流程完成真机验收；
- 版本化 OSS 对象不可覆盖且完成一次公网整包哈希验证；
- Web/API 候选验证、原子切换、公网页面、清单、发布记录和日志均通过；
- macOS 本地最终签名版已启动并显示正确版本和连接状态；
- 上一份健康服务和用户数据仍可安全回滚。

## 9. Web/API 部署门禁

只在部署前执行；普通功能开发按改动范围选择检查，不默认执行全平台流程。

从仓库根目录运行：

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run desktop:check
npm run desktop:test
npm run build:self-hosted
```

构建产物必须包含：

- `dist/self-hosted/`：静态应用壳和不可变资源；
- `dist/self-hosted-server/server.cjs`：Node 22 自托管 MongoDB API。

构建产物不得包含 SQL schema、Worker bundle、D1/R2 绑定或 MariaDB 驱动。

## 10. 提速经验与下一轮执行要点

### 已验证有效的做法

- 先固定版本和源提交，再让 macOS、隔离的 iOS、隔离的 Android 与 Web 预检并行。
  优先启动耗时最长的 macOS 双架构构建；Web 的最终构建仍等待公开资产和清单就绪。
- 缓存复用必须有明确所有权：同一个 Cargo target 只允许一个构建者写入；其他工作区使用
  独立 target 或先复制缓存。复用已安装依赖的工作区不得对共享 node_modules 链接运行
  `npm ci`。iOS 与 Android 不共享可写 build 目录。
- 单个平台成功后保留产物及源提交、工具链、版本、签名身份、大小和哈希证据。另一平台失败
  或上传暂停时，不重新构建已成功的产物；恢复前确认这些输入和产物哈希仍匹配。
- 只有测试断言修正、没有业务源码或构建输入变化时，重跑受影响测试即可；保留此前通过的
  其他测试证据，并记录不同提交之间的精确差异。不能把真实功能回归改成宽松断言来放行。
- Apple 发布索引是共享 JSON，由协调者串行记录，避免各平台并发写入丢失记录。
- 同步竞争用受控时序测试。不能让真实 WebCrypto 与 5 毫秒测试计时器竞速，再把机器负载
  当成功能故障；可用测试时钟控制备用读取，并在正常响应结束后推进时钟，断言计时器已取消。
  仍保留超时、失败和备用读取的独立测试，不删除原来的行为断言。

### 把本次返工前移到预检

- **iOS 证书选择**：签名预检除验证 profile 外，还需确认实际选中的本地证书属于该 profile。
  有多张同名 Apple Distribution 证书时，按预检得到的有效指纹明确选择，不能只依赖名称。
  浏览器 App Store Connect 登录失效不等于 Xcode 上传通道失效，先检查已有认证通道。
- **干净 worktree 的 sidecar**：运行 `desktop:check` 前检查
  `desktop/src-tauri/binaries/` 的目标架构文件。可复制本轮相同源提交、相同构建配置已生成的
  sidecar；缺失时先生成，不能等 Cargo 检查失败后才补，也不能拿旧版本占位。
- **公开上传范围**：开始时在发布说明中明确平台、阶段、版本化文件名及既有公共目的地，
  在具体上传动作中携带本轮已有授权。不要默认增加确认步骤，也不能承诺规避自动审批。
  遇到拒绝时补充真实授权证据；仍拒绝则请求具体动作批准，保留产物并继续不依赖批准的工作。
- **运行验收条件**：早期检查设备和锁屏状态，让可执行的真机/界面验收与构建等待重叠。
  用户取消手机安装时不得为了验收继续安装；Mac 锁屏时的进程路径、签名和 TLS 连接证据
  不能代替界面版本、连接状态和交互验收。交付时分别说明发布状态和未完成的运行验收。

### 下一项流水线优化：只构建一次 Web（尚未实现）

目前 `npm test` 与 `npm run build:self-hosted` 都调用 `npm run build`，一次发布会重复
构建同一份 Next.js 页面。后续可拆分测试入口与自托管打包入口，让最终提交只构建一次，
测试和部署均使用这份构建。落地前必须验证测试对构建输出的依赖，并将源提交、锁文件、
构建配置和输出哈希绑定；输入变化或无法证明产物有效时重新构建。不能仅删除一个 build
命令就复用旧输出。实现并验证该优化前，第 9 节门禁保持不变。

### 用阶段证据衡量速度

0.3.18 日志中的局部耗时如下；它们不包含完整发布准备、全部预检或外部等待，不应相加
作为并行发布总时长，也不作为下一次的时间承诺：

| 阶段 | 本次观测 |
| --- | --- |
| Android assembleRelease | 172.1 秒 |
| iOS 成功归档 / IPA 导出 | 68.9 秒 / 59.1 秒 |
| macOS 两个架构的 Rust 编译 | 2 分 24 秒 / 1 分 39 秒 |
| Node 测试执行，不含 npm test 前置构建 | 485 条通过，约 4.8 秒 |

下一轮将每个阶段的开始、结束、退出码、源提交和复用依据写入本地发布证据；分别统计
主动执行、Apple/网络等待、审批等待和失败重试。优先压缩重复构建、迟发现的前置条件和
协调空档，保留签名、公证、最终产物验证、公网哈希、候选健康、切换后验收与回滚能力。
