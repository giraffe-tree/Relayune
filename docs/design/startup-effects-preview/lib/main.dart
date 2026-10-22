import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import 'startup_effect.dart';
import 'eclipse_formation.dart';
import 'startup_morph.dart';

void main() => runApp(const MotionStudies());

class MotionStudies extends StatelessWidget {
  const MotionStudies({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Relayune · 月蚀前奏 6 方案',
    theme: ThemeData(
      brightness: Brightness.dark,
      scaffoldBackgroundColor: const Color(0xFF0B1220),
      colorScheme: const ColorScheme.dark(
        primary: Color(0xFFF6F8F5),
        onPrimary: Color(0xFF0B1220),
        surface: Color(0xFF111C2B),
        secondary: Color(0xFFF6F8F5),
        secondaryContainer: Color(0xFF253142),
        onSecondaryContainer: Color(0xFFF6F8F5),
      ),
      useMaterial3: true,
    ),
    home: const StudyPage(),
  );
}

class StudyPage extends StatefulWidget {
  const StudyPage({super.key, this.loadMorph = StartupMorphData.load});
  final Future<StartupMorphData> Function() loadMorph;
  @override
  State<StudyPage> createState() => _StudyPageState();
}

class _StudyPageState extends State<StudyPage> with TickerProviderStateMixin {
  late final _entrance =
      AnimationController(
        vsync: this,
        duration: const Duration(milliseconds: 3200),
      )..addStatusListener((status) {
        if (status == AnimationStatus.completed && _waiting && !_reduced)
          _idle.repeat();
      });
  late final _idle = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  );
  StartupMorphData? _data;
  Float32List? _positions;
  EclipseFormation _formation = EclipseFormation.drops;
  bool _original = false;
  bool _slow = false;
  bool _waiting = true;
  bool _failed = false;
  bool _reduced = false;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  Future<void> _load() async {
    try {
      final data = await widget.loadMorph();
      if (!mounted) return;
      setState(() {
        _data = data;
        _positions = Float32List(data.count * 2);
      });
      if (_reduced) {
        _entrance.value = 1;
      } else {
        _entrance.forward();
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduced = MediaQuery.disableAnimationsOf(context);
    if (_reduced) {
      _idle.stop();
      _entrance.value = 1;
    }
  }

  void _replay([EclipseFormation? effect]) {
    _idle.stop();
    _idle.value = 0;
    setState(() {
      _formation = effect ?? _formation;
      if (effect != null) _original = false;
      _waiting = true;
    });
    _entrance.duration = Duration(milliseconds: _slow ? 6400 : 3200);
    if (_reduced) {
      _entrance.value = 1;
    } else {
      _entrance.forward(from: 0);
    }
  }

  @override
  void dispose() {
    _entrance.dispose();
    _idle.dispose();
    super.dispose();
  }

  Widget _choices(bool wide) {
    final children = [
      for (final effect in EclipseFormation.values)
        Padding(
          padding: EdgeInsets.only(bottom: wide ? 8 : 0),
          child: OutlinedButton(
            key: ValueKey('effect-${effect.name}'),
            style: OutlinedButton.styleFrom(
              alignment: Alignment.centerLeft,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 17),
              backgroundColor: !_original && _formation == effect
                  ? const Color(0xFF253142)
                  : Colors.transparent,
              side: BorderSide(
                color: !_original && _formation == effect
                    ? const Color(0xFF9AA7B8)
                    : const Color(0xFF293446),
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            onPressed: _data == null ? null : () => _replay(effect),
            child: Row(
              mainAxisSize: wide ? MainAxisSize.max : MainAxisSize.min,
              children: [
                Text(
                  '0${effect.index + 1}',
                  style: const TextStyle(
                    color: Color(0xFF8290A3),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(width: 14),
                Text(effect.zh, style: const TextStyle(fontSize: 15)),
              ],
            ),
          ),
        ),
    ];
    return wide
        ? Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: children,
          )
        : Wrap(spacing: 8, runSpacing: 8, children: children);
  }

  Widget _stage(bool wide) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Container(
        height: wide ? 390 : 280,
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFF293446)),
          borderRadius: BorderRadius.circular(20),
          gradient: const RadialGradient(
            radius: .9,
            colors: [Color(0xFF142032), Color(0xFF0B1220)],
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            const Positioned(
              top: 20,
              left: 22,
              child: Text(
                'Relayune',
                style: TextStyle(fontSize: 12, color: Color(0xFF7D8BA0)),
              ),
            ),
            Positioned(
              top: 20,
              right: 22,
              child: Text(
                _original ? '原版对照' : '0${_formation.index + 1} / 06',
                style: const TextStyle(fontSize: 12, color: Color(0xFF7D8BA0)),
              ),
            ),
            Center(
              child: _data == null
                  ? Text(_failed ? '暂时无法载入，请刷新重试。' : 'Relayune')
                  : RepaintBoundary(
                      child: SizedBox(
                        width: wide ? 600 : 400,
                        height: wide ? 360 : 240,
                        child: CustomPaint(
                          painter: StartupMorphPainter(
                            data: _data!,
                            effect: StartupEffect.eclipse,
                            formation: _original ? null : _formation,
                            entrance: _entrance,
                            idle: _idle,
                            positionsBuffer: _positions!,
                          ),
                        ),
                      ),
                    ),
            ),
            Positioned(
              bottom: 18,
              left: 22,
              right: 22,
              child: AnimatedBuilder(
                animation: _entrance,
                builder: (_, _) => Text(
                  _entrance.isCompleted
                      ? (_waiting ? '等待加载 · 图标呼吸' : '加载已完成')
                      : _entrance.value < .5734
                      ? '前奏 · 文字凝聚成圆'
                      : '保留段 · 水流划过',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Color(0xFF7D8BA0),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
      const SizedBox(height: 22),
      Text(
        _original ? '原版 · 月蚀显影' : _formation.zh,
        style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w500),
      ),
      const SizedBox(height: 8),
      Text(
        _original ? '保留上一版作为对照。六种新方案共用它的水流收尾。' : _formation.descriptionZh,
        style: const TextStyle(color: Color(0xFFA1ADBE), height: 1.5),
      ),
      const SizedBox(height: 18),
      Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          FilledButton.icon(
            key: const ValueKey('replay'),
            onPressed: _data == null ? null : _replay,
            icon: const Icon(Icons.replay, size: 18),
            label: const Text('重播'),
          ),
          FilterChip(
            label: const Text('慢放 × 0.5'),
            selected: _slow,
            onSelected: (value) {
              setState(() => _slow = value);
              _replay();
            },
          ),
          FilterChip(
            label: const Text('模拟尚未加载完'),
            selected: _waiting,
            onSelected: (value) {
              setState(() => _waiting = value);
              if (value && _entrance.isCompleted && !_reduced) {
                _idle.repeat();
              } else {
                _idle.stop();
              }
            },
          ),
        ],
      ),
      const SizedBox(height: 12),
      AnimatedBuilder(
        animation: _entrance,
        builder: (_, _) => Slider(
          key: const ValueKey('timeline'),
          value: _entrance.value,
          label: '${(_entrance.value * 100).round()}%',
          onChanged: _data == null
              ? null
              : (value) {
                  _idle.stop();
                  _entrance.value = value;
                },
        ),
      ),
      const Text(
        '拖动时间轴，检查每一步如何变形。',
        style: TextStyle(fontSize: 12, color: Color(0xFF7D8BA0)),
      ),
    ],
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= 860;
          return SingleChildScrollView(
            padding: EdgeInsets.all(wide ? 48 : 20),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1160),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'RELAYUNE / ECLIPSE STUDIES 02',
                      style: TextStyle(
                        letterSpacing: 3,
                        fontSize: 11,
                        color: Color(0xFF8D9BAF),
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      '月蚀之前，如何成圆。',
                      style: TextStyle(
                        fontSize: wide ? 36 : 27,
                        fontWeight: FontWeight.w400,
                      ),
                    ),
                    const SizedBox(height: 10),
                    const Text(
                      '六种新前奏 · 保留水流收尾 · 独立预览',
                      style: TextStyle(color: Color(0xFFA1ADBE)),
                    ),
                    const SizedBox(height: 16),
                    OutlinedButton.icon(
                      key: const ValueKey('original-eclipse'),
                      onPressed: _data == null
                          ? null
                          : () {
                              setState(() => _original = !_original);
                              _replay();
                            },
                      icon: const Icon(Icons.compare_arrows, size: 18),
                      label: Text(_original ? '返回新方案' : '播放原版对照'),
                    ),
                    const SizedBox(height: 24),
                    if (wide)
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(width: 226, child: _choices(true)),
                          const SizedBox(width: 36),
                          Expanded(child: _stage(true)),
                        ],
                      )
                    else ...[
                      _choices(false),
                      const SizedBox(height: 20),
                      _stage(false),
                    ],
                  ],
                ),
              ),
            ),
          );
        },
      ),
    ),
  );
}
