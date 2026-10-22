# 网络优化与回合状态整合验证 — 2026-09-18

基线：`a084a3f`。整合 `codex/network-usage-audit`（`987ebdc`）和
`fix/turn-status-20260911`（`ea1b2b0`），保留两条分支的合并历史。

## 最终行为

- 服务端合并 40 ms 内的刷新通知，Web 合并 25 ms 内通知并保留在途尾随更新。
  目录刷新不重复获取事件，队列摘要不推进已消费事件游标。
- 仅对允许路由的成功加密 JSON 响应协商 gzip；失败、登录、带 Cookie 等响应保持原样。
  网络统计仅保存固定路由、计数和字节数，不记录业务内容、用户标识或密钥。
- 手机回合状态区分完成、停止、未完成、审批、问题、离线待同步与无明确终态的处理记录。
  工具失败不等于回合失败。保留主线的“处理中”“本次处理未完成”措辞。
- `turn_status` 经历史响应与加密手机缓存保存。重复终态事件幂等；旧回合终态不能清除新回合运行状态。
  兼容主线旧缓存的 `turn.stopped` 标记，并保留其停止时间与文案。
- 保留主线审批卡片与原回合归属；状态只读取该回合的待审批卡，不重新打开已解决的历史审批。
- 多语言新增状态已覆盖现有各 locale；不覆盖此前主线的本地未提交文件。

## 检查与测试

- TypeScript、Flutter analyze、git diff --check 通过；ESLint 0 errors / 9 warnings（已有代码）。
- Web/API 自托管构建通过；未部署生产。
- 网络专项 Node 测试 29 项、Python 统计测试 3 项通过。
- Codex 历史、加密与 Relay 协议专项 75 项通过。
- Node 全集初跑 886 项：865 通过、21 失败。19 项缺少构建产物，完成 Web 构建后复测通过；
  另外 2 项是旧夹具未包含 trickle ICE 能力及 outbox 隔离接口，修正夹具后复测通过。
  失败文件的两批复测共 41 项均通过，未为修复测试改动相关产品逻辑。
- Desktop 19 个测试文件、123 项通过。
- Flutter 全集 653 项：初跑 642 通过、11 失败。5 项受本次状态文案和新增终态消息影响的
  断言已适配；相关 158 项复测首轮剩余 1 个旧标题查找，修正后该文件 45 项全通过。
  工具活动专项在此前 50 项相关测试中通过；审批历史、停止计时、缓存恢复与旧事件隔离已覆盖。
- 手机用例映射检查通过：114 active / 114 automated。

## 基线已存在的 6 项 Flutter 失败

在未修改的 `a084a3f` 独立工作区运行相同文件，复现完全相同的 6 项失败，保留为独立问题：

1. `project_list_test.dart`：项目折叠后 Agent 侧栏标签断言。
2. `project_list_test.dart`：会话状态图标断言。
3. `claude_cowork_test.dart`：Cowork 侧栏入口查找。
4. `mobile_layout_test.dart`：内联 Agent 行点击区域查找。
5. `mobile_layout_test.dart`：长 Agent 信息布局查找。
6. `localization_test.dart`：部分 locale 缺少已有 `controllerSessionUnavailable` 键。

因此本次不宣称手机全量回归全绿。

## 本地网络测量

`node scripts/measure-network-optimization.mjs` 使用回环 HTTP/WebSocket 和合成加密夹具。
混合突发场景请求数 41 → 3，保留 180 条事件、cursor=180、queued_commands=2；
WebSocket 通知 20 → 1。gzip 解压内容一致。以上不是生产流量或费用降幅。

分支内 9 月 11 日部署文档仅作为历史记录纳入，本次未核查当前服务器版本，也未执行部署、推送或发布。

## 并发主线更新

整合期间主线新增 `b4d0187`（项目会话缓存刷新）。已无冲突并入，保留项目缓存与回合状态两套修改。
补跑项目缓存、项目分页、历史存储、审批、回合状态和历史恢复共 120 项：118 通过，
仅上述两个既有 `project_list_test.dart` 断言失败；Flutter analyze 无问题。
