import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/history_load_progress.dart';

void main() {
  test('phases preserve elapsed time and separate measured byte scopes', () {
    var elapsed = const Duration(seconds: 2);
    final reading =
        HistoryLoadProgress(
          requestId: 'fixture',
          readElapsed: () => elapsed,
        ).withPhase(
          HistoryLoadPhase.reading,
          sourceReadBytes: 20,
          sourceTotalBytes: 200,
          sourceSequence: 4,
        );
    expect(reading.phaseStartedAt, elapsed);
    expect(reading.pendingReceiveBytes, isNull);
    elapsed = const Duration(seconds: 5);
    expect(
      reading.withPhase(HistoryLoadPhase.reading).phaseStartedAt,
      const Duration(seconds: 2),
    );
    final receiving = reading.withPhase(
      HistoryLoadPhase.transferring,
      transferBytes: 30,
      receivedBytes: 12,
      receiveTotalBytes: 31,
    );
    expect(receiving.pendingReceiveBytes, 19);
    expect(receiving.sourceReadBytes, 20);
    expect(receiving.sourceSequence, 4);
    expect(receiving.phaseStartedAt, elapsed);
    expect(receiving.elapsed, elapsed);
    final unknown = receiving.withPhase(
      HistoryLoadPhase.transferring,
      receivedBytes: 20,
      replaceTransferProgress: true,
    );
    expect(unknown.receiveTotalBytes, isNull);
    expect(unknown.pendingReceiveBytes, isNull);
    expect(unknown.transferBytes, 30);
  });
}
