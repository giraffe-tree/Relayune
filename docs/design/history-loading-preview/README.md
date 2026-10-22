# 历史消息 · 墨滴相拥

直接引用手机端 `HistoryInkVisual`，以相同代码验证会话历史加载动效。该预览不连接账户，也不读取聊天记录。

```sh
cd docs/design/history-loading-preview
flutter run -d chrome
# 或生成本地静态预览
flutter build web --release --no-web-resources-cdn --pwa-strategy none
python3 -m http.server 18749 --bind 127.0.0.1 --directory build/web
```

`assets` 和 `lib/mobile` 是指向手机端素材与代码目录的相对符号链接，预览不复制渲染实现。生产入口仍是手机 App，预览入口是 `mobile/tool/history_loading_preview.dart`。

首次历史读取：Relayune 字样 → 8 个柔软墨滴 → 聚合成月 → 保留月蚀方案的水流开口。2.8 秒入场只播放一次，仍在加载时转为 2.4 秒轻微呼吸。更早记录只用 38px 小图标呼吸，已有消息保持显示。历史就绪后由原加载状态直接移除组件，无最短等待时间。

系统减少动态效果时直接显示静态图标；素材失败保留静态品牌标记。移除了原有绿环与底部进度条。App 启动页不在本次改动范围。

相关验证：`mobile/test/widgets/history_ink_visual_test.dart`、`mobile/test/widgets/history_ink_painter_test.dart`、`mobile/test/ui/history_loading_animation_test.dart`。
