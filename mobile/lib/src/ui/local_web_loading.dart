import 'dart:async';

import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../network/local_web_progress.dart';

String _elapsed(BuildContext context, Duration value) => context.l10n
    .localWebElapsed((value.inMilliseconds / 1000).toStringAsFixed(1));

/// Compact enough to stay below the page; details take one deliberate tap.
class LocalWebStatusStrip extends StatelessWidget {
  const LocalWebStatusStrip({
    super.key,
    required this.progress,
    required this.label,
    required this.busy,
    required this.onTap,
  });
  final LocalWebLoadProgress progress;
  final String label;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Material(
      color: colors.surface,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsetsDirectional.fromSTEB(20, 13, 16, 13),
          child: Row(
            children: [
              Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: progress.failed > 0
                      ? colors.error
                      : busy
                      ? colors.secondary
                      : colors.onSurfaceVariant,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.4,
                    color: colors.onSurfaceVariant,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              if (progress.failed > 0)
                Icon(
                  Icons.error_outline_rounded,
                  size: 15,
                  color: colors.error,
                ),
              const SizedBox(width: 4),
              Icon(
                Icons.expand_less_rounded,
                size: 18,
                color: colors.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class LocalWebOpening extends StatelessWidget {
  const LocalWebOpening({
    super.key,
    required this.status,
    required this.address,
    required this.elapsed,
    this.loading = true,
    this.action,
  });
  final String status, address;
  final Duration elapsed;
  final bool loading;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return ColoredBox(
      color: colors.surface,
      child: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: Center(
              child: Container(
                constraints: const BoxConstraints(maxWidth: 420),
                padding: const EdgeInsets.symmetric(
                  horizontal: 32,
                  vertical: 32,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    CustomPaint(
                      size: const Size(116, 82),
                      painter: _BrowserMark(colors: colors, failed: !loading),
                    ),
                    const SizedBox(height: 36),
                    Text(
                      context.l10n.localWebOpeningTitle,
                      style: TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w500,
                        height: 1.2,
                        letterSpacing: -.8,
                        color: colors.onSurface,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Directionality(
                      textDirection: TextDirection.ltr,
                      child: Text(
                        address,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          height: 1.5,
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ),
                    const SizedBox(height: 32),
                    Container(
                      width: 28,
                      height: 2,
                      color: loading ? colors.secondary : colors.outline,
                    ),
                    const SizedBox(height: 18),
                    Text(
                      status,
                      style: TextStyle(
                        fontSize: 14,
                        height: 1.65,
                        color: colors.onSurface,
                      ),
                    ),
                    if (loading) ...[
                      const SizedBox(height: 10),
                      Text(
                        context.l10n.localWebOpeningHint,
                        style: TextStyle(
                          fontSize: 12,
                          height: 1.65,
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        _elapsed(context, elapsed),
                        style: TextStyle(
                          fontSize: 12,
                          fontFeatures: const [FontFeature.tabularFigures()],
                          color: colors.onSurfaceVariant,
                        ),
                      ),
                    ],
                    if (action != null) ...[
                      const SizedBox(height: 24),
                      action!,
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A small abstract stack of browser pages, drawn with existing theme colors.
class _BrowserMark extends CustomPainter {
  const _BrowserMark({required this.colors, required this.failed});
  final ColorScheme colors;
  final bool failed;
  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    for (var i = 2; i >= 0; i--) {
      final rect = RRect.fromRectAndRadius(
        Rect.fromLTWH(5 + i * 10.0, 23 - i * 9.0, 82, 55),
        const Radius.circular(5),
      );
      canvas.drawRRect(rect, Paint()..color = colors.surface);
      line.color = i == 0
          ? colors.onSurfaceVariant.withValues(alpha: .7)
          : colors.outline;
      canvas.drawRRect(rect, line);
    }
    line.color = colors.outline;
    canvas.drawLine(const Offset(5, 37), const Offset(87, 37), line);
    final dot = Paint()..color = colors.onSurfaceVariant;
    for (var i = 0; i < 3; i++) {
      canvas.drawCircle(Offset(13 + i * 5.0, 30), 1, dot);
    }
    canvas.drawRect(
      const Rect.fromLTWH(17, 48, 29, 3),
      Paint()..color = colors.onSurfaceVariant.withValues(alpha: .45),
    );
    canvas.drawRect(
      const Rect.fromLTWH(17, 58, 49, 2),
      Paint()..color = colors.outline,
    );
    canvas.drawRect(
      const Rect.fromLTWH(17, 65, 38, 2),
      Paint()..color = colors.outline,
    );
    canvas.drawCircle(const Offset(85, 74), 7, Paint()..color = colors.surface);
    canvas.drawCircle(
      const Offset(85, 74),
      4,
      Paint()..color = failed ? colors.outline : colors.secondary,
    );
  }

  @override
  bool shouldRepaint(_BrowserMark oldDelegate) =>
      oldDelegate.colors != colors || oldDelegate.failed != failed;
}

class LocalWebResourceSheet extends StatefulWidget {
  const LocalWebResourceSheet({
    super.key,
    required this.progress,
    required this.address,
  });
  final LocalWebLoadProgress progress;
  final String address;
  @override
  State<LocalWebResourceSheet> createState() => _LocalWebResourceSheetState();
}

class _LocalWebResourceSheetState extends State<LocalWebResourceSheet> {
  Timer? _timer;
  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && widget.progress.active > 0) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: widget.progress,
    builder: (context, _) {
      final copy = context.l10n, progress = widget.progress;
      final colors = Theme.of(context).colorScheme;
      final resources = progress.resources;
      return SafeArea(
        top: false,
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .72,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Padding(
                      padding: const EdgeInsetsDirectional.fromSTEB(
                        24,
                        8,
                        16,
                        0,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              copy.localWebResources,
                              style: const TextStyle(
                                fontSize: 25,
                                fontWeight: FontWeight.w500,
                                letterSpacing: -.5,
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: copy.commonClose,
                            onPressed: () => Navigator.of(context).pop(),
                            icon: const Icon(Icons.close_rounded, size: 20),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsetsDirectional.fromSTEB(
                        24,
                        0,
                        24,
                        18,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Directionality(
                            textDirection: TextDirection.ltr,
                            child: Text(
                              widget.address,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 12,
                                color: colors.onSurfaceVariant,
                              ),
                            ),
                          ),
                          const SizedBox(height: 18),
                          Wrap(
                            spacing: 12,
                            runSpacing: 6,
                            children: [
                              Text(
                                copy.localWebResourceSummary(
                                  progress.completed,
                                  progress.active,
                                ),
                                style: TextStyle(
                                  fontSize: 12,
                                  color: colors.onSurfaceVariant,
                                ),
                              ),
                              if (progress.failed > 0)
                                Text(
                                  copy.localWebResourceFailures(
                                    progress.failed,
                                  ),
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: colors.error,
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    Divider(height: 1, color: colors.outlineVariant),
                  ],
                ),
              ),
              if (resources.isEmpty)
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 32,
                      vertical: 56,
                    ),
                    child: Text(
                      copy.localWebResourceEmpty,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13,
                        color: colors.onSurfaceVariant,
                      ),
                    ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 24,
                    vertical: 8,
                  ),
                  sliver: SliverList.builder(
                    itemCount: resources.length,
                    itemBuilder: (context, index) => LocalWebResourceRow(
                      resource: resources[index],
                      elapsed: progress.durationFor(resources[index].id),
                    ),
                  ),
                ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(24, 14, 24, 18),
                  child: Text(
                    progress.completed + progress.failed + progress.active >
                            resources.length
                        ? '${copy.localWebResourceRecent(resources.length)}\n${copy.localWebResourceTransferNote}'
                        : copy.localWebResourceTransferNote,
                    style: TextStyle(
                      fontSize: 11,
                      height: 1.6,
                      color: colors.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class LocalWebResourceRow extends StatelessWidget {
  const LocalWebResourceRow({
    super.key,
    required this.resource,
    required this.elapsed,
  });
  final LocalWebResourceProgress resource;
  final Duration elapsed;
  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final colors = Theme.of(context).colorScheme;
    final phase = resource.phase;
    final color = phase == LocalWebResourcePhase.failed
        ? colors.error
        : resource.active
        ? colors.secondary
        : colors.onSurfaceVariant;
    final label = switch (phase) {
      LocalWebResourcePhase.waiting => copy.localWebResourceWaiting,
      LocalWebResourcePhase.receiving => copy.localWebResourceReceiving,
      LocalWebResourcePhase.preparing => copy.localWebResourcePreparing,
      LocalWebResourcePhase.complete => copy.localWebResourceComplete,
      LocalWebResourcePhase.failed => copy.localWebResourceFailed,
      LocalWebResourcePhase.cancelled => copy.localWebResourceCancelled,
    };
    var path = resource.path;
    try {
      path = Uri.decodeComponent(path);
    } on FormatException {
      /* Preserve malformed paths. */
    }
    final name = path.split('/').last;
    final fraction = resource.fraction;
    final detail = phase == LocalWebResourcePhase.receiving
        ? fraction == null
              ? '${(resource.receivedBytes / 1024).toStringAsFixed(1)} KB'
              : '${(fraction * 100).floor()}%'
        : phase == LocalWebResourcePhase.failed && resource.statusCode != null
        ? 'HTTP ${resource.statusCode}'
        : _elapsed(context, elapsed);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 29,
            child: Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(
                resource.id.toString().padLeft(2, '0'),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 10,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  color: colors.onSurfaceVariant.withValues(alpha: .65),
                ),
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Directionality(
                  textDirection: TextDirection.ltr,
                  child: Text(
                    name.isEmpty ? '/' : name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                if (path != name && path != '/') ...[
                  const SizedBox(height: 3),
                  Directionality(
                    textDirection: TextDirection.ltr,
                    child: Text(
                      path,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10,
                        color: colors.onSurfaceVariant.withValues(alpha: .75),
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 9),
                Wrap(
                  spacing: 10,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(label, style: TextStyle(fontSize: 11, color: color)),
                    Text(
                      detail,
                      style: TextStyle(
                        fontSize: 11,
                        color: colors.onSurfaceVariant,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                if (phase == LocalWebResourcePhase.receiving)
                  SizedBox(
                    height: 2,
                    child: LinearProgressIndicator(
                      value: fraction,
                      color: color,
                      backgroundColor: colors.outlineVariant,
                    ),
                  )
                else
                  Container(height: 1, color: colors.outlineVariant),
              ],
            ),
          ),
          const SizedBox(width: 10),
          if (!resource.active)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(
                phase == LocalWebResourcePhase.complete
                    ? Icons.check_rounded
                    : phase == LocalWebResourcePhase.failed
                    ? Icons.error_outline_rounded
                    : Icons.remove_rounded,
                size: 15,
                color: color,
              ),
            ),
        ],
      ),
    );
  }
}
