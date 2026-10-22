import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Keeps selection menus usable for read-only text as well as the composer.
///
/// Flutter's iOS SystemContextMenu requires a live TextInputConnection, which
/// SelectableText (including the Markdown renderer) need not have. Use Flutter's
/// Cupertino-style toolbar instead, also in Navigator overlays and dialogs.
/// See https://github.com/flutter/flutter/issues/169001.
class RelayTextSelection extends StatelessWidget {
  const RelayTextSelection({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    if (defaultTargetPlatform != TargetPlatform.iOS ||
        !media.supportsShowingSystemContextMenu) {
      return child;
    }
    return MediaQuery(
      data: media.copyWith(supportsShowingSystemContextMenu: false),
      child: child,
    );
  }
}
