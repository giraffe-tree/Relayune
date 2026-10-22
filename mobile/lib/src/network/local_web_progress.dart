import 'dart:async';

import 'package:flutter/foundation.dart';

import 'relay_api.dart';

enum LocalWebResourcePhase {
  waiting,
  receiving,
  preparing,
  complete,
  failed,
  cancelled,
}

/// Observations of one gateway request, never persisted or sent as telemetry.
/// Transfer bytes describe the encrypted response, not the decoded site file.
class LocalWebResourceProgress {
  const LocalWebResourceProgress({
    required this.id,
    required this.epoch,
    required this.path,
    required this.phase,
    this.isDocument = false,
    this.receivedBytes = 0,
    this.totalBytes,
    this.statusCode,
  });

  final int id, epoch;
  final String path;
  final LocalWebResourcePhase phase;
  final bool isDocument;
  final int receivedBytes;
  final int? totalBytes, statusCode;
  bool get active => switch (phase) {
    LocalWebResourcePhase.waiting ||
    LocalWebResourcePhase.receiving ||
    LocalWebResourcePhase.preparing => true,
    _ => false,
  };
  double? get fraction => totalBytes != null && totalBytes! > 0
      ? (receivedBytes / totalBytes!).clamp(0.0, 1.0)
      : null;

  LocalWebResourceProgress withPhase(
    LocalWebResourcePhase phase, {
    DownloadProgress? download,
    bool? isDocument,
    int? statusCode,
  }) => LocalWebResourceProgress(
    id: id,
    epoch: epoch,
    path: path,
    phase: phase,
    isDocument: isDocument ?? this.isDocument,
    receivedBytes: download?.receivedBytes ?? receivedBytes,
    totalBytes: download == null ? totalBytes : download.totalBytes,
    statusCode: statusCode ?? this.statusCode,
  );
}

typedef LocalWebProgressCallback =
    void Function(LocalWebResourceProgress progress);

/// A bounded, preview-owned view of requests. No scheduling or transport state.
class LocalWebLoadProgress extends ChangeNotifier {
  static const retainedResources = 80;
  final _resources = <int, LocalWebResourceProgress>{};
  final _started = <int, Duration>{};
  final _finished = <int, Duration>{};
  final Stopwatch _clock = Stopwatch();
  Timer? _notification;
  bool _disposed = false, _stopped = false;
  int epoch = 0, completed = 0, failed = 0;

  Duration get elapsed => _clock.elapsed;
  int get active => _resources.values.where((item) => item.active).length;
  bool get hasResources => _resources.isNotEmpty || completed + failed > 0;
  List<LocalWebResourceProgress> get resources {
    final items = _resources.values.toList();
    // Keep active requests at the top without rearranging them on every byte.
    items.sort((a, b) {
      final rankA = a.active
          ? 0
          : a.phase == LocalWebResourcePhase.failed
          ? 1
          : 2;
      final rankB = b.active
          ? 0
          : b.phase == LocalWebResourcePhase.failed
          ? 1
          : 2;
      return rankA != rankB ? rankA.compareTo(rankB) : a.id.compareTo(b.id);
    });
    return items;
  }

  Duration durationFor(int id) =>
      (_finished[id] ?? elapsed) - (_started[id] ?? elapsed);

  void begin(int nextEpoch) {
    if (_disposed) return;
    _notification?.cancel();
    _notification = null;
    epoch = nextEpoch;
    completed = failed = 0;
    _resources.clear();
    _started.clear();
    _finished.clear();
    _stopped = false;
    _clock
      ..reset()
      ..start();
    notifyListeners();
  }

  void observe(LocalWebResourceProgress item) {
    if (_disposed || _stopped || item.epoch != epoch) return;
    final previous = _resources[item.id];
    // Delayed transfer callbacks cannot revive a terminal request.
    if (previous != null && !previous.active) return;
    if (previous == null && item.phase != LocalWebResourcePhase.waiting) return;
    if (item.receivedBytes < 0 ||
        (item.totalBytes != null && item.totalBytes! < item.receivedBytes)) {
      return;
    }
    _started.putIfAbsent(item.id, () => elapsed);
    _resources[item.id] = item;
    if (!item.active) _finished[item.id] = elapsed;
    if (item.phase == LocalWebResourcePhase.complete) {
      completed++;
    }
    if (item.phase == LocalWebResourcePhase.failed) {
      failed++;
    }
    while (_resources.length > retainedResources) {
      final removable = _resources.entries.where(
        (entry) => !entry.value.active,
      );
      if (removable.isEmpty) {
        break; // Gateway already limits concurrent requests.
      }
      final id = removable.first.key;
      _resources.remove(id);
      _started.remove(id);
      _finished.remove(id);
    }
    // Large scripts can produce thousands of chunks. Redraw at most 10 Hz.
    _notification ??= Timer(const Duration(milliseconds: 100), () {
      _notification = null;
      if (!_disposed) notifyListeners();
    });
  }

  void stop() {
    if (_disposed) return;
    _stopped = true;
    _clock.stop();
    _notification?.cancel();
    _notification = null;
    for (final entry in _resources.entries.toList()) {
      if (entry.value.active) {
        _resources[entry.key] = entry.value.withPhase(
          LocalWebResourcePhase.cancelled,
        );
      }
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _clock.stop();
    _notification?.cancel();
    _resources.clear();
    _started.clear();
    _finished.clear();
    super.dispose();
  }
}
