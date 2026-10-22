# 手机设备页订阅额度

设备页按 Agent 聚合信息：左侧显示名称和版本；Codex、Claude Code、Kimi Code 右侧在原状态位置直接显示紧凑额度（例如 `5h 已用 24%`、`7d 已用 61%`），窄屏自动换行。每个额度下方以小号字显示手机本地重置时间，并注明该时刻的 UTC 偏移（例如 UTC+08:00，兼容半小时时区和夏令时），移除进度条及更新时间；无额度或 Agent 不可用时保留状态。缺失/已重置窗口显示 `—`；长按可查看窗口语义及过期、未上报或上次检测提示。

- Codex 使用本机 app-server 的 `account/rateLimits/read`，并消费 `account/rateLimits/updated`。按窗口时长 300 / 10080 分钟识别，不能假设 primary 永远是 5 小时。只采用通用 codex bucket，不把模型专属额度混入。读取独立于 daily Token 用量，缓存 30 秒；额度请求 5 秒超时。账号变化清空额度。
- Claude Code 消费 Relayune 所运行会话的 `rate_limit_event.rate_limit_info`，分别合并 `five_hour` / `seven_day`，utilization 从 0–1 转为百分比。不会为了查询额度自动发起付费对话。CLI 不上报某窗口或不提供 utilization 时显示“尚未上报”；这意味着 Claude 在未运行会话时可能无法展示完整额度。不会读取浏览器 Cookie、Keychain 或导出 CLI 凭据，也不会把 Token 数换算为订阅额度。
- Kimi Code 使用当前 CLI 的 `provider list --json` 在内存中解析 managed provider 配置，读取它指定的 file OAuth access token（或 managed API key），仅向官方 `https://api.kimi.com/coding/v1/usages` / `https://api.kimi.ai/coding/v1/usages` 请求。拒绝重定向、非官方地址、路径穿越、凭据符号链接及过期 token；不刷新或改写凭据，不读取 Keychain，不记录原始配置、凭据或接口响应。30 秒缓存，配置探测 4 秒、网络请求 5 秒超时。接口 `usage` 是周额度，`limits` 按 window 时长识别 5 小时；used/limit（或 remaining）计算已用比例。旧 CLI、不支持的配置、未登录及失败均显示未知，不把本地 Token 用量当订阅额度。
- 页面保留重置时间，不显示更新时间；采样时间用于判断数据是否陈旧。
- 离线或采样超过 15 分钟标明上次检测；到达重置时间后隐藏旧进度，等待新数据，不自行归零。未知百分比没有进度条；0% 是有效数据。
- `usage.<provider>.quota_windows` 随已有 catalog 端到端加密；服务端没有新增明文字段。旧版桌面端没有此字段时兼容为空，已有每日 Token 统计保持原义。

协议来源：[Codex App Server](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt)、[Claude Agent SDK RateLimitInfo](https://code.claude.com/docs/en/agent-sdk/python#ratelimitinfo)、[Claude 官方消息解析器](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/message_parser.py)。

预览截图由真实 Flutter 组件渲染，使用示例版本、状态和额度，不是账户实测：Agent 状态与额度合并预览（内部验收档案未随公开源码提供）。

Kimi 协议来源：[官方额度解析与请求实现](https://github.com/MoonshotAI/kimi-code/blob/main/packages/oauth/src/managed-usage.ts)、[官方凭据存储](https://github.com/MoonshotAI/kimi-code/blob/main/packages/oauth/src/storage.ts)。
