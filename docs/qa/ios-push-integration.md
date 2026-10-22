# iOS 加密任务推送

## 已实现的链路

Desktop 在任务开始、审批请求/处理、完成/失败时，从内存状态生成最小摘要；每个已授权手机
从自己的 PAKE 内容密钥独立派生推送密钥：HKDF-SHA256，空盐，info `relayune.ios.push.v1`。
只把派生密钥保存到 iOS 共享 Keychain，通知扩展和 Widget 不接触会话内容密钥。
摘要使用现有 A256GCM envelope，AAD 类型为 `ios.push`。不包含任务标题、路径、命令、审批文本或消息。

Node 校验原事件鉴权、序号和推送 envelope 路由，Mongo 保存密文任务队列。APNs 设备/活动 token
使用独立服务器密钥加密保存，任务投递前重新检查手机授权及 Desktop 撤销状态。
iOS 通知扩展解密后显示本地语言的状态和处理入口，点击后由已授权手机打开对应任务。
活动 token 通过独立 HMAC 路由匹配，已有实时活动可在后台通过 ActivityKit APNs 更新及结束。

Server/APNs 可见目的 token（Server 仅在投递时解封）、授权/设备及事件路由元数据、时间、
是否请求提醒、update/end 生命周期操作和不透明活动路由。业务状态字段留在密文内；流量/时序没有隐藏。
通知扩展解密失败、尚未首次解锁或系统未运行扩展时，系统显示通用提示。

## 本机与服务器配置

本机 APNs `.p8` 放在 `~/.config/relayune/secrets/apns/`，目录 0700、文件 0600；不提交 Git。
测试密钥只发 sandbox，正式密钥只发 production。Debug 构建使用 sandbox，Release/Profile 使用 production。
下列 Team ID 使用 `YOUR_TEAM_ID` 占位；topic 必须匹配自己的应用标识。仓库当前主 topic 是 `cn.giraffetree.relayune`；活动请求 topic 为
`cn.giraffetree.relayune.push-type.liveactivity`。Broadcast 无需开启。

Node 配置以下文件路径和公开标识（以下为配置示例，不是生产部署记录）：

```dotenv
APNS_TEAM_ID=YOUR_TEAM_ID
APNS_SANDBOX_KEY_ID=YOUR_SANDBOX_KEY_ID
APNS_SANDBOX_KEY_FILE=/etc/relayune/secrets/apns/sandbox.p8
APNS_PRODUCTION_KEY_ID=YOUR_PRODUCTION_KEY_ID
APNS_PRODUCTION_KEY_FILE=/etc/relayune/secrets/apns/production.p8
APNS_TOKEN_STORAGE_KEY_FILE=/etc/relayune/secrets/apns/token-storage-key
```

token-storage-key 内容为随机 32 字节的 base64url，必须直接写入私有文件，不输出终端。
读取器接受无组/其他用户权限的常规文件，也接受 root 所有、仅服务进程所属组可读的 0640 文件；拒绝符号链接和更宽权限。
没有 APNs 配置时服务照常启动，手机登记接口返回 503，后续连接心跳重试。
注册接口使用邮箱账户会话及手机 PAKE 授权，不能只凭设备编号登记。

Runner、LiveActivity、NotificationService 共用 `YOUR_TEAM_ID.cn.giraffetree.relayune.push` Keychain 组。
发布前须确保这三个 target 的 App ID、签名和 provisioning 与 entitlements 匹配。
`.p8` 是服务端投递凭据，不替代 iOS 应用签名。

## 验证方法

自动化检查覆盖 Node/Flutter HKDF 一致性、Node → CryptoKit 解密及过期/篡改/错设备拒绝、
摘要不含业务原文、多子任务审批、登记去重/退出竞争、撤销检查和 APNs 失败重试。
对应 MOB-NOT-019；这些检查不代表 Apple 已送达通知。

真实 sandbox 验证仅用已占用的 QA 模拟器。启动本机 `scripts/verify-ios-apns.mjs`，参数依次为
测试 p8 路径、Key ID、Team ID、可选端口（默认 19843）。脚本只绑定 127.0.0.1，随机合成密钥和 token
只留在内存。Debug 模拟器启动参数 `--relayune-apns-preview-port=19843` 安装合成推送密钥并报告登记状态；
同时传 `--relayune-live-card-preview=running` 可创建合成实时活动。收到设备 token 后约 25 秒发审批、
60 秒发完成。日志只报告权限/登记布尔值和 APNs 状态，不打印任何 key/token/envelope。
测试后停止脚本，并正常重新启动 App 清除测试绑定。

验收必须区分：获取 token、APNs 返回 200、系统通知实际出现、通知扩展解密成功、
已有实时活动更新/结束。这些是独立阶段。`simctl push` 注入只能验证本机展示，不能证明 APNs 通道有效。

## 当前范围

- 需要审批及任务结束发送普通通知；前台由既有实时事件通知负责，避免前台重复弹窗。
- 持续卡片需要 App 曾在前台创建，尚未实现 push-to-start；后台新任务不保证自动出现灵动岛卡片。
- 卡片并非无限常驻，遵循 ActivityKit 的系统时限、用户关闭和系统预算。远端状态 75 秒后过期，
  直到后续事件/前台同步更新；不伪造持续在线状态。
- APNs 不是必达队列；短暂失败最多尝试 6 次，消息到期后停止投递。不能把 APNs 200 等同手机收到。
- 真机锁屏、网络切换、系统回收及通知投递都需在自己的环境验收，不能从服务启动成功推断。


## 验收记录归属

真实个人设备、账户、APNs 结果与生产配置记录留在私有维护仓库；内部验收档案未随公开源码提供。本文描述实现及复验方法，不声明本副本已通过真实 APNs 或真机验收。
