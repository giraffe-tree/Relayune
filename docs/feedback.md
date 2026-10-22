# 用户反馈

macOS Desktop、iOS 与 Android 的设置提供「用户反馈」。用户选择体验建议或 Bug，填写至多 2000 字描述，提交前可见本次反馈附带的 App 版本、设备型号和完整操作系统版本。读取不到的字段明确显示「未获取」。不会自动采集设备名称、序列号、广告标识符、聊天内容、工作目录或日志。iOS 显示可识别的机型名称与硬件型号代码，未识别机型保留设备类别及硬件代码，Android 显示厂商与型号，Mac 显示硬件型号代码。

最多添加三张图片，支持预览和移除。客户端将图片转为最长边 2048px、单张不超过 1 MiB 的 JPEG，去除照片元数据和原文件名；服务端再次解码验证、移除元数据。图片以可还原的 Base64 保存，不加密。联系方式均为选填：邮箱自动填入当前登录邮箱，可以修改或清空；微信号手动填写（最多 64 字符）。清空邮箱后服务端不会补回账户邮箱。

反馈直接在 App 内提交；服务端确认写入后才展示反馈编号。请求失败保留界面内容；未修改的重试复用编号及原始反馈。登录用户无须在线的已连接电脑即可反馈。Desktop 使用已有 vault 中的设备凭据鉴权；手机使用邮箱登录会话。

## 存储与读取

反馈通过 HTTPS 在 App 内直接提交，以普通可读字段保存到 MongoDB `relay_feedback`，不做反馈专用加密，不需要配置公钥或持有私钥。聊天会话和凭据原有的加密机制不受影响。

每条记录包含 `_id`（反馈编号）、`category`（`bug` 或 `suggestion`）、`description`、`client`（`desktop` 或 `mobile`）、`environment.app_version`、`environment.device_model`、`environment.os_version`、`created_at`（接收时间）、`contact.email`、`contact.wechat`、`images`（最多三项 `{ mime_type: "image/jpeg", data: "Base64" }）及 `owner`（鉴权主体摘要）。`submission_hash` 仅用于判断重试内容是否一致，正文与联系方式仍是普通可读字段。旧客户端不传联系方式和图片时默认保存空值。

维护者在现有受限 MongoDB 连接中可直接查看：

```javascript
db.relay_feedback.find(
  {},
  { owner: 0, submission_hash: 0, "images.data": 0 }
).sort({ created_at: -1 }).limit(50)
```

图片可在 MongoDB 客户端取出对应记录后还原为 JPEG，例如在有数据库访问权限的 `mongosh` 本地会话中：

```javascript
const feedback = db.relay_feedback.findOne({ _id: "反馈编号" });
feedback.images.forEach((image, index) => {
  require("fs").writeFileSync(`feedback-${index + 1}.jpg`, Buffer.from(image.data, "base64"));
});
```

也可用 `{ _id: "反馈编号" }` 查找某条反馈。没有公开反馈读取 API，普通用户不能读取其他人的反馈；服务端日志不记录反馈正文或请求体。

`_id` 唯一索引提供幂等性。失败重试复用同一份内容和编号，修改内容后生成新编号。`relay_feedback_limits` 使用原子日计数器限制每个鉴权主体每日 20 次新提交，计数记录两天后 TTL 清理；重复的已保存提交不占额度。字段有严格白名单和大小限制，反馈请求上限为 4 MiB + 24,000 bytes，拒绝未知字段或原始日志附件。Desktop 通过 stdin 向 sidecar 传递带图反馈，避免操作系统环境变量大小限制。

本轮仅实现及验证，没有部署服务。上线不需要任何反馈专用密钥配置。当前不提供跨 App 重启的反馈草稿持久化。

## 界面验收

新版手机反馈界面长图（内部验收档案未随公开源码提供） 是实际 Flutter 组件渲染，使用示例邮箱与模拟设备信息；截图附件使用上一版界面截图。布局参考 [Linear 的支持表单](https://linear.app/contact/support) 的集中描述与附件区域，以及 [Raycast 的反馈入口](https://manual.raycast.com/contact-support) 的分类方式。提交按钮固定在底部，描述和图片一组，选填联系方式一组，设备明细直接可见并随页面滚动。

已验证图片上限、移除后补选、邮箱自动填入/清空/校验、联系方式与图片的失败保留和幂等重试、图片压缩及元数据移除、320px 与 1.3 倍字号布局。桌面 TypeScript/Rust 检查及 50 项相关测试通过，服务端六项反馈测试及 CJS 打包通过。全项目 TypeScript 检查被已有的 `app/workbench-page.tsx` 中 `AgentProvider` / `ProjectProvider` 不兼容阻挡。本轮未重新安装原生 App，未完成桌面原生视觉验收，未部署。


## macOS 主动上报退出诊断

「帮助与诊断 → 上报退出问题」打开 Bug 反馈并选中「附带退出诊断」；普通用户反馈默认不选中。
用户可以展开查看完整诊断摘要或取消附带，只有点击提交后才会发送。Relay 主进程离线不影响提交；
沿用现有 HTTPS 反馈鉴权，未登录或凭据失效时仍不能提交。提交失败保留已预览的快照、描述和反馈编号，
原样重试不会生成重复记录。

本地生命周期日志新增白名单启动阶段、进程运行毫秒数、fatal 类型、应用正常退出标记；保留退出码、
信号和自动恢复记录。Node fatal monitor 仅观察，不吞掉异常或更改退出行为。
日志采用 0600 权限，每文件约 1 MiB，保留当前与一份轮转文件，重启后可读取。
报告取最近 7 天可用记录，优先保留失败事件，最多 3800 UTF-8 bytes，显示条数及是否裁剪。
不会上报原始 stdout/stderr、异常堆栈、进程 PID、路径、主机名称、设备或会话标识、聊天内容、凭据。
报告内 run 编号仅为本次报告临时分组，不可用作稳定设备标识。

为兼容已有服务，用户选择的摘要随反馈描述提交，标记为 `--- User-selected exit diagnostics ---`，
无需新增服务端字段或部署。可按反馈编号直接读取 MongoDB description 分析。
描述与摘要总计仍遵守 8000-byte 限制，超限明确提示缩短描述，不静默截断用户输入或诊断。
日志缺失或读取失败时不默认附带内容，并允许提交普通反馈。原始系统 crash report 不在此上报范围内。
