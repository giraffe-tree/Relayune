# Relayune 六种原生代码动效 · 独立预览

本目录是独立 Flutter 预览工程。用户确认的「墨滴相拥」及稳定尖角收尾已移入手机 App 的 `mobile/lib/src/widgets/startup_morph*.dart`，其余五种继续保留为备选。绘制逻辑为 Dart / Canvas，浏览器预览不播放视频。手机端用逐帧对比测试保证与选定预览一致。

当前预览是「月蚀前奏」第二轮：仅重新设计文字成圆的前半段，六种共用已认可的水流切割后半段。

1. 字母滚月：字母错峰倾倒、滚拢。
2. 弯字成环：整行文字弯成圆环，内缘闭合。
3. 卷带入月：文字成为宽软带，盘卷填圆。
4. 墨滴相拥：字母润成墨滴，接触融合。
5. 潮汐包合：两端字流相向卷起，包成满月。
6. 柔弹成圆：先收成软枕，轻弹归圆。

[艺术家参考与分镜](INSPIRATION.md) 记录来源及本次设计推演。页面提供「播放原版对照」，可直接比较旧的月蚀显影。上一轮六种绘制器仍保留在代码里供回归检查。

预览支持选择、重播、半速、拖动时间轴，以及成形后的加载呼吸。统一 3.2 秒时间轴供比较，正式入场时长待选定效果后再调。未加载开关仅演示图标延续；没有连接真实启动任务。

收尾修正：六种前奏共用固定 SVG 半径和通道宽度，去掉末段“外扩圆盘、收窄通道、再裁回位图”的补偿，完成后继续画同一套矢量轮廓。加载时仅在 94%–100% 不透明度之间呼吸，不缩放图标。默认展示「墨滴相拥」；原版对照保留旧行为供比较。

```sh
flutter pub get
flutter test
flutter build web --release --no-web-resources-cdn --pwa-strategy none
python3 -m http.server 18748 --bind 127.0.0.1 --directory build/web
```

打开 http://127.0.0.1:18748 。`lib/main.dart` 为预览界面；`lib/startup_morph.dart` 为统一绘制入口，`eclipse_formation_*.dart` 实现新的六种前奏，`startup_morph_surfaces.dart` 保留原版水流收尾。首尾透明轮廓图和预计算对应点来自现有 App 的 `scripts/generate-startup-morph.mjs`，不是逐帧动画素材。

`flutter test` 检查六种效果的首尾轮廓、中间差异、切换/重播/时间轴和窄屏布局。水流在旧补偿开始前（进度 .53–.86）与原版逐像素相同；切割结束（.92）至末帧轮廓逐像素不变，加载仅改变透明度，并与正式图标核对边缘覆盖。另检查成圆交接连续性，导出 `/tmp/relayune-eclipse-formations.png` 和放大的 `/tmp/relayune-eclipse-tip-check.png` 供逐帧检查。浏览器渲染检查不等于手机实机性能验收。
