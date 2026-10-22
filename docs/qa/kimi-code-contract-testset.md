# Kimi Code ACP 固定测试集

生产准入使用 [`tests/cases/kimi-code-contract.json`](../../tests/cases/kimi-code-contract.json)
作为可审阅用例清单，自动化实现位于
[`tests/kimi-adapter.test.mjs`](../../tests/kimi-adapter.test.mjs) 与
[`tests/kimi-contract.test.mjs`](../../tests/kimi-contract.test.mjs)。测试只启动仓库内固定的
假 ACP 子进程，不访问网络、不读取真实 Kimi 账号，也不依赖用户本机历史。

覆盖面：初始化能力门禁、会话列表和加载、历史重放与分页、Prompt 流式分片、快捷命令、
模型/Thinking/权限状态、上下文用量、Swarm 多 Agent、审批同意与拒绝、图片 image block、
停止/取消、Prompt 异常、进程断线、陈旧事件隔离，以及畸形和超量数据的有界归一化。

运行方式：

```bash
node --test tests/kimi-adapter.test.mjs tests/kimi-contract.test.mjs
```

`KIMI-ACP-001` 至 `KIMI-ACP-012` 必须全部有同名测试标题；P0 用例不得跳过。
