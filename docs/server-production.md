# 自托管 MongoDB Server 运行说明

## 组件

- Nginx：提供 `dist/self-hosted/`，把 `/api/*` 与 `/health` 代理到 Node。
- Node 22 API：`dist/self-hosted-server/server.cjs`，只监听
  `127.0.0.1:3192`。
- MongoDB：只监听 `127.0.0.1:27017`，使用独立 `readWrite` 用户。
- 私有 blob：保存超过内联阈值的 A256GCM envelope，MongoDB 只存不透明路径。
- 认证：`RELAY_AUTH_MODE=username` 不使用 SMTP，本机初始化唯一实例所有者；
  `RELAY_AUTH_MODE=email` 保留邮箱验证和注册，优先认证 SMTP，未配置时可用本机 sendmail。

Server 不配置 `RELAY_E2EE_KEY`，也没有设备 bootstrap token。macOS 设备通过一次性 Web
账户登录确认创建（按部署模式使用邮箱或用户名）；这个流程不创建浏览器授权。手机和浏览器内容密钥仍只能通过登录后的
短码 PAKE 客户端授权生成。

## 配置

从 [.env.mongo.example](../.env.mongo.example) 创建 root-owned 环境文件。
默认示例是用户名模式；首次准备、IP 证书、本机设置密码和客户端连接步骤见
[自托管安装说明](self-hosting.md)。MongoDB 自身应启用认证，API 只使用本实例的最小权限账户。
密码通过 `MONGO_PASSWORD_FILE` 和可选的 `SMTP_PASSWORD_FILE` 注入，不要把
真实密码直接放进仓库或 systemd unit。

关键约束：

- `HOST=127.0.0.1`；
- `MONGO_HOST=127.0.0.1`；
- `PUBLIC_ORIGIN` 必须是最终 HTTPS origin；
- 邮箱模式注册对所有格式合法的邮箱开放；邮箱状态接口固定进入“登录或验证邮箱”流程，
  不公开账户是否已经存在；
- 用户名模式不自助注册、不发验证邮件，本机交互初始化管理员后登录使用；
- 两种模式使用独立数据库，不在旧邮箱库上直接切换；不记录试用期或付费权益到期时间；
- `RELAY_BLOB_DIR` 必须是运行用户可写、Web Server 不可读的私有目录。

API 启动时会连接 MongoDB，建立唯一索引和 TTL 索引，并验证 SMTP（若配置）。
`GET /health` 会实时执行 MongoDB ping。

## 数据边界

MongoDB 原生集合包括：

- `auth_users`：邮箱模式保存规范化邮箱；用户名模式保存不可变账户 ID、用户名和认证代次。
  两种模式保存带随机盐的 scrypt 密码摘要和更新时间，不保存
  登录密码明文；
- `auth_magic_links`、`auth_setup_sessions`、`auth_sessions`：只保存 token
  SHA-256 摘要；邮箱验证只创建 10 分钟有效的一次性密码设置会话；验证邮件按
  单邮箱和来源 IP 限流；
- `auth_login_attempts`：只保存邮箱与来源地址的 SHA-256 摘要，并通过 TTL
  清理，用于限制密码猜测；
- `auth_password_limits`：用户名模式的原子并发限流计数及过期时间，不保存原始密码；
- `relay_pake_pairings`：公开 share、确认值、状态和 10 分钟过期时间；
- `relay_desktop_logins`：随机登录请求、轮询秘密摘要、设备令牌摘要、账户确认状态和
  10 分钟过期时间；不保存原始令牌，且不创建浏览器授权；
- `relay_users`、`relay_devices`：账户关系和设备令牌摘要；
- `relay_browser_authorizations`：浏览器名称、设备/账户关系、内容密钥 `kid`、
  浏览器授权令牌摘要、最近使用时间和撤销时间，不保存原始令牌或内容密钥；
- `relay_commands`、`relay_events`、`relay_responses`、`relay_catalogs`：
  按浏览器授权编号分区的 A256GCM envelope、经过认证的路由元数据与队列状态；
- `relay_counters`：事件单调序号。

不得把请求体、Cookie、Authorization、PAKE share 或确认值写入普通日志。

## 请求日志

Node API 向 stdout 写一行一个 JSON 对象，字段沿用阿里云 SLS Web 访问日志的
`request_method`、`request_uri`、`status` 和 `request_time`。其中
`request_uri` 必须是 `routeTemplate` 生成的路由模板，不能包含查询参数、配对编号、
请求编号或其他动态标识；`schema_version=2` 的 `request_time` 单位为毫秒（最多三位小数）；旧版无 schema_version 的日志单位为秒。`level` 只取 `info`、`warn`、
`error`，可选 `error` 只能保存应用定义的稳定错误码，不得写入原始异常文本。

完整字段、日志专用密钥配置及 SLS 迁移流程见 [HTTP 日志 v2](request-log-v2.md)。

这组字段应能直接区分密码登录的 `200`、`401`、`403`、`429` 和服务端 `5xx`，同时
不记录邮箱、IP、User-Agent、Referer、请求体、响应体、Cookie、Authorization、
浏览器令牌、短码、PAKE share、确认值或业务明文。Nginx access log 继续关闭，生产排查
通过 `journalctl -u agent-relay.service` 读取上述结构化日志。

## 构建与验收

```bash
npm ci
npm ci --prefix desktop
npm run typecheck
npm run lint
npm test
npm run desktop:check
npm run desktop:test
npm run build:self-hosted
```

发布顺序：

1. 只读检查端口、Nginx、证书、systemd、目录、磁盘、MongoDB 和 DNS。
2. 上传时间戳静态/API release，设置最小权限 owner，保留上一份健康 release。
3. 以管理员身份只完成 MongoDB 用户和权限设置；运行时改用独立最小权限用户。
4. 启动非 root Node 服务，先在 loopback 验证 `/health`。
5. 通过临时 Nginx candidate 执行 `nginx -t`，再 reload。
6. 最后才修改 DNS；完成新邮箱验证并设置密码、已有邮箱密码登录、错误密码
   限流、macOS Web 登录及“登录浏览器无 Agent 权限”检查、PAKE、错误短码、设备
   bearer、密文往返、离线队列、MongoDB/blob
   无业务明文和日志检查。

常规回滚只切回静态与 API 的上一份 `current` 并重启本服务，不删除 MongoDB
或持久化 blob。
