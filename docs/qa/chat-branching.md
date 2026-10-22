# 回复分支到新聊天

手机只在已完成的 Assistant 回复旁提供“分支到新聊天”。会话菜单没有额外入口，界面不区分 fork / clone。新聊天继承选中回复所在完整轮次及此前上下文，后面的轮次不带入；创建本身不发送新的用户提示。

默认继续使用原项目目录，共用当前项目文件。只有 Agent 支持切换目录且源目录有有效 Git 提交时，点击入口才显示“使用原项目目录 / 创建新 worktree”两个直接操作。worktree 从创建时的当前提交建立 detached checkout，保留会话的仓库子目录，不复制未提交文件，不恢复历史文件状态。

## 能力边界

| Agent | 回复位置 | 目录选择 |
| --- | --- | --- |
| Codex | 已完成轮次的最终回复，含较早轮次 | 原目录 / Git worktree |
| Pi | 已完成原生 Assistant 结尾，继承该轮工具上下文 | 原目录 / Git worktree |
| Kimi Code | 原生完整历史的最后完成回复，源会话空闲 | 原目录 |
| MiniMax Code、OpenCode | 能确认本进程观察到的原生完成状态，且完整历史末尾仍与其一致的最后回复 | 原目录 |
| Claude Code、Claude Cowork、ZCode | 不提供入口 | — |

ACP 的全会话 fork 不提供旧回复截断；实时显示的临时消息 ID 要等原生历史回填才能作为分支点。隐藏的图片输入、工具活动或后续轮次也属于原生历史末尾，不能把“最后一个有文字的回复”当成原生末尾。无法证明资格时隐藏或拒绝，不能拼接展示文本伪装为原生上下文。

Pi 适配包含 1.0.4 和 0.85.1 的兼容路径；各版本的真实 CLI 行为需要在目标环境独立验证。Codex 对无法确认抑制自动继续的 active native goal 源拒绝分支。

Codex 原生分支 rollout 先写新会话的 `session_meta`，随后复制包含祖先 `session_meta` 的历史。读取器以首条头确认文件所有者，仅接受原生 `forked_from_id` 声明的祖先链；继承的头不能覆盖所有者。错误的首条头或未声明祖先仍拒绝，不能为分支绕过历史归属校验。

## 传输与失败

复用 `session.fork` 加密命令、现有变更执行收据和 Agent adapter。目录探测与 Git 操作都在电脑端执行；Server 不读取项目路径、回复内容或截止点。成功响应绑定新会话 ID 和原会话 ID；手机进入新聊天后读取其真实继承历史。

断线时保留灰色入口并提示“连接电脑后可分支”。不确定投递复用原请求 ID 和密文；未知原生执行结果不自动重做。明确选择 worktree 后失败不回退原目录；确定失败只尝试清理本次创建且仍无用户文件变化的目录，未知结果保留目录。没有新增分支图、会话历史库、工作区实体或运行时依赖。

## 验证入口

- Node 22：`node --test tests/session-native-fork.test.mjs tests/session-fork-relay.test.mjs tests/session-worktree.test.mjs`。
- Flutter：`node mobile/tool/flutter.mjs test test/state/reply_branch_test.dart test/ui/reply_branch_test.dart`。
- 原生 CLI 验证使用临时项目、隔离配置和本地确定性模型；验收范围与真实模型/生产 UI 分开记录。
- iOS 构建安装使用 `manage-ios-simulator-workflow` 和现有项目 lease；从最终提交构建。macOS 使用现有 Developer ID 签名本地构建，不授权公证或发布。
- 页面验收用独立 Git 项目和两轮不同回复，从第一轮分别选择原目录及 worktree：新聊天只显示第一轮并可继续对话，源聊天仍保留两轮；原目录保留未提交文件，worktree 读取当前提交中的文件。创建本身不启动模型。

## 验收边界

历史真实 CLI、个人任务、设备及手机实操记录保存在私有维护仓库，内部验收档案未随公开源码提供。上述命令是复验入口，不代表本副本已经完成真实模型、手机、生产或跨版本验收。应分别记录协议测试、真实 CLI 和实际页面旅程的结果与未覆盖项。
