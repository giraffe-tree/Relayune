import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../state/font_size.dart';

/// Applies to the navigator as well, so dialogs and sheets use the same size.
class FontSizeScope extends StatelessWidget {
  const FontSizeScope({super.key, required this.fontSize, required this.child});

  final ValueListenable<RelayFontSize> fontSize;
  final Widget child;

  @override
  Widget build(BuildContext context) => ValueListenableBuilder<RelayFontSize>(
    valueListenable: fontSize,
    builder: (context, size, child) {
      final media = MediaQuery.of(context);
      return MediaQuery(
        data: media.copyWith(
          textScaler: _FontSizeScaler(media.textScaler, size.scale),
        ),
        child: child!,
      );
    },
    child: child,
  );
}

class _FontSizeScaler extends TextScaler {
  const _FontSizeScaler(this.system, this.factor);

  final TextScaler system;
  final double factor;

  @override
  double scale(double fontSize) => system.scale(fontSize) * factor;

  @override
  double get textScaleFactor => scale(14) / 14;

  @override
  bool operator ==(Object other) =>
      other is _FontSizeScaler &&
      other.system == system &&
      other.factor == factor;

  @override
  int get hashCode => Object.hash(system, factor);
}
