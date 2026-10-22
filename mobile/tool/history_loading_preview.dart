// Local visual review of the same widget used by WorkbenchScreen.
// Run from docs/design/history-loading-preview with flutter run -d chrome.
import 'package:flutter/material.dart';
// Also imported through the standalone preview's source symlink.
// ignore: avoid_relative_lib_imports
import '../lib/src/widgets/history_text_light.dart';

void main() => runApp(
  const MaterialApp(
    title: 'Relayune · 历史消息文字光息',
    debugShowCheckedModeBanner: false,
    home: HistoryLoadingPreview(),
  ),
);

class HistoryLoadingPreview extends StatefulWidget {
  const HistoryLoadingPreview({super.key});
  @override
  State<HistoryLoadingPreview> createState() => _HistoryLoadingPreviewState();
}

class _HistoryLoadingPreviewState extends State<HistoryLoadingPreview> {
  int _take = 0;
  bool _loading = true;
  bool _compact = false;
  bool _reduced = false;

  @override
  Widget build(BuildContext context) => Theme(
    data: ThemeData.dark(useMaterial3: true).copyWith(
      scaffoldBackgroundColor: const Color(0xFF0D0D0D),
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFFE1E5E8),
        brightness: Brightness.dark,
      ),
    ),
    child: Scaffold(
      appBar: AppBar(
        title: const Text('历史消息 · 字间呼吸 · 光息'),
        backgroundColor: const Color(0xFF111111),
      ),
      body: SafeArea(
        child: Column(
          children: [
            const Padding(
              padding: EdgeInsets.all(20),
              child: Text(
                'Relayune 文字缓慢亮起、淡下\n实际 App 组件 · 每 4 秒一次呼吸，加载完成即结束',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white54, height: 1.7),
              ),
            ),
            Expanded(
              child: Center(
                child: MediaQuery(
                  data: MediaQuery.of(
                    context,
                  ).copyWith(disableAnimations: _reduced),
                  child: !_loading
                      ? const Text('消息已就绪', style: TextStyle(fontSize: 20))
                      : _compact
                      ? Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            HistoryTextLight(
                              key: ValueKey(_take),
                              compact: true,
                            ),
                            const SizedBox(width: 10),
                            const Text('正在读取更早记录…'),
                          ],
                        )
                      : Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            HistoryTextLight(key: ValueKey(_take)),
                            const SizedBox(height: 22),
                            const Text(
                              '正在读取历史消息',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 7),
                            const Padding(
                              padding: EdgeInsets.symmetric(horizontal: 18),
                              child: Text(
                                '历史只在打开会话后加载，每次最多 100 条',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  color: Colors.white38,
                                  fontSize: 12,
                                  height: 1.5,
                                ),
                              ),
                            ),
                          ],
                        ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Wrap(
                alignment: WrapAlignment.center,
                spacing: 10,
                runSpacing: 10,
                children: [
                  FilledButton.icon(
                    onPressed: () => setState(() {
                      _take++;
                      _loading = true;
                    }),
                    icon: const Icon(Icons.replay),
                    label: const Text('重播'),
                  ),
                  OutlinedButton(
                    onPressed: () => setState(() => _loading = !_loading),
                    child: Text(_loading ? '模拟读取完成' : '再次读取'),
                  ),
                  FilterChip(
                    label: const Text('更早记录'),
                    selected: _compact,
                    onSelected: (v) => setState(() {
                      _compact = v;
                      _take++;
                    }),
                  ),
                  FilterChip(
                    label: const Text('减少动态效果'),
                    selected: _reduced,
                    onSelected: (v) => setState(() => _reduced = v),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
