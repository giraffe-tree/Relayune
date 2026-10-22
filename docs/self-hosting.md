# 自托管与贡献者构建

本说明依据当前源码列出配置入口和限制。Node + MongoDB 的服务端可以独立部署；
整个品牌网站、所有原生客户端、通知及更新链尚不是仅替换一个域名即可运行的完整白标产品。
本轮没有部署生产服务、运行原生应用、发送真实邮件或推送；已完成隔离环境中的双实例 HTTPS 集成，
没有完成三端真实设备的端到端自托管验收。

源码现已支持无 SMTP 的本地用户名密码、部署机器首次初始化、客户端运行时实例切换。
自托管使用独立数据库和自己的 VPN／公网入口；安装准备工具可生成 IP 证书，用户不必事先准备域名、
SMTP 或证书。证书信任仍需明确确认，不能忽略验证。当前验证包含隔离 MongoDB、真实 HTTP/TLS/WSS
与客户端 fixture；原生应用安装、系统证书信任和真实设备旅程尚未验收。
任务与范围见[开源与首轮发行计划](open-source-roadmap.md)。

## 用户名模式：首次准备

需要 Node.js >=22.13、OpenSSL、Nginx 和只监听 loopback 的 MongoDB。
下面采用 Linux 的 `/opt/relayune` 源码目录与 `/etc/relayune` 私有配置目录作为示例。
命令由部署者在自己的机器执行；准备工具不安装系统软件、不启动服务、不改系统信任库。

1. 安装锁定依赖并构建：`npm ci`、`npm ci --prefix desktop`、`npm run build:self-hosted`。
   自托管构建不再校验官方下载安装包；官方站点维护者另行运行 `npm run verify:official-downloads`。
2. 选择手机和电脑都能访问的 VPN 或公网 HTTPS 地址，例如 `https://100.64.0.10`。
   运行以下准备命令，目标目录必须不存在且位于仓库外，其父级必须由 root 持有并防止其他用户写入：

   ```bash
   sudo node scripts/prepare-self-hosted.mjs --directory /etc/relayune --project-root /opt/relayune --origin https://100.64.0.10
   ```

   工具生成 `instance.env`、独立随机数据库密码、可选 HTTP 初始化令牌、实例 CA、IP/DNS SAN
   服务端证书、Nginx 配置与操作说明；不生成管理员密码。私钥和令牌不会打印。
   输出的 CA SHA-256 是公开的证书核对信息。该工具拒绝覆盖已有目录，不应用来升级或重置实例。
3. 为这个实例创建 MongoDB 最小权限账户：

   ```bash
   sudo node dist/self-hosted-server/local-account.cjs provision-database
   ```

   此命令仅连接配置中的 `127.0.0.1` MongoDB，为指定库创建 `readWrite` 用户；拒绝覆盖已有账户。
   新建的隔离 MongoDB 可使用本机管理权限；已有认证的 MongoDB 则通过
   `RELAY_MONGO_ADMIN_USER`、`RELAY_MONGO_ADMIN_PASSWORD_FILE` 指定自己的管理员和受限密码文件。
   管理员只用于这一显式配置命令，不作为 API 运行账户。自定义配置路径使用 `--config /absolute/instance.env`。
4. 在部署机器的交互终端初始化唯一管理员：

   ```bash
   sudo node dist/self-hosted-server/local-account.cjs initialize
   ```

   默认用户名为 `admin`，可以修改；密码由本人输入并确认，12–128 个字符，输入不回显。
   不提供通用默认密码，也不接受命令行参数中的密码。并发初始化只有一个成功，重复启动不覆盖账户。
   默认不开放自助注册；官方邮箱模式的自由注册策略与此独立。
5. 配置独立服务用户 `relayune` 和可写 `/var/lib/relayune/blobs`。使用
   [自托管 systemd 示例](../deploy/relayune-self-hosted.service)，核对 Node 和源码路径。
   `instance.env`、`mongo-password`、需要时的 `setup-token` 保持 root 所有、服务组可读的 `0640`；
   配置目录设为 root:relayune `0750`，让服务组能够遍历。`tls/ca-key.pem` 始终保持 root-only `0600`，
   不把 CA 私钥交给 API 服务用户。若只用本机 CLI 初始化，可从环境中移除 `RELAY_SETUP_TOKEN_FILE`，关闭 HTTP 初始化。
6. 将生成的 `nginx.conf` 安装到自己的 Nginx 站点配置并检查后启用，API 仍只监听 `127.0.0.1:3192`。
   Nginx 负责 TLS、同源 Web、WSS 和长轮询，MongoDB 与 blob 不公开。配置覆盖来自用户的转发 IP 头，
   访问日志关闭；官方更新和下载路径不作为此实例的分发渠道。

## 客户端连接与证书

公开受信 HTTPS 入口可直接使用；使用自动生成的私有 CA 时，需要部署者把**仅公开的**
`tls/ca.pem` 和证书 SHA-256 通过可信渠道交给用户。不要发送私钥、数据库密码、环境文件或初始化令牌。

- **macOS / 浏览器**：核对指纹后，由用户明确把实例 CA 加入相应系统／浏览器信任库。
  Desktop 原生 HTTP 与 Node sidecar 使用系统受信 CA；sidecar 的打包运行时支持 `NODE_USE_SYSTEM_CA=1`。
  本轮没有修改任何系统证书设置，原生包的完整信任链仍需实机验证。
- **Android / iOS**：在登录页或设置中选择自建服务、输入 HTTPS 地址。私有 CA 可在高级连接设置中
  粘贴单张公开 PEM 证书，并核对其显示的 SHA-256。证书只用于选定实例的 HTTP/WSS 连接；
  不全局接受无效证书，仍验证证书签名、有效期与主机名。iOS 使用 DER 导入路径，仍需真实设备验收。
- **Web**：打开自建实例自己的地址，不在官方网页里替换 API 地址。浏览器凭据和 IndexedDB 密钥按源隔离；
  页面拒绝向其他源发送认证请求，也拒绝远程明文 HTTP。loopback HTTP 仅供隔离本地测试。

切换实例需要确认：Desktop 停止 Relay、清除旧 vault 和临时投递／附件状态并创建新设备身份；
Mobile 关闭实时链路、清理旧实例账户／配对／缓存并阻止旧异步操作重新写入凭据。
新实例必须重新登录和配对，相同用户名不代表相同账户。连接检查不带旧 Cookie 或令牌，也不跟随重定向。
账户归属使用不可变 `acct_…` ID，用户名不被表示为已验证邮箱；旧 Mongo 适配列名中的 `email`
可能保存内部账户 ID，仅为兼容存储，不是用户邮箱。

## 恢复、升级与数据位置

- **忘记密码**：部署机器交互运行 `sudo node dist/self-hosted-server/local-account.cjs reset-password`。
  恢复立即使旧账户会话失效；重启实例服务以排空已有连接。既有客户端配对按原有授权模型单独管理。
- **升级**：先备份数据库、私有 blob、受限配置与 TLS 材料；验证新源码后重建并重启，复核健康、登录、
  两客户端独立配对及撤销。不要重跑首次准备工具、清空数据库或重新生成 CA 来完成普通升级。
- **备份与恢复**：使用 MongoDB 官方备份工具的交互密码或受限外部凭据文件，不把密码放进命令行。
  数据库、加密 blob、配置和证书应配套备份到加密的仓库外存储；恢复先在隔离环境验证，再让客户端连接。
  备份、恢复和现有安装升级尚未在本轮对真实部署执行。
- **证书更新**：生成的叶证书有效一年，CA 有效十年。到期前用原受保护 CA 签发匹配地址的新证书；
  地址、CA 或密钥变化必须核实并重新配置客户端。当前不提供静默证书轮换或自动忽略过期的回退。
- **反馈、社区与监控**：反馈提交到所选实例。社区和公开说明使用实例自己的地址，未配置内容应显示不可用。
  自托管客户端停止自动访问官方推送和更新服务；官方签名应用的主动更新检查仍独立使用官方受信渠道。
  通过 `MONITOR_ADMIN_USERNAME=admin` 显式授权本实例监控，未配置仍拒绝所有账户。
  不配置 SLS 时只展示真实数据库／进程状态，并明确日志数据源不可用，不填充模拟日志或请求数。

## 官方邮箱模式：现有部署

先阅读[架构与安全约束](security-and-architecture.md)和
[Server 运行说明](server-production.md)。需要 Node.js >=22.13.0、只监听本机的
MongoDB、HTTPS 反向代理，以及自己的发信服务。服务端不需要作者的 Apple、OSS、
SLS 或更新签名凭据；不要把这些功能的缺失改成跳过鉴权、PAKE、TLS 或签名校验。

1. 安装与构建源码：`npm ci`、`npm --prefix desktop ci`，然后 `npm run build:self-hosted`。
   根 TypeScript 检查包含 Desktop 源码，因此服务端构建也需要 Desktop 依赖。静态产物为
   `dist/self-hosted/`，API 为 `dist/self-hosted-server/server.cjs`。
2. 以 [.env.mongo.example](../.env.mongo.example) 为模板，在仓库外创建服务环境文件。
   显式设置 `RELAY_AUTH_MODE=email`，移除用户名模式的 `RELAY_SETUP_TOKEN_FILE`；
   设置自己的 `PUBLIC_ORIGIN=https://relay.example.com`、`MAIL_FROM`、MongoDB 数据库
   与独立最小权限用户。保持 `HOST=127.0.0.1`、`MONGO_HOST=127.0.0.1`。
   数据库与 SMTP 密码通过 `MONGO_PASSWORD_FILE`、`SMTP_PASSWORD_FILE` 注入。
   `SMTP_USER_FILE` 也可指定用户名文件。root-only 文件用 0600，服务组需读取时用
   root 所有的 0640，禁止提交环境文件和密码文件。
3. `RELAY_BLOB_DIR` 指向服务用户可写的私有目录，不能放入 Nginx 静态根目录。
   Node 使用配置自己的进程管理器或适配后的 systemd unit 启动；环境文件需由进程管理器
   注入，`npm start` 不会自动读取 `.env.mongo.example`。`deploy/agent-relay.service`
   中的用户、目录和 Node 绝对路径是官方环境示例，须改为自己的实际路径。
4. 以 [Nginx 配置](../deploy/relayune.giraffetree.cn.conf)为参考修改域名、证书和静态根目录。
   代理 `/api/`、`/health` 到 `127.0.0.1:3192`，并保留 `/api/realtime`、`/api/stream`
   的 WSS upgrade、关闭代理缓冲及长轮询超时。Nginx access log 保持关闭，使用 API 的
   脱敏路由日志；不要记录查询参数、邮件链接、Cookie 或 Authorization。
5. 使用自己的测试邮箱完成邮箱验证、设置密码、登录、PAKE、撤销与加密附件往返，
   并检查 MongoDB、blob 与日志不含会话业务明文。`GET /health` 仅证明服务与 MongoDB
   可达，不能替代这些验收。

SMTP 必须使用隐式 TLS（`SMTP_SECURE=true`）或强制 STARTTLS（`SMTP_REQUIRE_TLS=true`）；
两者均为 false 时启动前拒绝配置，证书校验始终启用。
SMTP 配置存在时替代 sendmail；服务启动会验证配置的 SMTP，未配置 SMTP 时需要自己
准备能正常投递的 `SENDMAIL_PATH`。`PUBLIC_ORIGIN` 必须是 HTTPS，当前邮件实现不提供
HTTP 开发例外。独立测试应使用自己的隔离 HTTPS 域名及邮件设施。

## 客户端配置入口

| 组件 | 当前支持的入口 | 限制与注意事项 |
| --- | --- | --- |
| Web 会话 API | 默认浏览器同源 `/api/`，构建时也可设置 `NEXT_PUBLIC_RELAY_API_URL` | 本文采用同源 Nginx 路由，不把可设 base URL 等同于跨域 Cookie/CORS 已验收。`NEXT_PUBLIC_RELAY_ORIGIN` 影响部分站点元数据，不能一次替换所有官网链接、下载、法律文案与 SEO 地址 |
| CLI Relay | `.env.example` 中的 `RELAY_SERVER_URL` | 设备 bearer 与每客户端密钥必须来自正常授权，不能使用固定共享密钥替代 |
| Desktop | 登录前与设置中的实例选择；底层配置 `server_url` | 使用专用切换操作清理旧授权，普通设置不能直接移植地址。远端必须 HTTPS，只有 loopback 开发地址允许 HTTP |
| Flutter | 登录页／设置的实例选择；构建参数可设初始地址 | 运行时按所选实例隔离状态与证书，社区／反馈／公开说明随实例，官方推送与自动更新对自建实例停用 |
| Desktop updater | `desktop/src-tauri/tauri.conf.json` 的 feed 与公钥 | 与 `server_url` 独立；正式版仍访问官方更新 feed。独立发行需自己的签名密钥和 feed，必须保留签名验证 |
| Android updater | `mobile/lib/src/update/android_auto_update.dart` | feed、OSS 下载 host allowlist 是源码固定值；覆盖 `RELAYUNE_ORIGIN` 不会改变它们。独立发行还需自己的生产签名及升级兼容方案 |

Desktop 官方配置目录在 macOS 为
`~/Library/Application Support/cn.giraffetree.agent-relay/config.json`，Windows 为
`%APPDATA%\cn.giraffetree.agent-relay\config.json`。贡献者的 macOS ad-hoc 包使用
`cn.giraffetree.agent-relay.development` 对应的独立目录。只修改未配对配置中的
`server_url`，保留其他字段；不要迁移正式版 vault、复制 bearer 或在已配对配置里直接
替换服务地址。新环境应创建独立配置并重新登录与配对。

没有作者 Developer ID 的 macOS 开发者使用
`npm --prefix desktop run desktop:build:macos:adhoc`，详见
[Desktop 说明](../desktop/README.md)。此包不自动打开、不注册官方 URL scheme，更新 feed
为空；更新界面可能显示不可用。默认 Developer ID 构建和正式 release 的安全规则保持不变。
官方 application ID、公钥和 Team ID 是兼容性参数，不应因公开源码而批量替换。

新建仓库尚无首次提交时，Flutter 元数据包装器目前不能读取 Git HEAD。此阶段用原生
`flutter build ... --dart-define=RELAYUNE_ORIGIN=...` 验证源码；元数据缺失的产物不是
正式发行包，也不应为了运行包装器而越过维护者的禁止提交要求。

从 GitHub 下载 source ZIP 也没有 Git HEAD。ZIP 用户可以安装锁定依赖、运行类型/lint、
原生 Flutter analyze/test/build，以及静态 Desktop 检查；原生 Flutter 构建会明确保留
未记录的提交元数据。需要完整 Git 来源和发布候选集/历史扫描时，应使用正常 clone；
不能给 ZIP 伪造提交编号，或把缺 Git 导致的扫描失败当作安全检查通过。

## 链接、邮件、通知和外部服务

| 功能 | 当前实现 | 自托管需要做的工作 |
| --- | --- | --- |
| 邮箱链接 | Server 依据 `PUBLIC_ORIGIN` 构造验证/设置密码链接 | 配置自己的域名、TLS、发信身份和 SMTP/sendmail，并真实验证投递和一次性链接 |
| Desktop 登录回跳 | Web 固定 `relayune://desktop-login-complete`，只带随机 request ID；结果由 HTTPS 轮询确认 | 与官方 App 并装的自定义包应避免争用 scheme。ad-hoc 包刻意不注册，轮询仍是结果来源；完整自定义 scheme 需要同时修改 Web 与原生解析并验收 |
| 手机配对链接 | Android HTTPS intent filter 固定官方域名；iOS/Android 接受 `relayune://pair`；原生 QR 使用 `relayune-pairing:v1:` envelope | 自己域名的 App/Universal Links 需要自己的关联文件与客户端配置；不能靠替换 API origin 自动取得系统关联 |
| Android 后台推送 | 现有 JPush 服务支持 `RELAY_JPUSH_CONFIG_FILE`，无配置时不启用。客户端有 `JPUSH_APPKEY` 等本地参数入口 | 自备 JPush/vivo 参数、服务端 masterSecret 与 32 字节 storageKey；Android package 与推送 intent 仍关联官方包名，独立包需联动适配。不要把 masterSecret 打进 APK |
| iOS 后台推送/Live Activity | `APNS_TEAM_ID`、`APNS_SANDBOX_KEY_FILE/KEY_ID`、`APNS_PRODUCTION_KEY_FILE/KEY_ID`、`APNS_TOKEN_STORAGE_KEY_FILE`；没有 APNs key 时不启用 | 自备 Apple 账户、entitlements 和私钥。当前服务构造器仍固定 `cn.giraffetree.relayune` topic，独立 bundle ID 需联动修改，不能复用作者凭据 |
| 监控/SLS | `MONITOR_ADMIN_EMAIL`；SLS 查询需同时配置 `SLS_PROJECT`、`SLS_LOGSTORE`、`SLS_REGION`、`SLS_READ_CREDENTIALS_FILE`，日志关联可另配 `REQUEST_LOG_HMAC_KEY_FILE` | 仅配置自己的管理员及服务账户；SLS 不是核心配对或密文转发前提。未设管理员时拒绝所有账户，未配日志 HMAC key 时不产生 user_ref |
| 发布与官网素材 | 已有官方版本清单、OSS 下载和社区内容链接 | 这些公开地址不是秘密，但自托管前应检查是否符合自己的服务承诺、隐私文案、品牌与素材许可；删除真实凭据不等于完成独立发行 |

推送服务端只应向供应商发送受约束的通用通知、opaque receipt 或认证密文，不得新增会话
正文、配对码或内容密钥。配置可加载不代表目标手机已完成推送验收；需要在自己的签名、
包名、域名和供应商账户组合下检查前台、后台、系统终止、撤销授权和通知点击。

## 本轮验证边界

新增 macOS 开发入口只运行了构建计划检查；默认签名路径使用现有源码回归验证。
没有执行 codesign、公证、原生打包或 App 启动，尚未证明最终开发包的 Info.plist 合并、
操作系统权限、菜单栏、vault、登录和 Relay 进程行为。Windows 原生构建与安装测试也未
在本轮执行。独立自托管的完整链路、外部服务投递及白标发行仍需按上述边界单独验收。
