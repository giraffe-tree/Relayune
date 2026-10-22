# Relayune SLS 接入

本文说明现有日志工具的配置与验证方法。实际生产迁移、主机检查、云端资源与验收结果留在私有维护仓库，未随公开源码提供；下面的资源名和命令均为配置示例，不代表已部署或已验收。

HTTP 日志 v2 的耗时单位为毫秒，包含部署版本、trace_id、user_ref 与认证元数据。字段、密钥和迁移约束见 [HTTP 日志 v2](request-log-v2.md)。

## 工具与范围

- `scripts/sls/manage.py`：离线生成、只读检查、幂等创建、显式绑定采集配置、告警通知配置、入库查询验证。
- `scripts/sls/config.py`：官方 LoongCollector journal 采集配置、14 个字段索引（v2）、8 个看板面板、3 个告警规则。
- `shared/request-log-routes.json`：服务端与采集配置共用的 50 个固定路由模板。
- `shared/request-log.mjs`：未知路径/方法归一化；服务端耗时使用单调时钟。
- `deploy/sls/relayune-sls-health.{service,timer}`：每分钟一次的本机健康探测。
- `scripts/sls/smoke.py`：生成不连接 SLS 的 Linux 采集器合成测试配置，并检查输出。

## 默认资源

| 项目 | 值 |
| --- | --- |
| Region | `cn-huhehaote` |
| Project（候选名称，需检查占用） | `relayune-prod-observability` |
| Logstore | `api-access` |
| Machine group / 主机自定义标识 | `relayune-prod-http` |
| Collection | `relayune-http-journal-v1` |
| Dashboard | `relayune-api-overview` |
| 保留期 | 7 天，参数允许 1–30 天 |
| Shard | 1 个，关闭自动分裂 |
| 告警 | 默认 Disabled，不自动选择接收人 |

按量使用，不自动购买资源包。保留期和 shard 配置限制初始规模，但不是费用硬上限。

## 本地开发与配置预览

离线生成只需 Python 3.9+，不读取凭据、不导入 SLS SDK、不连接网络：

```bash
python3 scripts/sls/manage.py render --output /tmp/relayune-sls-plan.json
```

输出包含项目、Logstore、索引、采集配置、机器组、仪表盘和告警规则。
输出文件使用排他创建，不覆盖已有文件。修改选项后用新文件名生成。

需要运行 SDK 合约测试或后续上线命令时，在隔离环境安装固定版本：

```bash
uv venv /tmp/relayune-sls-venv
uv pip install --python /tmp/relayune-sls-venv/bin/python -r scripts/sls/requirements.txt
/tmp/relayune-sls-venv/bin/python -m unittest discover -s scripts/sls -p 'test_*.py'
node --test tests/request-log.test.mjs tests/server-blindness.test.mjs tests/e2ee-crypto.test.mjs
```

## 凭据接口

`--credentials-file` 只接受当前用户拥有的常规文件，权限不得开放给组或其他用户，
拒绝符号链接。建议 `0600`，放在仓库外。支持以下两种格式：

- 两行文本：第一行 AccessKey ID，第二行 AccessKey Secret。
- JSON：`access_key_id`、`access_key_secret`，可选 `security_token`（临时凭据）。

不通过命令行参数传密钥，不打印凭据或 SDK 原始异常。脚本只输出固定状态和受限错误码。
云端 endpoint 由通过格式检查的 region 与官方域名组成，固定使用 HTTPS。

初始化身份需要目标 SLS Project 下的项目/Logstore/索引/采集配置/机器组/看板/告警
读写权限及日志查询权限；创建项目还需 `log:CreateProject`。脚本直接读取指定项目，
不依赖跨账户资源枚举或 `log:ListProject`。脚本不创建 RAM 身份、不扩大权限。
采集器身份与初始化身份分开，优先使用官方 ECS 同账户认证机制，并验证采集传输加密。

## 使用已有 Project / Logstore

用户已有资源可显式添加 `--use-existing-resources`，例如：

```bash
/tmp/relayune-sls-venv/bin/python scripts/sls/manage.py inspect \
  --project relayune --logstore relayune --use-existing-resources \
  --credentials-file /home/developer/.config/relayune/sls-credentials.json
```

所有后续管理命令使用相同目标参数。此模式要求 Project 和 Logstore 均已存在，
不修改项目描述、保留期、shard 或其他存储设置，不创建缺失的 Project/Logstore。
仅补建缺失的子资源；已有索引、机器组、采集规则、看板及告警仍需通过完整冲突检查。
不传此选项时仍只接受本工具管理的 Project。`--retention-days` 只用于新建日志库，
不会改变已有日志库的保留期。已有日志库的保留期和 shard 数以部署者查询结果为准。

## 后续上线顺序

以下为通用上线流程。已有资源请添加上节目标参数及 `--use-existing-resources`。替换凭据文件路径；若更改 Project/Region，
所有步骤使用相同参数。

```bash
# 只读检查精确资源；发现名称冲突、定义漂移或权限错误则停止。
/tmp/relayune-sls-venv/bin/python scripts/sls/manage.py inspect \
  --credentials-file /absolute/private/sls-key

# 创建资源，默认不绑定机器组、不启用告警。
/tmp/relayune-sls-venv/bin/python scripts/sls/manage.py apply \
  --credentials-file /absolute/private/sls-key
```

初始化脚本先预检已有定义，之后只创建缺少的资源，不覆盖同名配置。
项目必须由本工具创建且具有固定 description 标记；已有其他项目使用不同名称。
遇到超时/部分失败保留已创建资源，重跑同一命令续建，不自动删除云端数据。
服务端生成的额外元数据允许存在，但索引出现额外字段或全文索引会拒绝继续。

然后按自己的服务器运维流程完成主机步骤：

1. 验证官方 LoongCollector 版本与 CentOS 7/glibc 的兼容性，记录版本和下载校验信息。
2. 在隔离的 Linux 采集器实例运行下文的合成测试，验证真正的插件输出。
3. 通过厂商安装流程设置同账户采集身份；主机自定义标识使用 `relayune-prod-http`。
   先检查是否已有采集器及自定义标识，不能覆盖其他服务的配置。
4. 保持采集器检查点/重试缓存目录持久化。journal 默认从 tail 开始，不上传历史日志。
5. 安装本项目的健康探测 service/timer 前核对 `/usr/bin/curl`、`agent-relay` 用户与端口；
   配置通过后启用 timer，不修改或重启 `agent-relay.service`。
6. 验证采集配置无原始日志输出并确认目标机器组后，显式绑定：

```bash
/tmp/relayune-sls-venv/bin/python scripts/sls/manage.py apply \
  --credentials-file /absolute/private/sls-key --activate-collection

# 入库后验证所有看板/告警 SQL 可执行，且最近 15 分钟收到日志。
/tmp/relayune-sls-venv/bin/python scripts/sls/manage.py verify \
  --credentials-file /absolute/private/sls-key
```

`verify` 不证明通知已送达，也不能代替检查云端日志的字段白名单、图表显示和主机续传。

最后选择已有的 SLS 行动策略 ID，核对接收对象及健康探测已运行，再配置告警：

```bash
/tmp/relayune-sls-venv/bin/python scripts/sls/manage.py configure-alerts \
  --credentials-file /absolute/private/sls-key \
  --action-policy EXISTING_POLICY_ID --enable-alerts --health-probe-installed
```

SLS 的 create/update 请求体不能可靠控制告警状态；脚本使用独立 enable/disable API，
并回读验证 `ENABLED` / `DISABLED`。首次创建与停用是两次请求，未配置通知策略时不要开启告警。

`configure-alerts` 只调整本工具定义仍匹配的告警的状态/通知策略，不覆盖用户在控制台
修改过的查询或阈值。不传 `--health-probe-installed` 时健康日志中断告警保持关闭。
不传 `--enable-alerts` 时关闭这些规则。资源创建后变更了告警选项，再跑 `inspect/apply`
也需传相同选项，否则按定义冲突停止。行动策略的存在与通知送达需要上线时验证。

## 采集安全与可靠性

- 官方 `service_journal` 仅订阅 `agent-relay.service`，不采集内核日志。
  空 `JournalPaths` 使用 systemd 默认来源，兼容 `/run/log/journal` 和 `/var/log/journal`。
- 首先再次校验 unit，然后仅保留 MESSAGE；严格匹配当前 Node 日志序列化格式，
  再提取白名单字段。格式损坏、额外字段、转义值、非请求日志全部丢弃。
  字段顺序改变也会拒绝采集；更改生产者格式时必须同时修改并测试采集配置。
- 保留 journal 事件时间。只上传方法、固定路由模板、状态、耗时、级别和枚举错误码。
  不上传原始 MESSAGE、URL 查询参数、请求/响应体、邮箱、令牌或配对材料。
  SLS/采集器自身可能附带采集主机 source/tag 元数据，它们不是客户端访问者信息。
- 未知路径固定为 `unmatched`，未知方法为 `UNKNOWN`；补齐 iOS 推送、配对取消等模板。
  无法识别的 error 字段删除，不影响其状态码统计。
- `processor_fields_with_condition` 的 add action 会追加同名字段，因此配置明确先 drop
  原值、再 add 固定值，防止原始 URL 以重复字段形式漏出。
- 首次从 tail 开始，后续使用采集器检查点。异常退出/重试可能导致少量重放，不能作为
  精确计费账本；journal 轮转或缓存耗尽造成的缺口需通过真实环境验收和告警发现。
- 业务 API 不同步调用 SLS，不新增 MongoDB 日志写入，SLS 不可用不阻塞业务请求。

## 采集器合成验收（不需要云端密钥）

```bash
python3 scripts/sls/smoke.py render --file /tmp/relayune-sls-smoke.yaml
```

在**隔离的 Linux 官方采集器实例**的本地 pipeline 配置目录使用此文件；其中只包含
合成输入和 `flusher_stdout`，不读取 journal、不上传 SLS。采集至少一个批次，捕获
stdout 后执行：

```bash
python3 scripts/sls/smoke.py check --file /tmp/relayune-sls-smoke.stdout
```

不要把合成配置与生产配置一起绑定。检查器要求出现六种预期安全路由、固定协议错误码，
拒绝合成秘密、额外字段以及本应被过滤的服务数据。此验收不能代替真实 journal
检查点恢复/网络重试验收。真实采集器结果需要在目标环境另行验收，历史生产结果未随公开源码提供。
官方商业版会后台化并关闭 stdout，可使用 `--collector-output /absolute/smoke.filtered.log`
生成仅写本地文件的合成配置，再用 `check --file` 检查；检查器支持官方输出的时间前缀。
3.2.6 商业版本地配置目录是实例配置根下的 `config/local`，与开源包目录可能不同。

## 看板与告警口径

8 个面板：每分钟请求数、P50/P95/P99 延迟趋势、接口调用量与性能排名、状态码分布、
5xx/429/499 趋势、轮询请求占比、5xx 比例、健康探测。完整 SQL 以 `render` 输出为准。
v2 的耗时索引单位为毫秒；旧版无 schema_version 或标记为 1 的记录仍按秒解释。
图表和告警按版本统一换算成毫秒，慢请求阈值为 2000 毫秒。健康探测从业务请求统计中剔除。

| 告警 | 初始条件 | 持续次数 |
| --- | --- | --- |
| 5xx | 5 分钟业务请求至少 100 次、5xx 至少 5 次且比例超过 5% | 3 次 |
| 普通接口慢 | 按方法与路由分组；5 分钟至少 100 次、P95 超过 2 秒；排除大型载荷接口 | 3 次 |
| 健康日志中断 | 已安装每分钟探测后，5 分钟未见健康请求日志 | 2 次 |

每分钟评估，使用 `-6m` 到 `-1m` 的完整五分钟窗口，预留一分钟入库延迟。
通知重复间隔 30 分钟，开启恢复通知。采集停止代表“服务或采集链路异常”，本机探测
不能证明公网 DNS、HTTPS 或证书正常。阈值需根据上线基线调整。

当前仅覆盖 Node HTTP 请求。WebSocket 消息、空轮询比例、命令数量/排队时长没有现成
请求日志数据，不能从这些面板推导。部分 handler 直接返回错误，只有状态码而没有
统一 error 字段，因此错误码分类不是完整协议错误统计。

## 验证与回滚

运行前述本地检查后，还需在自己的环境验证真实采集器、云端 SQL、字段白名单、HTTPS 传输、重启续传、图表渲染与通知送达。本副本不提供既有生产验收记录，也不据历史测试数量证明当前部署可用。

上线验收应记录实际资源名、云端链接、采集器版本、日志对账时间段及结果。
用少量 GET 请求与 journal 对账，不能通过制造生产 5xx 演练告警。

回滚仅解除本次采集配置绑定、停用本次新增的健康 timer 和告警；若采集器为共享实例，
不停止整个采集器。不重启业务、不删除业务数据或已有 SLS 日志。
配置停用不等于保留中的历史日志立即停止产生存储费用。

## 官方资料

- [SLS SDK](https://github.com/aliyun/aliyun-log-python-sdk)
- [Journal 插件](https://github.com/alibaba/loongcollector/blob/main/docs/cn/plugins/input/extended/service-journal.md)
- [条件字段处理](https://github.com/alibaba/loongcollector/blob/main/docs/cn/plugins/processor/extended/processor-fields-with-condition.md)
- [创建仪表盘](https://help.aliyun.com/en/sls/developer-reference/create-dashboard)
- [告警数据结构](https://www.alibabacloud.com/help/zh/sls/developer-reference/data-structure-of-an-alert-monitoring-rule)
