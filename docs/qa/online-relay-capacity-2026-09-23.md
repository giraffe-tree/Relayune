# 在线密文转发与 100 用户容量验证

2026-09-23，本机隔离 worktree 与独立 MongoDB 7.0.14；无生产操作。

## 真实数据库与网络压测

入口：`RELAY_TEST_MONGOD=<mongod路径> node --test tests/online-capacity-mongo.test.mjs`。
测试启动临时数据库和真实 WebSocket 服务，使用生产 EmailAuth、账户权益检查、
设备/客户端授权方法、MongoStore 和统一 MongoBudget。数据与凭据均为临时 fixture。

| 项目 | 最新一轮结果 |
| --- | --- |
| 并发用户 | 100，每人 1 Desktop、1 客户端，共 200 个 WebSocket |
| 稳态持续时间 | 35.001 秒，覆盖 30 秒授权复核 |
| 实时事件 | 35,000 发出、35,000 收到 |
| 加密消费 ACK | 35,000 收到 |
| 只读请求与响应 | 3,500 次完成 |
| 交付失败 | 0 |
| 稳态 MongoDB 命令总数 | 1,300 |
| 稳态平均命令速率 | 约 37.14 次/秒 |
| 稳态任意滚动 1 秒峰值 | 180 次 |
| Desktop / 客户端授权检查 | 各 200 次，包括初次检查和周期复核 |
| 事件、响应、命令集合 | 在线传输未新增记录 |
| 本轮投递 P95 | 24.33 ms |

P95 对同机并行构建和测试敏感，之前两轮为 236–267 ms；不能据此承诺生产网络延迟。
负载由协议客户端生成，不包含真实 Agent 模型生成或手机 UI 渲染。全部数据经过 Node，
不依赖 WebRTC 成功率。

饱和阶段共 2,750 次请求：完成 1,026 次，1,724 次因有界队列/限额返回繁忙。
此阶段以及整个测试期间，任意滚动 1 秒的应用 MongoDB 命令峰值均为 **800**。
拒绝数是明确的过载测试结果，不能把它计入正常容量成功率。

计数来自 MongoDB 驱动真实 commandStarted，包含查询、更新、插入、聚合等应用命令；
后续验证读也走相同预算。驱动连接维护和 MongoDB 内部 TTL 另有语义，其他项目不在
本测试范围内。规则与部署边界见 [容量设计](../online-relay-capacity.md)。

## 跨模块恢复验证

`tests/online-stream-integration.test.mjs` 连接实际 CipherStreamServer、MacRelay、
OnlineRelayTransport、Web OnlineStream 和 Web/Relay 端加解密，Agent 使用 MockCodexAdapter。
覆盖目录/历史请求、catalog 版本推送、事件与独立 ACK，断线无事件 HTTP 回退，新连接
拒绝旧代次 ACK，64 条无 ACK 后收到加密重新同步提示，以及初次历史快照到激活之间
产生的新内容通过激活后二次历史读取恢复。

Flutter `online_stream_recovery_test.dart` 使用真实本地 WebSocket 和客户端解密路径，
验证恢复期间同 ID 内容增长、无变化目录不重复查询、实时事件确认、前后台切换，以及
连接被新实例替代后不反复抢占连接。

## 生产生效条件

服务端及 Nginx 的 `/api/stream` 升级路由、Desktop 和客户端需要分别更新，能力协商
才会启用新链路。旧版本继续兼容原链路。此轮不部署服务器、不推送 Git、不发布应用；
本地压测不能说明此前停止的生产 MongoDB 已经恢复。
