import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/image_load_queue.dart';

void main() {
  test('a frame loads newest images first, including the first five', () async {
    final queue = ImageLoadQueue();
    final gates = List.generate(8, (_) => Completer<Uint8List>());
    final started = <int>[];
    final results = [
      for (var index = 0; index < 8; index++)
        queue.run(
          () => gates[index].future,
          priority: () => index,
          onWaiting: () {},
          onStart: () => started.add(index),
        ),
    ];
    expect(started, isEmpty);
    await Future<void>.delayed(Duration.zero);
    expect(started, [7, 6, 5, 4, 3]);
    gates[7].complete(Uint8List(1));
    await results[7];
    expect(started, [7, 6, 5, 4, 3, 2]);
    for (final gate in gates) {
      if (!gate.isCompleted) gate.complete(Uint8List(1));
    }
    await Future.wait(results);
    expect(started, [7, 6, 5, 4, 3, 2, 1, 0]);
  });

  test('equal priorities keep FIFO within five download slots', () async {
    final queue = ImageLoadQueue();
    final gates = List.generate(8, (_) => Completer<Uint8List>());
    final started = <int>[];
    final waiting = <int>[];
    final results = [
      for (var i = 0; i < gates.length; i++)
        queue
            .run(
              () => gates[i].future,
              onWaiting: () => waiting.add(i),
              onStart: () => started.add(i),
            )
            .then<Object>((bytes) => bytes, onError: (Object error) => error),
    ];
    await Future<void>.delayed(Duration.zero);
    expect(started, [0, 1, 2, 3, 4]);
    expect(waiting, List.generate(8, (i) => i));
    gates[2].complete(Uint8List(1));
    await results[2];
    expect(started, [0, 1, 2, 3, 4, 5]);
    gates[0].completeError(StateError('download failed'));
    await results[0];
    expect(started, [0, 1, 2, 3, 4, 5, 6]);
    for (final gate in gates) {
      if (!gate.isCompleted) gate.complete(Uint8List(1));
    }
    await Future.wait(results);
    expect(started, List.generate(8, (i) => i));
  });

  test('clearing old queued work keeps active slots occupied', () async {
    final queue = ImageLoadQueue();
    final gate = Completer<Uint8List>();
    final started = <int>[];
    final results = [
      for (var i = 0; i < 7; i++)
        queue
            .run(
              () => gate.future,
              onWaiting: () {},
              onStart: () => started.add(i),
            )
            .then<Object>((bytes) => bytes, onError: (Object error) => error),
    ];
    await Future<void>.delayed(Duration.zero);
    queue.clear();
    expect(await results[5], isStateError);
    expect(await results[6], isStateError);
    var newWaiting = false;
    final next = queue.run(
      () async => Uint8List(1),
      onWaiting: () => newWaiting = true,
      onStart: () => started.add(7),
    );
    expect(newWaiting, isTrue);
    expect(started, [0, 1, 2, 3, 4]);
    gate.complete(Uint8List(1));
    await Future.wait([...results, next]);
    expect(started, [0, 1, 2, 3, 4, 7]);
  });
}
