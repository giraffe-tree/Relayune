import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/models.dart';
import 'package:relayune_mobile/src/state/message_order.dart';

RelayMessage message(String id, String time, {String content = ''}) =>
    RelayMessage(
      id: id,
      role: 'codex',
      content: content,
      createdAt: time,
      kind: 'message.completed',
    );

void main() {
  test('late events and timestamp corrections retain chronological order', () {
    final messages = [message('a', '01'), message('c', '03')];
    placeMessageInOrder(messages, message('b', '02'), existingIndex: -1);
    placeMessageInOrder(messages, message('d', '03'), existingIndex: -1);
    expect(messages.map((m) => m.id), ['a', 'b', 'c', 'd']);
    placeMessageInOrder(messages, message('b', '04'), existingIndex: 1);
    expect(messages.map((m) => m.id), ['a', 'c', 'd', 'b']);
    placeMessageInOrder(messages, message('b', '00'), existingIndex: 3);
    expect(messages.map((m) => m.id), ['b', 'a', 'c', 'd']);
  });

  test(
    'text-only updates preserve equal-time neighbors and historical objects',
    () {
      final messages = [
        message('a', '01'),
        message('b', '01'),
        message('c', '02'),
      ];
      final first = messages.first;
      final last = messages.last;
      placeMessageInOrder(
        messages,
        message('b', '01', content: 'new text'),
        existingIndex: 1,
      );
      expect(messages.map((m) => m.id), ['a', 'b', 'c']);
      expect(messages[1].content, 'new text');
      expect(identical(messages.first, first), isTrue);
      expect(identical(messages.last, last), isTrue);
    },
  );
}
