# macOS 0.3.25 本机 Relay 启动退出

## 现象与证据

- 两次启动在 sidecar 创建后约 91.7 / 91.5 秒退出，exit code 1，无 signal；Rust 桌面进程仍在运行。
- CLI 有 90 秒启动期限及有界退出清理。原诊断将其固定阶段错误归为 `stderr_unclassified`，无法从旧日志直接恢复具体阶段。
- 第二次启动的 3 秒原生采样中，主线程 2373 个样本有 2349 个停在 `node::sqlite::StatementSync::Get`；大量样本继续进入 `pread`。当时内存约 130 MB，CPU 约一个核心。
- 活跃附件 SQLite 文件约 456.7 MB，inline 1383 条、local_path 1328 条；当时 outbox 约 53 KB。
- 同时段生产 API/Mongo 持续运行、健康检查成功；没有本次启动 HTTP 请求失败的记录。站点未启用 Nginx access log，不能据此完全排除网络问题。

## 根因与修复

Codex 初始化会等待历史附件恢复。每次新增附件都调用 `pruneInlineBytes`，通过
`SUM(byte_size)` 统计 inline 总量。旧索引只有 source_kind/accessed_at_ms，查询回读
包含大密文的 WITHOUT ROWID 主表；包括不占 inline 容量的 local_path 插入也会触发统计。
大量恢复记录将这项同步成本反复叠加到启动期限内。rollout 处理完成才记录 checkpoint，
中途退出会再次处理未完成文件。该路径早于 0.3.25，近期历史预热不在启动等待链上。

增加 `(source_kind, accessed_at_ms, created_at_ms, byte_size)` 覆盖索引，并明确用于
容量统计与淘汰排序；通过密钥校验后才创建，兼容原 schema。local_path 插入跳过
inline 容量检查。保留原有加密、512 MiB 默认容量、LRU 淘汰和 checkpoint 行为。

Desktop 对启动超时/失败的六个固定阶段作完整字符串匹配，只保存固定分类，拒绝
未知阶段或动态后缀，不记录原始 stderr、会话内容或凭据。

## 验证

真实库仅在私有临时目录中复制加密文件测试，未解密附件；结束后删除该副本。
相同聚合结果：旧查询 1145 ms，新查询 0.147 ms；新查询 100 次共 5.76 ms；
一次性索引创建 94 ms。只读原库另一轮旧查询为 1742 ms。这是本机样本，非所有机器的保证。

- Node 相关回归共 85 项通过：加密附件迁移/解密/容量淘汰/增量恢复、附件传输、Codex 重启、启动截止及失败退出。
- 新回归检查实际执行的统计和淘汰 SQL 都使用覆盖索引、无排序临时树；验证 local_path 不触发统计且不受 inline 淘汰影响。
- 本次源码基于 `d0dfc16`（0.3.25），避免覆盖安装回旧的 0.3.24。
