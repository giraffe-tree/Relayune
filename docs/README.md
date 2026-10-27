# Relayune 文档索引

这里收录 Relayune 的运行、架构、安全与开发说明。测试文档中的历史测量结论和方法说明，
不代表当前版本已在全部平台重新验收；实际验证范围见[公开前检查清单](publication-checklist.md)。

## 开始使用

- [普通用户使用指南](getting-started.md) · [English walkthrough](getting-started.en.md)：安装、登录、配对、任务与排障。
- [自托管与客户端连接](self-hosting.md)：用户名初始化、HTTPS、实例选择、升级与恢复。
- [项目首页](../README.md)：产品介绍、安装入口和源码开发。

## 架构与运行

- [架构与安全约束](security-and-architecture.md)：协议、存储、凭据和日志边界。
- [端到端加密威胁模型](e2ee-threat-model.md)：明文端点、密钥与 Server 元数据边界。
- [密码学安全复核](crypto-security-review.md)：当前源码复核证据、主动恶意服务端边界及待专业审计事项；不代表已完成独立审计。
- [Server 运行说明](server-production.md)：Node + MongoDB、反向代理与运行配置。
- [官方服务与客户端升级准备](official-deployment.md)：官方环境模板、不兼容旧客户端的首轮升级顺序与验收边界。
- [Claude Cowork 接入](claude-cowork-integration.md)：本地任务发现、恢复、审批和模型配置。
- [Windows Desktop 开发与验收](windows-desktop-development.md)。
- [移动端说明](../mobile/README.md)与 [Desktop 说明](../desktop/README.md)。

## 开发与验证

- [开源与首轮发行计划](open-source-roadmap.md)：维护者已确定范围、当前缺口、任务顺序与真实设备验收条件。
- [功能树与公开源码、用户使用取舍](feature-tree-and-scope-review.md)：当前功能、平台差异与建议保留、删除、修改的范围。
- [核心使用路径与测试树](qa/core-user-journeys.md)。
- [核心使用场景清单](qa/core-user-journey-cases.md)。
- [移动端体验测试思维导图](qa/mobile-experience-test-mindmap.md)：与测试清单相互校验。
- [Desktop 用户旅程 QA](desktop-user-journey-qa.md)。
- [Agent 接入测试经验](qa/agent-integration-testing-lessons.md)。
- [性能测量方法](performance/README.md)与[报告模板](performance/report-template.md)。
- [Web 侧边栏与账户菜单测试树](qa/web-sidebar-account-test-tree.md)。
- [持续角色实访与产品评审](qa/continuous-product-role-audit.md)。
- [多语种适配规范](internationalization.md)。

## 资产与维护

- [许可与第三方素材](licensing.md)、[素材来源清单](asset-provenance.json)及[依赖许可清单](dependency-licenses.json)。
- [依赖安全审查与剩余公告](dependency-security.md)：修复版本、开发链及平台边界。
- [自托管与贡献者构建](self-hosting.md)：配置入口、可选外部服务和未验证范围。
- [GitHub 公开准备与验收](github-publication.md)：候选内容和敏感信息校验、可重复检查与验证边界。
- [贡献指南](../CONTRIBUTING.md)及[私密漏洞报告](../SECURITY.md)。
- [品牌系统](brand-system.md)：品牌母版及生成入口。
- [Community 图片工作流](marketing/community-assets/README.md)：官网与 App 当前使用的图片源文件。
- [宣传卡生成说明](marketing/hackathon-card/README.md)：按需生成输出，生成物不随源码分发。
- [启动动效预览](design/startup-effects-preview/README.md)：包含移动端测试引用的实现。
- [历史加载预览](design/history-loading-preview/README.md)：移动端开发工具的独立预览入口。

自托管、签名和发布说明中的域名、应用身份及路径需要按自己的环境配置。
使用自己的服务凭据与签名密钥，验证后再用于部署或分发。
