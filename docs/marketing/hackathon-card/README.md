# Relayune 黑客松宣传卡

这是一张适合在黑客松现场发放的双面横版卡片。核心信息来自 Relayune 官网：
“离开电脑，任务不必停下。”卡片不把 Relayune 讲成远程桌面，而是强调手机接回
本机 Agent 任务、处理回复与审批。

## 印刷规格

- 成品：90 × 54 mm；
- 出血：四边各 3 mm；PDF 页面尺寸为 96 × 60 mm；
- PDF 第 1 页为正面，第 2 页为背面；
- 建议纸张：300–350g 哑粉纸或高白无涂布纸；
- 印刷时使用 100% 原始尺寸，不要选择“适合页面”；
- 深色正面建议先让印厂打样，确认暗部纸纹和 Lunar Mint 的表现。

运行生成器后，印刷文件写入 `output/pdf/relayune-hackathon-card-90x54mm-bleed.pdf`。

## 稳定社群入口

卡片二维码固定指向 `https://relayune.giraffetree.cn/community/`，不再直接印刷会定期失效的
微信群码。以后微信群码更新时只需更新社群网页，已经印刷的卡片可以继续使用。

社群页当前使用 `public/community/wechat-group-qr-2026-09-10.png`。替换步骤：

1. 在微信中重新导出最新群二维码；
2. 裁成正方形，只保留完整二维码，并在四周保留白色静区；
3. 把新文件放进 `public/community/`，使用带有效期的文件名；
4. 修改 `app/community/page.tsx` 中的 `GROUP_QR_IMAGE` 与有效期文案；
5. 重新构建和部署网页，并用微信长按识别验证。

卡片上的 `assets/community-page-qr.png` 只编码稳定社群页地址。除非社群页 URL 发生变化，
不要替换它。

## 重新生成

使用自行准备的 Python 环境运行生成器；所需第三方库以生成器导入为准，本仓库未提供私有文档运行时：

```bash
python3 scripts/generate-hackathon-card.py
```

生成器会输出双页印刷 PDF、正反面 300 DPI PNG 和一张组合预览图。PDF 写入
`MediaBox`、`BleedBox` 与 `TrimBox`，便于印厂识别成品范围。

## 视觉来源

- 正式标志：Relayune Eclipse Relay 品牌资产；
- 色彩：Deep Night `#0B1220`、Moon White `#F6F8F5`、Lunar Mint `#69E1D2`；
- 背景纹理：由 `scripts/generate-night-sea.mjs` 的原创 SVG 曲线生成；不含外部图片、字体或生成式图像，运行该脚本可重新生成；
- 演示资产：公开准备副本的工作台截图使用明确标注的合成演示素材，不作为真实任务、设备或验收证据；
- 所有文字、Logo 与二维码均由生成器确定性排版，避免生成式图像造成错字或扫码失败。
