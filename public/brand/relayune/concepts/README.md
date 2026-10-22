# Relayune 图标提案

> 选择状态：**方向 A · Eclipse Relay / 密道月相已成为正式品牌标志。**
> B/C 仅保留为设计决策记录，不得用于产品界面。正式资源见
> [`../README.md`](../README.md)。

这组提案把 Relayune 的名称与产品事实拆成三个独立方向。三者均以 SVG 为母版，保留了应用图标圆角底板，同时确保核心 glyph 可以继续派生为纯色托盘图标与 favicon。

## 01 · Eclipse Relay / 密道月相

月盘被一条贯穿边缘的负空间通道分成两个端点。通道代表只负责转发密文、无法看见明文的 Server；两侧月相代表浏览器与 Desktop Relay 两个明文端点。

- 优点：与 Relayune 的 E2EE 架构绑定最深，单色与 16px 表现最好。
- 风险：曲线过度对称时可能接近阴阳图形，因此通道采用不对称的前进曲线，并且两端贯穿月盘。
- 推荐场景：主品牌、favicon、桌面菜单栏模板图标。

## 02 · Phase Relay / 相位中继

两个相向月牙是浏览器与桌面端口，中间斜向胶囊是正在完成交接的信号棒。静态轮廓有明确方向，动态版本可以只让信号棒完成一次 handoff。

- 优点：动势最强，工具感与 AI-native 气质最鲜明。
- 风险：16px 必须使用单色光学校正版，去掉渐变和动效。
- 推荐场景：桌面 App、启动动画、连接状态。

## 03 · Moon Harbor / 月湾

左右圆弧在上下闭合为一个港湾或拥抱，中心暖色月牙代表双方确认后形成的可信关系。它把技术叙事转换成“放心连接”的用户收益。

- 优点：最亲和，彩色品牌延展空间最大。
- 风险：彩色版最低建议 24px；托盘与 favicon 使用单色版。
- 推荐场景：面向消费者的 App、商店图标、营销与 onboarding。

## AI-native 参考原则

本次只借鉴品牌系统原则，不复用任何现有商标的轮廓：

- [OpenAI Design Guidelines](https://openai.com/brand/)：在人性化曲线与技术精度之间保持平衡，并重视固定比例与留白。
- [Cursor Brand](https://cursor.com/en-US/brand)：为同一稳定骨架准备 2D、2.5D、3D 与不同明暗版本。
- [Runway Brand Guidelines](https://runwayml.com/brand-guidelines)：symbol 与 wordmark 分开，小尺寸仍必须是独立识别单元。
- [ElevenLabs Brand](https://elevenlabs.io/brand)：用一个极简符号同时承载名称和产品事实。
- [Anthropic Company](https://www.anthropic.com/company)：克制、可靠、直接，优先采用最简单且有效的表达。
- [Perplexity](https://www.perplexity.ai/hub)：几何纪律、稳定中心与负空间，但本提案避开其星形和书页构造。
- [Suno About](https://suno.com/about) 与 [Hugging Face Brand](https://huggingface.co/brand)：让 AI 作为工具而非视觉陈词，并保留亲和、小尺寸可识别的人格感。

## 文件

- `01-eclipse-relay.svg`：方向 A 应用图标。
- `02-phase-relay.svg`：方向 B 应用图标。
- `03-moon-harbor.svg`：方向 C 应用图标。
- `marks/*-mark.svg`：三个方向的透明、单色 `currentColor` 核心 glyph 母版。
- `relayune-icon-directions.svg`：三方向对比板，含深浅背景的单色示意。

当前生产图标未被替换。选定方向后再扩展静态主标、菜单栏模板、动画版、favicon、macOS / Windows / iOS / Android 导出资产，并更新应用内联 SVG。
