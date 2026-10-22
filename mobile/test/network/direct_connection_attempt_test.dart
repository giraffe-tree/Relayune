import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/direct_connection_attempt.dart';

void main() {
  test('a hung stage exhausts the entire attempt and cannot advance late', () async {
    final attempt = DirectConnectionAttempt(budget: const Duration(milliseconds: 25));
    final blocked = Completer<void>();
    await expectLater(attempt.run('catchup', () => blocked.future), throwsA(isA<TimeoutException>()));
    expect(attempt.cancelled, isTrue);
    blocked.complete();
    var activated = false;
    await expectLater(attempt.run('activate', () async { activated = true; }), throwsStateError);
    expect(activated, isFalse);
    expect(attempt.summary('failed')['stage'], 'catchup');
    expect(attempt.stages.keys, ['catchup']);
  });

  test('successful stages report durations without payloads', () async {
    final attempt = DirectConnectionAttempt();
    expect(await attempt.run('probe', () async => 42), 42);
    await attempt.run('activate', () async {});
    expect(attempt.cancelled, isFalse);
    expect(attempt.summary('ready').keys, ['outcome', 'stage', 'elapsed_ms', 'stages_ms']);
    expect(attempt.stages.keys, ['probe', 'activate']);
  });
}
