import 'dart:async';
import 'dart:typed_data';

/// One queue per client, shared by thumbnails and original-image downloads.
class ImageLoadQueue {
  static const maxConcurrent = 5;
  final List<_ImageJob> _waiting = [];
  bool _scheduled = false;
  int _active = 0;

  Future<Uint8List> run(
    Future<Uint8List> Function() load, {
    required void Function() onWaiting,
    required void Function() onStart,
    int Function()? priority,
  }) {
    final job = _ImageJob(load, onStart, priority ?? () => 0);
    _waiting.add(job);
    onWaiting();
    // Let this frame finish laying out the tail before choosing downloads.
    if (!_scheduled) {
      _scheduled = true;
      Timer.run(() {
        _scheduled = false;
        _drain();
      });
    }
    return job.result.future;
  }

  void _drain() {
    while (_active < maxConcurrent && _waiting.isNotEmpty) {
      var next = 0;
      for (var index = 1; index < _waiting.length; index += 1) {
        if (_waiting[index].priority() > _waiting[next].priority()) {
          next = index;
        }
      }
      final job = _waiting.removeAt(next);
      _active += 1;
      unawaited(_run(job));
    }
  }

  Future<void> _run(_ImageJob job) async {
    try {
      job.onStart();
      job.result.complete(await job.load());
    } catch (error, stack) {
      job.result.completeError(error, stack);
    } finally {
      _active -= 1;
      _drain();
    }
  }

  /// Drop work for the old account/device without freeing still-active slots.
  void clear() {
    while (_waiting.isNotEmpty) {
      _waiting
          .removeAt(0)
          .result
          .completeError(StateError('Image load cancelled'));
    }
  }
}

class _ImageJob {
  _ImageJob(this.load, this.onStart, this.priority);
  final int Function() priority;
  final Future<Uint8List> Function() load;
  final void Function() onStart;
  final result = Completer<Uint8List>();
}
