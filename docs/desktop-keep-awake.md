# macOS 一键防止自动锁屏

Relayune 菜单栏 **保持唤醒 → 保持唤醒时，不自动锁屏** 提供可勾选的附加选项；设置 → 通用同步同一个偏好。顶层只保留保持唤醒入口及实际状态的小圆点，子菜单保留标准勾选标记，点击后正常收起。

防锁屏跟随保持唤醒模式生效：关闭时两种断言都释放；仅插电时插电持有、拔电释放；始终时包含电池供电。勾选防锁屏时同时保持显示器亮着，不勾选时仅保持电脑运行、允许显示器正常闲置。关闭唤醒或拔电不会清除勾选偏好，再次唤醒时恢复该选择。关闭窗口后继续生效，退出应用释放断言，重启后按保存的模式与勾选状态恢复。此前防锁屏独立强制唤醒的行为已改为此模式联动；已有偏好字段沿用，不自动更改用户所选模式。

使用公开 IOKit `PreventUserIdleDisplaySleep` 和 `PreventUserIdleSystemSleep` 断言；不修改系统密码、屏保超时或 pmset，不模拟键鼠活动。不自动解锁已锁定的屏幕，不阻止手动锁屏、合盖或手动睡眠，也不覆盖设备管理策略。因此产品文案不承诺所有情况下“永不锁屏”。

本地偏好仍在 `keep-awake.json`。旧版字符串模式可自动读取，保存为包含 `mode` 和 `prevent_lock` 的对象。写入失败保留原有偏好和断言；断言失败显示错误，原生定时器重试。菜单按实际持有状态展示“未生效”，避免仅保存偏好就宣称已开启。

## 初版验证记录（2026-10-09，独立防锁屏行为）

- Rust 相关 10 项测试通过：偏好兼容与重启恢复、与插电模式独立、失败后重试、保存失败不改变状态、断言释放及菜单的全部语言。
- 实际 macOS 测试进程从仅系统唤醒切换到防锁屏，`pmset -g assertions` 验证同时持有两种断言，无 `UserIsActive`；关闭后自身两种断言清除。
- Desktop TypeScript 与 Vite 构建通过；界面旅程、API 和十种语言覆盖检查已包含三个新增文案键。
- 最终产品提交 `81317e69` 构建的 Developer ID 签名 App 已覆盖安装 `/Applications/Relayune.app`。App/Core 校验及嵌入 Relay 启动检查通过；实际界面显示“已连接／这台 Mac 已就绪”。
- 设置页实际点击：关闭 → 开启，复选框为开启，系统确认 `PreventUserIdleDisplaySleep`；关闭窗口后断言仍在，退出后自身断言全清；重新启动自动恢复选择及两种断言。
- 再次点击关闭，显示断言清除，原有 `always` 系统唤醒保留。验收结束恢复防锁屏关闭，应用停留在开关所在设置页。
- 重启后核对 Codex/Claude/Kimi/OpenCode/ZCode 已登录；Mcode 0.6.3 显示尚未登录，未进行额外登录。
- 设置页交互已验证；菜单栏直接点击和长时间闲置锁屏未单独实测，接口断言与短时生命周期验证不代表这些场景通过。
- 本次没有发送手机思考探针或操作 iOS 设备；此前手机思考状态未闭环项仍保留。

## Rust 原生 caffeinate -di 路径（2026-10-09 后续）

防闲置锁定开关使用与 Apple `caffeinate -di` 相同的两种断言和 `IOPMAssertionCreateWithDescription` 创建路径：`PreventUserIdleSystemSleep` 与 `PreventUserIdleDisplaySleep`，无时限（timeout 0），关闭时显式释放。Rust 直接持有断言，不启动 caffeinate 子进程。没有 `-u` 对应的 UserIsActive、键鼠模拟、密码策略或亮度修改。

每两秒通过 `IOPMAssertionCopyProperties` 核对断言的类型、名称和等级。正常断言保持原 ID，不周期性释放重建；失效断言恢复，查询失败保留旧 ID、报告未确认，避免重复创建。NULL 返回不直接等于不存在：使用同一 ID 刷新已请求的等级，只有失效 ID 返回才忘记旧 ID。实机 15.7.3 的已释放 ID 返回 `kIOReturnBadArgument`，Apple powerd 的 `lookupAssertion` 亦使用该值；兼容公开文档的 NotFound 和异步实现的 Invalid。此行为已通过真实释放、重建和无重复断言测试。

状态中的 `lock_prevention_active` 表示两种断言都已向电源管理接口核实，不是实际会话解锁状态。关闭失败时显示“关闭未完成”，继续重试。

12 项 Rust 相关测试与52项桌面检查通过，包含实际 macOS 双断言、丢失恢复、查询失败无重复创建、关闭失败及偏好恢复。第一次真实恢复测试暴露已释放 ID 的返回值差异，修复后重跑通过；失败记录保留在本机测试日志。

用户报告的独立测试：macOS 15.7.3，屏保60秒、密码宽限5秒，`caffeinate -di` 下闲置约160秒未锁，停止约41秒后锁定。这是用户提供的该环境实机证据，不视为 Relayune Rust 安装版的同条件测试。后续验收预检读到当前屏保 idleTime=0、screenLock=off，因此不能在当前条件下宣称完成60秒+5秒防锁屏对照。

Apple 源码：[caffeinate 参数映射和创建](https://github.com/apple-oss-distributions/PowerManagement/blob/main/caffeinate/caffeinate.c)、[IOKit 创建接口](https://github.com/apple-oss-distributions/IOKitUser/blob/main/pwr_mgt.subproj/IOPMAssertions.c)、[powerd ID 查找](https://github.com/apple-oss-distributions/PowerManagement/blob/main/pmconfigd/PMAssertions.c)。

最终产品提交 `afedcfb0` 的 Developer ID 签名 App 已安装到 `/Applications/Relayune.app`，App/Core 校验、嵌入 Core 启动检查与实际“已连接／这台 Mac 已就绪”通过。六种 Agent 均显示已登录。设置页的开关关闭时释放显示器断言且保留原有 always 系统断言，开启后恢复两种；新安装启动也自动恢复开启。验收前后偏好均为 `mode=always, prevent_lock=true`。未修改系统锁屏策略、亮度、屏保配置，未启动 caffeinate 子进程。

原生 UI 的60秒屏保＋5秒密码宽限对照尚未执行；当前系统配置仍为 screenLock=off、屏保 idleTime=0。不能把本轮安装和断言验收当成该条件下的防锁屏验收。

## 菜单状态标识（2026-10-09）

产品提交 `bedf76bf` 为原生菜单增加明确状态文字和小圆点：已确认开启为绿色，未开启为灰色，未生效、关闭未完成及等待电源为橙色。防锁屏项显示“已开启／未开启”，保持唤醒项同时显示所选模式和实际状态。唤醒模式关闭但防锁屏正在保持电脑运行时，标明“随防锁屏开启”。颜色放在原生状态标记位置，保留菜单键盘操作与开关语义，无额外图标列。

13项 Rust 相关测试与49项桌面检查通过，已有原生菜单探针可编译。独立预览调用同一生产绘制代码，CUA核对开启／未开启文字；AppKit状态图像回读确认绿、灰、橙图像均应用到on/off位置，尺寸14pt、小点约6pt且非模板，保留选中态颜色。截图工具只捕获主窗口，未取得浮动菜单像素截图，因此不宣称完成浮动菜单截图验收。

签名App安装到 `/Applications/Relayune.app`，App/Core签名、Core启动检查通过；实际显示已连接、这台Mac已就绪，所需Codex/Claude/Kimi已登录。本轮未改变用户电源模式或防锁屏偏好。

## 回滚菜单保持展开（2026-10-09）

按用户要求回滚 `bdc9e36b`、`1d90afa9` 的自定义设置控件，恢复标准原生菜单：点击防锁屏项或选择唤醒模式后菜单收起。状态文字、彩色小圆点、原有设置回调及 Rust 电源断言逻辑保留。13 项相关 Rust 测试、原生菜单/辅助功能探针通过。

产品提交 `53f96a6d` 已完成 Developer ID 签名构建，覆盖安装 `/Applications/Relayune.app`；安装后 App/Core 签名、嵌入 Core 启动检查及实际“已连接／这台 Mac 已就绪”通过，Codex/Claude/Kimi 显示已登录，用户电源偏好未变。本轮验证标准原生菜单结构与辅助功能，未直接点击实际菜单栏中的两项设置。

## 防锁屏跟随唤醒模式（2026-10-09）

本轮覆盖关闭、插电/拔电、始终、偏好保留及恢复、电源未知、释放失败后重试；正常未唤醒时不显示“未生效”。显示器断言释放失败仍显示“关闭未完成”，顶层橙色提醒。选项使用标准原生菜单回调和勾选，不恢复已回滚的常驻菜单控件。

13 项相关 Rust 测试、52 项桌面测试及 TypeScript/Cargo 检查通过。实际 macOS 测试进程确认关闭唤醒释放两种断言并保留勾选，再选始终恢复两种。插拔电及电源未知由受控后端覆盖，未实际插拔本机电源。原生菜单探针通过；CUA 在独立原生预览核对新层级、文案与选择后正常收起，该预览不修改真实偏好，不等同于实际菜单栏回调验收。

产品提交 `84dfe718` 的 Developer ID 签名 App 已安装到 `/Applications/Relayune.app`，App/Core 签名及嵌入 Core 启动检查通过。实际“已连接／这台 Mac 已就绪”、Codex/Claude/Kimi 已登录通过。当前用户偏好为 off + prevent_lock=true；新安装启动后与设置页关闭/开启选项后，两种本进程断言均为零，勾选保持且不误报“未生效”。设置页中文文案和排版已检查，验收前后偏好相同。实际菜单栏点击与长时间闲置锁屏对照仍未覆盖。
