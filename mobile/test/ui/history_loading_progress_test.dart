import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/state/history_load_progress.dart';
import 'package:relayune_mobile/src/ui/history_loading_progress.dart';
import 'package:relayune_mobile/src/ui/theme.dart';
import 'package:relayune_mobile/src/widgets/history_text_light.dart';

const _locale = Locale('zh', 'CN');
final _copy = relayuneLocalizationsFor(_locale);

Widget _host(
  HistoryLoadProgress? progress, {
  bool compact = false,
  bool visible = true,
  bool reduced = false,
  double textScale = 1,
  Locale locale = _locale,
}) => MaterialApp(
  locale: locale,
  supportedLocales: relayuneSupportedLocales,
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  theme: RelayTheme.web,
  home: MediaQuery(
    data: MediaQueryData(
      disableAnimations: reduced,
      textScaler: TextScaler.linear(textScale),
    ),
    child: TickerMode(
      enabled: visible,
      child: Scaffold(
        body: Center(
          child: SizedBox(
            width: 280,
            height: compact ? 54 : 400,
            child: Center(
              child: HistoryLoadingProgress(
                progress: progress,
                compact: compact,
              ),
            ),
          ),
        ),
      ),
    ),
  ),
);

void main() {
  for (final entry in [
    (HistoryLoadPhase.sending, _copy.workbenchHistoryRequestSending),
    (HistoryLoadPhase.waiting, _copy.workbenchHistoryWaitingComputer),
    (HistoryLoadPhase.restoring, _copy.workbenchHistoryReadingCache),
    (HistoryLoadPhase.reading, _copy.workbenchHistoryReadingComputer),
    (HistoryLoadPhase.transferring, _copy.workbenchHistoryTransferring),
    (HistoryLoadPhase.preparing, _copy.workbenchHistoryPreparing),
  ]) {
    testWidgets(
      'shows the observed ${entry.$1.name} phase without a percentage',
      (tester) async {
        final progress = HistoryLoadProgress(
          requestId: 'request',
          phase: entry.$1,
          readElapsed: () => const Duration(milliseconds: 2100),
        );
        await tester.pumpWidget(_host(progress));
        expect(find.text(entry.$2), findsOneWidget);
        expect(find.text(_copy.workbenchHistoryElapsed(2)), findsOneWidget);
        expect(find.textContaining('剩余'), findsNothing);
        expect(find.textContaining('待传输'), findsNothing);
        expect(find.textContaining('%'), findsNothing);
        expect(find.text(_copy.workbenchHistoryLoading), findsOneWidget);
        expect(find.text(_copy.workbenchHistoryLimit), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'shows measured source and encrypted page sizes without estimates',
    (tester) async {
      final progress = HistoryLoadProgress(
        requestId: 'request',
        phase: HistoryLoadPhase.reading,
        readElapsed: () => const Duration(seconds: 2),
        sourceReadBytes: 32000000,
        sourceTotalBytes: 212000000,
      );
      await tester.pumpWidget(_host(progress));
      expect(
        find.text(_copy.workbenchHistorySourceRead('32 MB', '212 MB')),
        findsOneWidget,
      );
      expect(find.textContaining('待传输'), findsNothing);
      await tester.pumpWidget(
        _host(
          progress.withPhase(
            HistoryLoadPhase.transferring,
            transferBytes: 310000,
          ),
        ),
      );
      expect(
        find.text(_copy.workbenchHistoryPendingTransfer('310 KB')),
        findsOneWidget,
      );
      expect(
        find.text(_copy.workbenchHistorySourceRead('32 MB', '212 MB')),
        findsOneWidget,
      );
      expect(find.textContaining('预计'), findsNothing);
      expect(find.textContaining('剩余时间'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'received and pending body sizes use their own total, with unknown totals hidden',
    (tester) async {
      final progress = HistoryLoadProgress(
        requestId: 'request',
        phase: HistoryLoadPhase.transferring,
        readElapsed: () => const Duration(seconds: 3),
        transferBytes: 300000,
        receivedBytes: 120000,
        receiveTotalBytes: 310000,
      );
      await tester.pumpWidget(_host(progress));
      expect(
        find.text(_copy.workbenchHistoryReceived('120 KB')),
        findsOneWidget,
      );
      expect(
        find.text(_copy.workbenchHistoryPendingReceive('190 KB')),
        findsOneWidget,
      );
      expect(find.textContaining('待传输'), findsNothing);
      await tester.pumpWidget(
        _host(
          progress.withPhase(
            HistoryLoadPhase.transferring,
            receivedBytes: 200000,
            replaceTransferProgress: true,
          ),
        ),
      );
      expect(
        find.text(_copy.workbenchHistoryReceived('200 KB')),
        findsOneWidget,
      );
      expect(find.textContaining('待接收'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'observed phase updates immediately without a minimum animation',
    (tester) async {
      final sending = HistoryLoadProgress(
        requestId: 'request',
        readElapsed: () => Duration.zero,
      );
      await tester.pumpWidget(_host(sending));
      expect(find.text(_copy.workbenchHistoryRequestSending), findsOneWidget);
      await tester.pumpWidget(
        _host(sending.withPhase(HistoryLoadPhase.preparing)),
      );
      expect(find.text(_copy.workbenchHistoryPreparing), findsOneWidget);
      expect(find.text(_copy.workbenchHistoryRequestSending), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      expect(find.byType(HistoryLoadingProgress), findsNothing);
      await tester.pump(const Duration(seconds: 5));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('a legacy loading state does not invent phases or elapsed time', (
    tester,
  ) async {
    await tester.pumpWidget(_host(null));
    expect(find.text(_copy.workbenchHistoryLoading), findsOneWidget);
    expect(find.byKey(const ValueKey('history-loading-stage')), findsNothing);
    expect(find.byKey(const ValueKey('history-loading-timing')), findsNothing);
    expect(find.textContaining('剩余'), findsNothing);
  });

  testWidgets('status announcements do not include the ticking timing labels', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      var elapsed = const Duration(seconds: 2);
      final progress = HistoryLoadProgress(
        requestId: 'request',
        phase: HistoryLoadPhase.reading,
        readElapsed: () => elapsed,
        sourceReadBytes: 32000000,
        sourceTotalBytes: 212000000,
      );
      await tester.pumpWidget(_host(progress));
      final status = find.byKey(const ValueKey('history-loading-status'));
      final label = tester.getSemantics(status).label;
      expect(label, contains(_copy.workbenchHistoryReadingComputer));
      expect(label, isNot(contains(_copy.workbenchHistoryElapsed(2))));
      expect(label, isNot(contains('32 MB')));
      elapsed = const Duration(seconds: 3);
      await tester.pump(const Duration(seconds: 1));
      expect(tester.getSemantics(status).label, label);
      expect(find.text(_copy.workbenchHistoryElapsed(3)), findsOneWidget);
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('narrow pagination stays 54 high with large text and RTL', (
    tester,
  ) async {
    final progress = HistoryLoadProgress(
      requestId: 'request',
      phase: HistoryLoadPhase.reading,
      readElapsed: () => const Duration(seconds: 8),
      sourceReadBytes: 32000000,
      sourceTotalBytes: 212000000,
    );
    for (final locale in [_locale, const Locale('ar')]) {
      await tester.pumpWidget(
        _host(progress, compact: true, textScale: 2, locale: locale),
      );
      final compactCopy = relayuneLocalizationsFor(locale);
      expect(
        find.text(compactCopy.workbenchHistoryReadingComputer),
        findsOneWidget,
      );
      expect(
        tester.getSize(find.byType(HistoryLoadingProgress)).height,
        lessThanOrEqualTo(54),
      );
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('elapsed labels stop refreshing while the route is hidden', (
    tester,
  ) async {
    var elapsed = Duration.zero;
    var reads = 0;
    final progress = HistoryLoadProgress(
      requestId: 'request',
      readElapsed: () {
        reads++;
        return elapsed;
      },
    );
    await tester.pumpWidget(_host(progress));
    elapsed = const Duration(seconds: 2);
    await tester.pump(const Duration(seconds: 1));
    expect(find.text(_copy.workbenchHistoryElapsed(2)), findsOneWidget);
    await tester.pumpWidget(_host(progress, visible: false));
    await tester.pump(const Duration(milliseconds: 300));
    final hiddenReads = reads;
    elapsed = const Duration(seconds: 20);
    await tester.pump(const Duration(seconds: 20));
    expect(reads, hiddenReads);
    expect(find.text(_copy.workbenchHistoryElapsed(2)), findsOneWidget);
    await tester.pumpWidget(_host(progress));
    expect(find.text(_copy.workbenchHistoryElapsed(20)), findsOneWidget);
  });

  testWidgets('background pauses timers and resume shows actual elapsed time', (
    tester,
  ) async {
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    var elapsed = Duration.zero;
    var reads = 0;
    final progress = HistoryLoadProgress(
      requestId: 'request',
      readElapsed: () {
        reads++;
        return elapsed;
      },
    );
    await tester.pumpWidget(_host(progress));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    final pausedReads = reads;
    elapsed = const Duration(seconds: 30);
    await tester.pump(const Duration(seconds: 30));
    expect(reads, pausedReads);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(find.text(_copy.workbenchHistoryElapsed(30)), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'reduced motion keeps a static wordmark with useful live timing',
    (tester) async {
      var elapsed = const Duration(seconds: 1);
      final progress = HistoryLoadProgress(
        requestId: 'request',
        phase: HistoryLoadPhase.reading,
        readElapsed: () => elapsed,
      );
      await tester.pumpWidget(_host(progress, reduced: true));
      HistoryTextLightPainter painter() => tester
          .widgetList<CustomPaint>(find.byType(CustomPaint))
          .map((widget) => widget.painter)
          .whereType<HistoryTextLightPainter>()
          .single;
      expect(painter().clock.value, 0);
      elapsed = const Duration(seconds: 10);
      await tester.pump(const Duration(seconds: 5));
      expect(painter().clock.value, 0);
      expect(find.text(_copy.workbenchHistoryElapsed(10)), findsOneWidget);
      expect(find.text(_copy.workbenchHistoryReadingComputer), findsOneWidget);
    },
  );
}
