# Relayune 品牌资源索引

本目录保存 Relayune 项目的品牌设计源文件与生成入口，适用项目根目录的
MIT 许可；第三方 Agent 标识不在本目录，仍按其原许可分发。
项目许可不授予 Relayune 名称或标志的商标权，也不表示维护者认可第三方产品。
介绍兼容性、引用项目或分发修改版时，应准确说明来源与修改，避免让用户误认为是官方发行。
这些说明不限制适用法律允许的商标指称使用。完整许可边界见
[许可说明](../../../docs/licensing.md)。

## 品牌使用边界

维护者于 2026-10-22 确认：**代码和品牌图形文件继续采用 MIT，名称与 Logo 的品牌使用权单独保留。**
不额外添加“代码禁止商用”或“素材禁止商用”的版权条件。

- 可以按 MIT 商业使用、修改和分发代码及图形文件，并保留适用的版权与许可声明。
- 可以真实介绍 Relayune、注明来源或说明兼容性；使用官方原版自托管不要求删除原有标志。
- 第三方经营自己的产品或服务时，不能把 MIT 许可当作以 Relayune 名称或 Logo 作为其品牌的授权；
  如需这种品牌使用，应事先取得维护者许可。推荐为独立产品使用自己的名称与标志。
- 不得冒充官方发行、官网或支持渠道，不得暗示维护者认可、担保或运营第三方服务。
- 本品牌规则不撤回或缩小 MIT 已授予的版权许可，也不限制法律允许的合理指称使用。

These files remain MIT-licensed, including for commercial use. The MIT copyright
license does not additionally authorize using the Relayune name or logo as a
third-party product or service brand. Describe origin and compatibility accurately;
do not impersonate the official project or imply endorsement. This policy does not
restrict the copyright permissions granted by MIT or lawful referential use.

正式图标为 **Eclipse Relay / 密道月相**。完整语义、动效规则和平台映射见
[品牌系统文档](../../../docs/brand-system.md)。

## 正式母版

| 文件 | 类型 | 用途 |
| --- | --- | --- |
| `relayune-eclipse-mark.svg` | 64×64、透明、`currentColor` | 单色 glyph、内联 SVG、文档和新平台适配 |
| `relayune-eclipse-static.svg` | 1024×1024、透明圆角 | Desktop/macOS/Windows 应用图标生成源 |
| `relayune-eclipse-template.svg` | 64×64、透明单色 | macOS 菜单栏、Windows 托盘模板 |
| `relayune-eclipse-flow.svg` | 512×512、循环动效 | Web 主品牌、Desktop/Flutter 动效参考 |
| `relayune-eclipse-breathe.svg` | 512×512、循环动效 | 等待、连接中、安静品牌展示 |
| `relayune-eclipse-wait.svg` | 512×512、循环动效 | 无确定进度的短暂等待、惯性月相转子 |
| `relayune-eclipse-confirm.svg` | 512×512、阶段动效 | 配对成功、可信连接确认 |
| `relayune-og.svg` | 1680×941 | Open Graph 原图，生成 `public/og.png` |

四个动态 SVG 都包含 `prefers-reduced-motion: reduce` 降级。动效不是商标结构的一部分；
任何静态截图、favicon、安装包和系统托盘都必须只依赖静态轮廓识别。

## 兼容入口

旧 URL 会继续显示新标志，避免已发布页面或缓存引用失效：

- `relayune-rune.svg` → Flow；
- `relayune-rune-static.svg` → Static；
- `relayune-rune-template.svg` → Template；
- `relayune-orbit.svg` → Breathe；
- `relayune-path.svg` → Confirm。

新代码不得继续引用这些兼容名称。

## 生成平台资源

在仓库根目录运行：

```bash
npm run brand:generate
```

该命令从正式 SVG 母版生成 Web `og.png` / Apple touch icon、iOS AppIcon、Android
mipmap，以及 Desktop 的 PNG / ICNS / ICO / trayTemplate。不要手工修改生成后的位图。

候选方案保存在 `concepts/`；A 已选定，B/C 只保留为设计决策记录，不得用于产品界面。
