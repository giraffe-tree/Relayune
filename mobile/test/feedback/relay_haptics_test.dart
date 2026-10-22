import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/feedback/relay_haptics.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('only a confirmed foreground ticket vibrates once', () async {
    final events = <RelayHapticEvent>[];
    final haptics = RelayHaptics(play: (event) async => events.add(event));
    addTearDown(haptics.dispose);
    final ticket = haptics.begin();
    expect(events, isEmpty);
    haptics.confirm(ticket, RelayHapticEvent.connected);
    haptics.confirm(ticket, RelayHapticEvent.connected);
    haptics.confirm(null, RelayHapticEvent.connected);
    expect(events, [RelayHapticEvent.connected]);
  });

  test('cancelled, background, disabled and disposed tickets never replay', () {
    final events = <RelayHapticEvent>[];
    final haptics = RelayHaptics(play: (event) async => events.add(event));
    final failed = haptics.begin();
    haptics.cancel(failed);
    haptics.confirm(failed, RelayHapticEvent.decisionConfirmed);
    final background = haptics.begin();
    haptics.didChangeAppLifecycleState(AppLifecycleState.inactive);
    expect(haptics.begin(), isNull);
    haptics.didChangeAppLifecycleState(AppLifecycleState.resumed);
    haptics.confirm(background, RelayHapticEvent.stopConfirmed);
    final disabled = haptics.begin();
    haptics.enabled = false;
    expect(haptics.begin(), isNull);
    haptics.enabled = true;
    haptics.confirm(disabled, RelayHapticEvent.connected);
    final disposed = haptics.begin();
    haptics.dispose();
    haptics.confirm(disposed, RelayHapticEvent.connected);
    expect(events, isEmpty);
  });

  test('platform feedback failure cannot fail a confirmed action', () async {
    final haptics = RelayHaptics(
      play: (_) async => throw StateError('unsupported'),
    );
    addTearDown(haptics.dispose);
    haptics.confirm(haptics.begin(), RelayHapticEvent.connected);
    await Future<void>.delayed(Duration.zero);
  });
}
