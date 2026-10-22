# 手机预览电脑网页

手机会话中的 `http://127.0.0.1:8766/#auth`、`http://localhost:3000/` 等链接
直接进入网页，不再显示二次打开确认。底部工具栏提供后退、前进、地址、刷新和关闭；
点地址可查看电脑名称及完整网址。系统返回优先退回上一页，关闭按钮返回会话。
首屏显示连接/获取阶段与等待时间，加载使用细进度条。工具栏上方显示资源汇总，
点击展开每项请求的等待、接收、处理、已取回和失败状态；有传输总量时显示百分比，
未知时显示实际接收量。百分比表示加密响应的接收进度，已取回不等于网页内部业务全部就绪。
资源记录只在当前预览内存中，保留最近 80 项及当前在途项，不包含网址查询参数。
访问失败可重试，切后台后仍需重新打开。
保持电脑、本地网页服务和 Relayune 运行；不要求手机与电脑在同一 Wi-Fi。
旧桌面端没有 `local_web_version: 1` 时，手机显示更新提示。

## 当前支持

- 明确端口的 HTTP/HTTPS 回环地址：localhost、127.0.0.1、[::1]，端口 1024–65535。
- 同一源的 HTML、图片、样式、脚本、子页面、hash 路由和浏览返回。
- GET、HEAD、POST、PUT、PATCH、DELETE、OPTIONS；JSON、表单和二进制请求正文。
- 同一源重定向、Authorization/CSRF 请求头和每个预览独立的内存 Cookie 会话。
- 已有 PAKE 授权与 A256GCM 密文通道；支持已协商的 WebRTC 直连，失败回退原请求密文。
  所有网页请求都使用现有持久命令去重，不自动重新执行无法确定结果的提交。
- 刷新按钮发起当前地址的 GET，避免 WebView 原生刷新悄悄重发 POST。
- 系统中文字体异常时自动补字：只有检测到两个不同汉字被 `system-ui` 或
  `-apple-system` 渲染成相同的非空缺字图案，才在对应字体位置加入 App 内置的
  Noto CJK 回退。健康或无法确认的环境保持原样，无需逐个修改网页。
  保留排在系统字体之前的站点字体、拉丁字体、字号、粗细、布局和 `!important`。
  支持文档样式表、内联样式、媒体规则、动态节点及 CSSOM 更新。

字体兼容脚本和字体通过手机渲染器的 `/_relayune/compat/` 保留路径提供，只允许
携带当前预览 Cookie 的 GET/HEAD；不请求外部字体服务，也不经过电脑或中转服务器。
字体沿用 App 已有的开源字体及许可证，不额外扩大安装包的字体体积。

## 边界

预览绑定首次打开的协议、主机和端口，不能转发其他电脑端口、LAN 或公网地址。
站点需要的资源须在该源提供；外部 CDN、跨源 API、WebSocket、SSE、worker、iframe、
第三方登录跳转、摄像头等设备能力不支持。HTTPS 不绕过自签名或无效证书。
相对地址自然保留；HTML/CSS/JS 内当前源的字面绝对 URL 会重写，运行时自行拼接的
电脑绝对地址、严格 CSP/SRI 依赖和特殊浏览器环境应另行验证，不能承诺任意网站兼容。
字体兼容不会放宽站点的 CSP；关闭的 Shadow DOM、自绘 Canvas 字体、缺少的罕见字形
以及不属于上述系统字体缺字模式的问题，不能保证自动修复。
上游需接受 `Accept-Encoding: identity`。文本重写按 UTF-8 处理。

单次请求正文最多 256 KiB，响应最多 12 MiB，上游超时 20 秒。资源过大时明确失败，
不截断成成功响应。Cookie 由内存 jar 代管，不复用电脑浏览器或 Relayune 的登录凭据；
依赖 `document.cookie` 读写登录/CSRF 数据的网页不兼容这一版，应使用表单或响应正文传递。
网页服务自己的写操作照常产生实际效果；超时后应先核对结果，再决定是否手动重试。

关闭预览、应用进入后台或账户/授权变化后停止本机渲染；恢复时需重新打开。
Desktop 能力最长 30 分钟。页面内容与 Cookie 不进入明文 Server 字段或诊断日志。
手机回环 HTTP 仅用于 App 内 WebView 资源渲染，不是跨设备明文 broker。
详见 [安全约束](security-and-architecture.md)。

## 后续演进

目标是加密访问本地 Web 应用。来源隔离、Cookie/登录与流式传输是下一阶段重点，
不以扩充页面字符串替换或站点特例作为通用化路线。阶段和验收门槛见
[Web 应用演进方案](local-web-app-roadmap.md)，本轮实际设备结果见
字体与页面兼容性复验（内部验收档案未随公开源码提供）。

## 验证入口

- `node --test tests/local-web-proxy.test.mjs`：实际 HTTP、正文、来源约束、大小/时间限制、
  客户端隔离、响应加密与 POST 重复投递。
- `node mobile/tool/flutter.mjs test test/network/local_web_gateway_test.dart test/ui/local_web_preview_test.dart`：
  手机资源渲染、Cookie/Origin、超大正文、不可访问目标、提交失败不重发、消息链接入口和旧端提示。
- 协议变更还跑 `tests/webrtc-transport.test.mjs`、`tests/remote-e2ee-relay.test.mjs`、
  `tests/server-blindness.test.mjs` 与附件回归。单元/协议测试不等同于真实手机网页旅程。
