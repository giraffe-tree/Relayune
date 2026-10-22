import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/state/session_directory.dart';

Map<String, dynamic> row(String id, {String name = 'Task'}) => {
  'id': id,
  'provider': 'codex',
  'cwd': '/work',
  'name': name,
};
Map<String, dynamic> page({
  String revision = 'a',
  bool reset = false,
  List<Map<String, dynamic>> rows = const [],
  List<String> removed = const [],
  String? next,
  List<Map<String, dynamic>>? projects,
}) => {
  'version': 1,
  'revision': revision,
  'observed_at': '2026-09-18T00:00:00Z',
  'reset': reset,
  'sessions': rows,
  'removed_ids': removed,
  'next_cursor': next,
  if (projects != null) 'projects': projects,
};
void main() {
  test(
    'initial batches survive restart, expose accumulated rows and commit revision at the end',
    () {
      var state = SessionDirectory();
      state.apply(page(reset: true, rows: [row('a')], next: 'next'));
      expect(state.revision, isNull);
      expect(state.sessions.keys, ['a']);
      state = SessionDirectory.fromJson(state.toJson());
      expect(state.cursor, 'next');
      state.apply(page(rows: [row('b')]));
      expect(state.revision, 'a');
      expect(state.cursor, isNull);
      expect(state.sessions.keys, ['a', 'b']);
      expect(state.apply(page()), isFalse);
    },
  );
  test(
    'a 300 row initial batch commits immediately and accepts a small delta',
    () {
      final state = SessionDirectory();
      state.apply(
        page(reset: true, rows: List.generate(300, (i) => row('$i'))),
      );
      expect(state.sessions.length, 300);
      expect(state.revision, 'a');
      expect(state.cursor, isNull);
      state.apply(
        page(
          revision: 'b',
          rows: [row('299', name: 'Renamed')],
        ),
      );
      expect(state.sessions.length, 300);
      expect(state.sessions['299']!.name, 'Renamed');
      final before = state.toJson();
      expect(
        () => state.apply(page(revision: 'c', rows: [row('overflow')])),
        throwsFormatException,
      );
      expect(state.toJson(), before);
    },
  );

  test(
    'delta updates, removes and empties projects without discarding unaffected rows',
    () {
      final state = SessionDirectory();
      state.apply(
        page(
          reset: true,
          rows: [row('a'), row('b')],
          projects: [
            {'id': 'p', 'provider': 'codex', 'cwd': '/work'},
          ],
        ),
      );
      state.apply(
        page(
          revision: 'b',
          rows: [
            row('b', name: 'Renamed'),
            row('c'),
          ],
          removed: ['a'],
          projects: [],
        ),
      );
      expect(state.sessions.keys, ['b', 'c']);
      expect(state.sessions['b']!.name, 'Renamed');
      expect(state.projects, isEmpty);
    },
  );
  test(
    'expired snapshot resets incomplete data; unexpected snapshot cannot splice pages',
    () {
      final state = SessionDirectory();
      state.apply(page(reset: true, rows: [row('a')], next: 'old-next'));
      final before = state.toJson();
      expect(
        () => state.apply(page(revision: 'other', rows: [row('bad')])),
        throwsFormatException,
      );
      expect(state.toJson(), before);
      state.apply(page(revision: 'new', reset: true, rows: [row('new')]));
      expect(state.sessions.keys, ['new']);
    },
  );
  test('reject malformed/oversized pages before changing the checkpoint', () {
    final state = SessionDirectory();
    state.apply(page(reset: true, rows: [row('a')]));
    final before = state.toJson();
    expect(
      () => state.apply(page(rows: List.generate(301, (i) => row('$i')))),
      throwsFormatException,
    );
    expect(
      () => state.apply({
        ...page(),
        'removed_ids': [42],
      }),
      throwsFormatException,
    );
    expect(state.toJson(), before);
  });
}
