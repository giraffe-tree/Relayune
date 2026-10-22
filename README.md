# Relayune

简体中文 | [English](README.en.md)

Relayune 让你从浏览器、iPhone、iPad 或 Android 手机继续操作 macOS / Windows
电脑上的 AI 编程任务。Agent 在电脑上运行；Web 和移动端用于查看会话、发送消息和处理审批。
现有接入包括 Codex、Kimi Code、Claude Code，具体适配与平台范围见各端文档。

项目采用自托管 **Node.js + MongoDB** 服务端，并提供 **Tauri Desktop** 和 **Flutter Mobile** 客户端。

首轮发行面向中国 Codex 用户，重点验收 macOS、Android、iOS，以及 Codex、Claude Code、
Kimi Code 的使用流程；Windows 源码保留，但不在首轮安装包发行范围内。
官方服务与自托管并行提供。自托管初始化与客户端实例设置已在源码中实现，首轮三端联合发行仍在准备中；
具体已实现能力、待办和验收条件见[开源与首轮发行计划](docs/open-source-roadmap.md)。

> 自有源码和项目素材采用 [MIT License](LICENSE)，允许依许可使用、修改和商业分发，
> 使用或分发时须保留版权和许可声明；软件按原样提供，不作担保。
> 第三方组件继续适用各自许可，见 [第三方声明](THIRD_PARTY_NOTICES.md)和[许可说明](docs/licensing.md)。

## 普通用户如何使用

使用流程是：**电脑安装 Relayune → 登录并准备好 Agent → 连接手机或浏览器 → 继续任务**。
以下面向使用现成客户端的用户；从源码运行和自行部署分别见后面的“开发环境”和“自托管”。

### 1. 下载安装

打开 [Relayune 官网](https://relayune.giraffetree.cn)，从下载区选择对应平台：

| 设备 | 使用方式 |
| --- | --- |
| Mac（macOS 13+） | 下载 macOS 安装包，打开 DMG，将 Relayune 放入“应用程序”后打开。 |
| Android 手机 | 从官网下载 APK，按系统提示安装。若系统询问安装来源，仅为这次使用的可信下载来源授权。 |
| iPhone / iPad | 可在 Safari 打开官网使用 Web 版；原生测试版可查看官网的 TestFlight 入口，可用状态以 TestFlight 页面为准。 |
| 其他电脑上的浏览器 | 打开官网，登录后连接运行 Relayune 的那台电脑。 |
| Windows 电脑 | 当前仓库已有 Desktop 源码，尚未提供公开安装包；源码构建见 [Windows 开发说明](docs/windows-desktop-development.md)。 |

手机端用于远程操作，运行 Agent 的电脑也需要安装并运行 Relayune。
使用自建服务时，电脑与手机应使用同一个服务地址，配置方式见[自托管说明](docs/self-hosting.md)。

### 2. 在电脑上登录并准备 Agent

1. 在 Mac 上打开 Relayune，点击 **“登录 Relayune”**。
2. 在自动打开的网页中输入邮箱。已有密码可直接登录；首次使用先打开验证邮件中的链接，
   按提示设置密码，再确认登录这台电脑。
3. 回到 Relayune，根据需要允许访问任务所在的文件夹。若项目在“文稿”中，按提示授予对应权限。
4. 查看 **“Agent”** 区域，至少准备一个可用的 Codex、Kimi Code 或 Claude Code。
   若显示未安装或未登录，使用界面中的 **“安装”**、**“去登录”** 操作，完成后重新检查状态。
   Relayune 的邮箱账户用于连接设备；Agent 使用各自的账户和模型访问权限。
5. 需要时在设置中选择 **“默认 Agent”** 和 **“默认工作目录”**。工作目录是这台电脑上的项目文件夹。

Windows 源码构建版的首次连接流程有所不同：点击“连接这台电脑”，按界面提示在客户端登录邮箱，
使用 8 位码同时完成这台电脑与首个客户端的连接；后续客户端按下面的步骤逐个添加。

### 3. 连接手机或浏览器

1. 在电脑端点击 **“连接新客户端”**，保持显示二维码和 8 位码的窗口打开。
2. 选择一种连接方式：
   - **手机 App**：打开 Relayune，使用同一邮箱登录，再扫描电脑上的二维码；也可以手动输入 8 位码。
   - **手机或电脑浏览器**：打开官网并使用同一邮箱登录，按提示输入电脑显示的 8 位码。
     电脑端也提供“在浏览器中登录并连接”和复制连接链接的入口。
3. 按界面提示等待连接完成。手机或浏览器中看到电脑已连接并进入工作台后，即可使用。

每个浏览器和 App 都需要独立连接。新增手机、换浏览器或清除浏览器数据后，按上述步骤重新授权。
连接码失效时，在电脑端重新发起连接，使用新显示的码；不要把二维码或短码发布到公开截图中。

### 4. 查看和继续任务

- 选择在线的电脑，打开已有项目和会话，查看历史消息与最新进展。
- 首次使用没有会话，或需要新任务时，通过新建入口选择可用的 Agent 和电脑上的工作目录，再发送任务描述。
- 在输入框继续发送消息；Agent 请求命令、文件操作或其他审批时，先核对操作内容，再选择允许或拒绝。
- 需要中止当前任务时，使用会话中的停止操作。手机 App 的通知可按界面提示开启，送达情况取决于系统权限与后台状态。

任务由电脑上的 Agent 执行。使用期间请保持电脑联网、Relayune 运行且电脑未进入睡眠；
手机和电脑不必连接同一个 Wi-Fi，但都需要能访问同一个 Relayune 服务。
关闭电脑端窗口后，Relayune 仍可在菜单栏或系统托盘运行；退出应用、电脑关机或睡眠后，
客户端将无法继续执行新的本机任务，移动端可能仍能查看已缓存的部分历史。

### 5. 管理授权与排查连接

- **撤销某个手机或浏览器**：在电脑端的 **“已授权客户端”** 中找到它，选择 **“撤销授权”**。
  其他客户端的授权不受影响；被撤销的客户端需要重新连接。
- **退出电脑账户**：在电脑端选择 **“退出登录”**。再次使用时需要重新登录并连接客户端。
- **电脑离线或无法发送**：先检查电脑是否休眠、Relayune 是否仍在运行，以及所选 Agent 是否已登录且可用。
- **项目或文件不可访问**：检查电脑端默认工作目录和文件夹权限，再重新检查 Agent 状态。
  更多连接信息可在电脑端 **“帮助与诊断”** 中查看。

## 工作方式

```text
Web / Flutter Mobile ── HTTPS / WSS ── Node.js Server ── MongoDB
          │                               │
          │ 每客户端独立授权与内容密钥     └─ 私有密文 blob 目录
          │
          └──────── 加密会话通信 ─────── Desktop Relayune
                                            ├─ Codex
                                            ├─ Kimi Code
                                            └─ Claude Code
```

- Desktop 负责运行本机 Agent，并将设备凭据、客户端内容密钥保存在本机加密 vault。
- Server 负责邮箱账户、设备路由、在线状态及受限时间窗口的密文转发；不保存会话业务明文、
  配对短码或内容密钥。用户主动提交的反馈有单独的可读内容规则。
- 每个浏览器或移动客户端通过一次独立的 8 位码 PAKE 授权，可以单独撤销。
  支持的客户端也可协商 WebRTC 直连，失败时回退既有加密中转链路。

macOS 首次登录先验证邮箱账户。这一步只把 Mac 绑定到邮箱账户，不会授权承载登录的浏览器访问本机
Agent；之后用 Desktop 显示的短码独立授权客户端。
8 位码只用于登录后的客户端授权，不用于 Mac 账户登录。连接码不上传。
Windows 首次连接仍通过短码 PAKE 同时创建设备与首个客户端授权，详见 Desktop 文档。
协议、存储和元数据边界见[架构与安全约束](docs/security-and-architecture.md)
及[端到端加密威胁模型](docs/e2ee-threat-model.md)。

## 开发环境

需要 Node.js **>=22.13.0**。Desktop 还需要 Rust、Tauri 对应平台工具链；Mobile 需要 Flutter，
具体版本和系统依赖见 [Desktop](desktop/README.md)与 [Mobile](mobile/README.md) 文档。

```bash
npm ci
npm ci --prefix desktop
npm run dev
```

`npm run dev` 只启动 Web 前端，API 需要另外配置 Node.js + MongoDB 服务。
根 TypeScript 配置包含 Desktop 源码，因此 Web/Server 构建也需要安装 Desktop 依赖。
本地调试请使用隔离状态和合成数据，不使用真实用户凭据。

### Desktop

macOS 贡献者可以构建隔离的 ad-hoc 开发包：

```bash
npm --prefix desktop run desktop:build:macos:adhoc
```

该入口使用独立的开发应用身份和存储目录，不要求维护者的 Developer ID。
服务地址配置、URL scheme、更新和当前验收边界见 [Desktop 开发说明](desktop/README.md)。

Windows 开发：

```bash
npm run desktop:dev
```

先按 [Windows Desktop 开发与验收](docs/windows-desktop-development.md)准备原生构建环境。
Desktop 会启动 Relay，并从配置与加密 vault 注入授权；单独运行 `relay:mac` 不会读取 Desktop vault，
不要为手工启动把令牌或内容密钥导出为明文文件。

### Mobile

```bash
npm run mobile:install
npm run mobile:check
```

平台配置、Deep Link、调试和构建入口见 [Mobile 开发说明](mobile/README.md)。

## 自托管

用户名模式不需要 SMTP：部署者在服务器本机首次设置管理员密码，客户端通过“服务实例”选择自建地址。
准备工具可以为 VPN／公网 IP 生成证书与配置，无需事先准备域名和证书；客户端仍须核对并信任实例证书，
不会忽略 TLS 验证。详见[首次准备与客户端连接](docs/self-hosting.md)。
官方邮箱模式保留，需单独的邮件投递配置；两种模式使用独立数据库。
以 [.env.mongo.example](.env.mongo.example) 为模板配置独立环境，然后构建：

```bash
npm run build:self-hosted
```

生成物：

- `dist/self-hosted/`：供 Nginx 提供的静态 Web。
- `dist/self-hosted-server/server.cjs`：Node.js API，使用 `npm start` 启动。

API 默认只监听 `127.0.0.1:3192`，MongoDB 只监听 `127.0.0.1:27017`。
环境变量须由进程管理器注入；`npm start` 不会自动读取环境模板。
数据库密码以及邮箱模式的 SMTP 密码通过仓库外的受限文件加载，密文 blob 目录不得暴露为静态目录。
完整步骤见 [Server 运行说明](docs/server-production.md)和[自托管配置](docs/self-hosting.md)。

Desktop、Mobile 可在运行时选择实例，切换时清理旧授权并重新登录配对。Web 应打开自建实例自己的地址。
官方更新渠道与业务实例分开；自托管停止自动访问官方推送和更新服务，独立发行的签名、Deep Link 与更新仍需自己的配置。
仓库中的官方域名、应用标识、下载链接和更新公钥是公开配置；自建服务应核对并设置自己的渠道，
不要复用维护者的凭据或签名私钥。

## 校验与安全

```bash
npm run typecheck
npm run lint
npm test
npm run desktop:check
npm run desktop:test
npm run mobile:check
```

根 Node fixture 全量测试以 macOS/Linux 或 WSL 为准，部分 fixture 使用 POSIX shell。
Windows 原生检查入口见平台文档。自动测试、成功构建和秘密扫描只证明实际覆盖的范围；
真实设备、独立部署、推送投递和密码学审计的未验证范围见
[公开前检查清单](docs/publication-checklist.md)及[依赖安全审查](docs/dependency-security.md)。

公开前可以检查实际 Git 候选文件及暂存区内容：

```bash
node scripts/install-gitleaks.mjs
GITLEAKS_BIN="$PWD/.public-prep/tools/gitleaks" npm run audit:publication -- --secrets
```

扫描器安装脚本仅下载并校验固定版本工具；平台支持范围见[公开校验说明](docs/github-publication.md)。
不要把整个工作目录打包上传：真实环境文件、API key、密码、签名私钥、数据库、日志和本机 Agent
历史必须保留在仓库外或被忽略的本地目录。对外公开只使用经过检查的候选集。
`NEXT_PUBLIC_*`、`VITE_*` 和移动端编译参数可进入客户端，不能用于保存服务端秘密。

## 文档与贡献

- [文档索引](docs/README.md)：架构、开发、测试与维护文档。
- [开源与首轮发行计划](docs/open-source-roadmap.md)：已确定范围、改造任务和真实设备验收。
- [贡献指南](CONTRIBUTING.md)：修改范围、验证方式与贡献许可。
- [安全报告](SECURITY.md)：私密报告漏洞或误泄露凭据。
- [品牌与资源生成](docs/brand-system.md)：项目图标、平台资源和生成入口。

请使用合成数据提交问题复现和截图；发现凭据或用户数据时通过私密渠道报告。
常规问题和功能建议通过 [GitHub Issues](https://github.com/giraffe-tree/Relayune/issues) 提交。
项目采用尽力维护，不承诺固定响应时间；客户端协议暂不承诺对第三方实现保持兼容。
