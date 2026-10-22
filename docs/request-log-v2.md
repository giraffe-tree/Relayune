# HTTP 请求日志 v2

状态：2026-09-10 已上线生产，API 源提交 `9250be1`，迁移 SDK 适配提交 `521451a`。
生产验收见 上线记录（内部验收档案未随公开源码提供）。

每个请求 finish/提前 close 时输出一条 JSON。journal 提供事件时间 `__time__`，其余字段：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| schema_version | long | 2 |
| service | text | relayune-api |
| service_version | text | 构建时 package.json 中的应用版本 |
| event | text | http_request |
| level | text | info / warn / error |
| request_method | text | 标准 HTTP 方法或 UNKNOWN |
| request_uri | text | 路由模板或 unmatched，无动态标识和查询参数 |
| status | long | HTTP 状态，提前断开为 499 |
| request_time | double | 毫秒，单调时钟，最多三位小数 |
| error | text，可选 | 仅固定错误码；无错误时省略，未知错误按状态归一化 |
| trace_id | text | 每次请求独立的服务端随机 UUID v4 |
| user_ref | text，可选 | v1_ + HMAC-SHA256 十六进制摘要 |
| auth_type | text | anonymous / email_session / device_token / browser_token / password / email_token |
| client_type | text | web / desktop / mobile / unknown |

`user_ref` 的输入为 `relayune-log-user\0` 加 trim/lowercase 后的邮箱；邮箱仅在进程内用于
HMAC，不进入输出。登录成功后创建 session，或验证已有 session/device token 成功后才标记。
设备认证先读取已验证设备对应的账户邮箱，因此与同账户 cookie 认证得到相同 user_ref。
浏览器授权成功后将 auth_type 从 email_session 标记为 browser_token，保留账户 ref。
诊断查询失败不会让业务失败，缺失映射时省略 user_ref。认证失败不使用用户提交的邮箱推定身份。

Desktop 设备 token 标记 desktop；当前 cookie 与 browser token 同时用于 Web/手机，无法可靠
区分，故 client_type 为 unknown。不会解析或记录 User-Agent，也不信任自报客户端类型。

## 日志密钥

`REQUEST_LOG_HMAC_KEY_FILE` 指向仓库外的独立 JSON 文件：包含 `version` 和 32 字节随机密钥
的十六进制 `key`。不在环境变量值、聊天、命令参数或日志中传递密钥正文。
缺失路径时服务仍可运行但不输出 user_ref；指定了错误文件/格式时拒绝启动，错误不包含秘密。
拒绝符号链接以及组写/执行或任何其他用户权限。生产设置 root:agent-relay 0640。

在适当的私有目录生成（文件已存在时停止，不覆盖）：

```bash
node scripts/sls/log-identity.mjs create /absolute/private/request-log-key.json
```

部署时通过服务器 Node 执行同样命令，设置文件所有者/服务组及权限，再在服务的受限环境文件中
添加 `REQUEST_LOG_HMAC_KEY_FILE=/absolute/private/request-log-key.json`。
不使用 SLS AccessKey、登录密钥、设备凭据或会话加密密钥作为日志 HMAC 密钥。

排障转换用 `node scripts/sls/log-identity.mjs lookup /absolute/private/request-log-key.json`，
邮箱经标准输入提供，输出仅为 user_ref；不要把邮箱拼进 shell 参数或提交到 Git。
轮换时使用新随机 key 并递增版本；不同版本的历史日志需使用相应旧密钥查询，不保存映射表。

## SLS 安全迁移顺序

1. 先运行合成测试，确认旧版与 v2 都能通过过滤，敏感字段丢弃。
2. `migrate-v2 --project relayune --logstore relayune --use-existing-resources --dry-run`
   加 `--credentials-file` 预检。仅接受冻结的旧版定义或已经更新的 v2 定义；遇到用户修改停止。
3. 去掉 `--dry-run` 更新索引、采集配置、看板、慢接口告警。保留 120 天等存储设置与机器组绑定。
   流程支持中途失败后继续；回读一致才报告成功。告警保持当前显式目标状态，不新增接收人。
4. 确认采集器已获取新配置，再部署带日志密钥路径的 API。先更新采集链路，可避免 v2 被旧过滤器丢弃。
5. 验收实际毫秒值、已登录 user_ref 与匿名省略、错误码、SQL、日志数量对账与续传。

v2 采集器继续接受 v1，并为新采到的旧记录标记 schema_version=1；历史记录不改写。
看板和告警耗时使用：

```sql
CASE WHEN schema_version = 2 THEN request_time ELSE request_time * 1000 END
```

因此旧记录的 0.123 秒和新记录的 123 毫秒都显示为 123 毫秒；慢接口阈值从 2 秒改为 2000 毫秒。
回滚 API 时保留兼容两种格式的采集配置和查询，不直接把新字段索引退回旧版。

字段顺序仍属于线格式协议。采集器先验证完整 v1/v2 外壳，再提取与白名单规范化；
不允许额外字段、未知版本或半条 v2 外壳。以后更改格式仍必须同步更新生产者和采集测试。

## 上线前验证

- 33 项 Python 测试：v1/v2 外壳、字段提取、秒/毫秒查询、已有资源保护、迁移预检、冲突停止、
  部分失败续跑、告警状态回读和合成输出检查。
- Node 测试覆盖毫秒值、随机 trace、并发上下文隔离、HMAC 一致性、匿名身份省略、
  真正的 session/feedback 认证入口、错误码过滤、密钥权限/拒绝覆盖，以及相关 PAKE/反馈回归。
- 官方 LoongCollector 3.2.6 在 `/opt/relayune-sls-stage/v2-validation` 的隔离网络实例中
  验证原样保留 123.456 毫秒、已认证 user_ref、匿名省略 user_ref、旧版兼容和敏感字段过滤。
  此实例仅使用合成输入/本地文件输出，不读取 journal 或上传 SLS，验收后停止。
- 云端 migrate-v2 dry-run 通过，计划更新 index、collection、dashboard 和 relayune-latency；
  未执行实际迁移、未更改生产 API、未创建生产 HMAC 密钥。
