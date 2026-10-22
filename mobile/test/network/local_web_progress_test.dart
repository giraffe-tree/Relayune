import 'package:fake_async/fake_async.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/local_web_progress.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';

LocalWebResourceProgress item(int id, {int epoch = 1}) =>
    LocalWebResourceProgress(
      id: id,
      epoch: epoch,
      path: '/same.js',
      phase: LocalWebResourcePhase.waiting,
    );

void main() {
  test(
    'parallel requests to the same path stay separate and redraws are throttled',
    () {
      fakeAsync((time) {
        final progress = LocalWebLoadProgress()..begin(1);
        var notifications = 0;
        progress.addListener(() => notifications++);
        progress.observe(item(1));
        progress.observe(item(2));
        for (var i = 1; i <= 100; i++) {
          progress.observe(
            item(1).withPhase(
              LocalWebResourcePhase.receiving,
              download: DownloadProgress(i, 100),
            ),
          );
        }
        expect(progress.active, 2);
        expect(notifications, 0);
        time.elapse(const Duration(milliseconds: 100));
        expect(notifications, 1);
        progress.observe(item(1).withPhase(LocalWebResourcePhase.complete));
        progress.observe(
          item(1).withPhase(
            LocalWebResourcePhase.receiving,
            download: const DownloadProgress(10, 100),
          ),
        );
        expect(progress.completed, 1);
        expect(progress.active, 1);
        progress.dispose();
      });
    },
  );

  test(
    'navigation and close reject late callbacks; unknown totals stay unknown',
    () {
      final progress = LocalWebLoadProgress()..begin(1);
      progress.observe(item(1));
      progress.observe(
        item(1).withPhase(
          LocalWebResourcePhase.receiving,
          download: const DownloadProgress(100, null),
        ),
      );
      expect(progress.resources.single.fraction, isNull);
      progress.begin(2);
      progress.observe(item(1).withPhase(LocalWebResourcePhase.complete));
      expect(progress.completed, 0);
      progress.observe(item(2, epoch: 2));
      progress.stop();
      progress.observe(
        item(2, epoch: 2).withPhase(LocalWebResourcePhase.complete),
      );
      expect(progress.resources.single.phase, LocalWebResourcePhase.cancelled);
      expect(progress.completed, 0);
      progress.dispose();
    },
  );

  test(
    'bounded records keep lifetime counts and cannot resurrect evicted requests',
    () {
      final progress = LocalWebLoadProgress()..begin(1);
      for (var id = 1; id <= 150; id++) {
        progress.observe(item(id));
        progress.observe(item(id).withPhase(LocalWebResourcePhase.complete));
      }
      expect(progress.resources.length, LocalWebLoadProgress.retainedResources);
      expect(progress.completed, 150);
      progress.observe(
        item(1).withPhase(
          LocalWebResourcePhase.receiving,
          download: const DownloadProgress(50, 100),
        ),
      );
      expect(progress.active, 0);
      progress.observe(item(151));
      progress.observe(
        item(151).withPhase(LocalWebResourcePhase.failed, statusCode: 404),
      );
      expect(progress.failed, 1);
      expect(progress.resources.first.statusCode, 404);
      progress.dispose();
    },
  );
}
