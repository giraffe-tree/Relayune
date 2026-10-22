# Relayune 端到端加密与 PAKE 边界

## 安全目标

Web、原生 Mobile、Desktop Relay 及实际运行任务的本机 Agent 是会话业务明文端点。
Server 的中转接口不得接收或持久化下列会话秘密，MongoDB、私有 blob、备份和普通
运行日志也不得保存：

- 消息、历史、项目路径、会话描述和 Agent 输出；
- 审批动作、决定、命令摘要和附件内容；
- 8 位连接码、PAKE 中间密钥或最终内容密钥。

这项会话保密目标不等于所有经过服务端的数据都不可读。Server 必须瞬时处理登录密码、
账户会话与 HTTP bearer 等认证凭据；数据库保存密码的 scrypt 摘要和相应令牌摘要，
原始令牌不能持久化或进入普通日志。用户明确提交的反馈按可读字段保存，
账户、通知接入和路由元数据另有其访问控制与保留规则。

Server 仍可看到登录邮箱、随机设备/配对/会话/请求 ID、包方向、时间、TTL、
序号、在线状态和密文大小，因此流量分析不在保护范围内。

## macOS Desktop 账户登录

macOS 账户登录与客户端授权是两条独立流程。Desktop 本地生成 32 字节随机设备令牌，
只把其 SHA-256 摘要、设备名称和一次性登录请求发送给 Server；另一个 32 字节轮询秘密
只以摘要形式持久化，原值只返回给 Desktop 并停留在内存中。已认证 Web 会话可以确认该
请求并把 Mac 绑定到当前账户，但不会创建 `relay_browser_authorizations`，也不会获得任何
内容密钥或本机 Agent 权限。

确认结果由 Desktop 携带轮询秘密通过 HTTPS 取得，随后原始设备令牌才写入本机加密
vault。`relayune://desktop-login-complete?request=…` 仅唤醒应用，URL 中只有随机请求编号；
设备令牌、轮询秘密、短码和密钥都不进入 URL。请求一次性使用并在 10 分钟后由 TTL 索引
清理；取消或本机提交失败会撤销已经创建的设备 bearer。

## 短码 PAKE

每个手机或浏览器客户端的首次授权使用 RFC 9382
`SPAKE2-P256-SHA256-HKDF-HMAC`：

1. Desktop 生成随机 32 字节配对编号和 8 位短码，只把配对编号与 initiator
   share 发给 Server。
2. 浏览器从 URL 取得配对编号，用户输入短码；浏览器本地生成 responder share
   和浏览器确认值。
3. Desktop 取得 responder share 后在本地完成 PAKE，并校验浏览器确认值。
4. 双方严格按 RFC 9382 对 transcript 做 SHA-256，使用 HKDF-SHA256 派生两个
   HMAC-SHA256 确认密钥，再用 HKDF-SHA256 把 16 字节 RFC 会话密钥扩展为
   32 字节 A256GCM 内容密钥。
5. 浏览器同时生成独立随机授权令牌，只把 SHA-256 摘要与内容密钥 `kid` 交给
   Server。Desktop 提交自己的确认值；浏览器校验后才把不可导出的内容密钥、
   原始浏览器授权令牌、本次配对的设备编号与浏览器授权编号保存到 IndexedDB。
6. Desktop 只把这次 PAKE 新生成的内容密钥写入应用数据目录内经过 AES-256-GCM
   认证加密的本机 vault，并使用该浏览器专属的独立条目。Desktop 不使用 macOS
   Keychain 或 Windows Credential Manager；新增浏览器不得读取、包装、导出或复用
   已有浏览器的内容密钥。vault wrapping key 使用独立随机 256-bit 值；macOS 上应用
   数据目录与文件分别强制为 `0700` / `0600`，Windows 上依赖 `%APPDATA%` 的用户 ACL。
7. 后续 bootstrap 必须显式请求该设备并携带该浏览器授权令牌。Server 同时校验
   邮箱账户、设备归属、浏览器令牌摘要和撤销状态，不得根据心跳替浏览器猜选设备。

短码字符集去除了易混淆字符，格式为 `XXXX-XXXX`，约 40 bit 熵。短码以配对编号为盐，
通过 RFC 7914 scrypt（N=32768、r=8、p=1、40 字节输出）映射为 P-256 标量。配对会话
一次性使用并在 10 分钟后由 MongoDB TTL 索引清除。错误短码无法通过密钥确认，
这次会话随即作废，用户需要在桌面端重新开始。

Server 只持久化公开 share、确认值、配对状态、过期时间、内容密钥 `kid`、
用户/设备/浏览器路由关系，以及设备和浏览器授权令牌的 SHA-256 摘要。它不接收
短码、PAKE 输出或最终内容密钥；后续 HTTP 鉴权会瞬时接收相应 bearer，不能将其持久化。
公开握手消息与确认值不会给 Server
提供可验证的离线短码猜测。

已绑定电脑发起“添加浏览器”时，Server 已通过设备 bearer token 知道该电脑所属的
`user_id`。已登录浏览器可以查询同一账户下 `mode=browser`、`status=waiting` 且未过期
的配对编号，再在本地输入 8 位码完成同一套 SPAKE2 握手。这个查询不接收短码，也不返回
PAKE 秘密。macOS 账户登录不创建 PAKE 配对；Windows 现有 `mode=initial` 首次配对没有
账户归属，不会出现在查询结果中，仍须由桌面端打开带随机配对编号的链接或展示二维码。

Desktop 取消或让“添加浏览器”会话过期时，会用设备 bearer 和随机配对编号幂等删除
同一设备仍处于 `waiting` / `responded` 的 `mode=browser` 文档。取消请求不包含短码、
share 或内容密钥；首次配对与已经 `paired` 的浏览器授权不在删除范围。Desktop 还会在
较晚结束的创建请求之后重复一次清理，避免“界面已取消、Server 后创建”的竞态把旧会话
重新暴露给已登录浏览器。

## 多浏览器隔离

每个浏览器有独立 PAKE 内容密钥和独立授权令牌。Server 以浏览器授权编号分区
catalog、command、event 和 response 密文；该编号属于可见路由元数据。Desktop Relay
按命令的浏览器授权编号选择对应加密 vault 条目解密，并为共享目录和事件分别生成
每个仍有效浏览器的 A256GCM envelope。响应只用发起请求的浏览器密钥加密。

Server 校验 envelope 的 `kid` 必须匹配目标浏览器授权，但 `kid` 只是密钥摘要，
不能恢复内容密钥。取消授权会撤销该浏览器令牌、停止为它保存新密文，并让 Desktop
删除对应加密 vault 条目；其他浏览器的令牌、密钥和密文分区不变。

当前 Web/Desktop 实现使用 `@noble/curves` / `@noble/hashes`，Flutter 实现使用
`elliptic` / `pointycastle`，并在两端逐字节通过 RFC 9382 Appendix B 测试向量和
Relayune scrypt profile 互操作向量。该跨语言组合尚未完成专业独立安全审计。
当前 Dart `elliptic` 0.4.0 使用 Montgomery ladder 与无分支 conditional swap，
不能沿用旧版按秘密位分支的结论；但 Dart `BigInt` 以及 JavaScript JIT/GC 的时间行为
仍没有硬性常量时间保证。测试向量和 AI 代码审查均不能证明消除了侧信道，
正式扩大使用范围和作出更强保密承诺前必须完成专项评估。

## v2 密文

业务载荷只使用 256-bit 内容密钥和 AES-256-GCM：

```json
{
  "v": 2,
  "alg": "A256GCM",
  "kid": "sha256:…",
  "iv": "base64url-96-bit-random-iv",
  "aad": "base64url-canonical-json",
  "ciphertext": "base64url-ciphertext-and-tag"
}
```

AAD 绑定方向、类型、设备、会话、请求、事件序号、创建时间和过期时间。Server
改写任何已绑定字段都会导致解密失败。每次加密必须使用新的 96-bit 随机 IV；
离线队列和 Relay outbox 保存原始 envelope，不重新加密。

当前使用每客户端授权的长期对称内容密钥，没有逐消息 ratchet。服务端仅取得历史密文
不应能够解密，但以后若同一内容密钥从客户端泄露，已录制的旧密文也可能被解密；
当前方案不承诺前向保密。保留窗口减少服务端保存的副本，不等同于销毁攻击者已录制的密文。

## 审批

Web 把审批 ID、设备、会话、精确 action hash、决定、原始过期时间和一次性
nonce 一起加密。Mac 解密后再次验证 pending 状态、路由、过期时间、nonce 和
SHA-256 命令摘要，验证通过后才调用本机 Agent。Server 无法构造新的有效批准
密文。

## 不覆盖的威胁

本设计不保护已被控制的 Mac、浏览器、扩展、本机 Agent、依赖供应链或用户屏幕。
本机 vault 加密用于避免秘密以明文文件出现并检测篡改，不抵抗已经取得同一用户应用
数据目录和运行中进程读取权限的攻击者；wrapping key 与密文必须作为一个整体保护和备份。
它也不能单独抵抗可修改并重新下发前端 JavaScript 的强恶意 Server：被替换的
脚本可在浏览器解密后外传内容；不可导出的 `CryptoKey` 仍可被该同源脚本调用来解密。
需要抵抗该威胁时，应使用独立分发、签名并可校验的原生客户端或浏览器扩展，
固定发布信任和前端版本。原生客户端也须保护签名更新链与本机端点，不能仅凭签名就承诺绝对安全。

主动恶意 Server 还可以回放旧授权快照；与仍持旧密钥的客户端串谋时，
仅从服务端列表移除授权不等于 Desktop 已永久删除密钥。Desktop 本地显式删除对应 key 后不能再由
该快照生成副本；当前缺少覆盖所有撤销路径的不可回退确认机制。Server 不会单独由此取得内容密钥，
但不能承诺“撤销后即使服务端与旧客户端串谋也无法再读”。
当前源码复核、合成复现及尚待专业审计的项目见[密码学安全复核](crypto-security-review.md)。
