enum HistoryLoadPhase {
  sending,
  waiting,
  restoring,
  reading,
  transferring,
  preparing,
}

/// Observed work for the current request. Unknown byte counts stay absent.
/// Source scan, encrypted page and transport-body bytes have separate scopes.
class HistoryLoadProgress {
  HistoryLoadProgress({
    required this.requestId,
    required this.readElapsed,
    this.phase = HistoryLoadPhase.sending,
    this.sourceReadBytes,
    this.sourceTotalBytes,
    this.transferBytes,
    this.receivedBytes,
    this.receiveTotalBytes,
    this.sourceSequence = 0,
    this.responseReady = false,
    this.phaseStartedAt = Duration.zero,
  });

  final String requestId;
  final Duration Function() readElapsed;
  final HistoryLoadPhase phase;
  final int? sourceReadBytes;
  final int? sourceTotalBytes;
  final int? transferBytes;
  final int? receivedBytes;
  final int? receiveTotalBytes;
  final int sourceSequence;
  final bool responseReady;
  final Duration phaseStartedAt;

  Duration get elapsed => readElapsed();
  int? get pendingReceiveBytes =>
      receiveTotalBytes == null || receivedBytes == null
      ? null
      : (receiveTotalBytes! - receivedBytes!).clamp(0, receiveTotalBytes!);

  HistoryLoadProgress withPhase(
    HistoryLoadPhase phase, {
    int? sourceSequence,
    bool? responseReady,
    int? sourceReadBytes,
    int? sourceTotalBytes,
    int? transferBytes,
    int? receivedBytes,
    int? receiveTotalBytes,
    bool replaceTransferProgress = false,
  }) => HistoryLoadProgress(
    requestId: requestId,
    readElapsed: readElapsed,
    phase: phase,
    sourceReadBytes: sourceReadBytes ?? this.sourceReadBytes,
    sourceTotalBytes: sourceTotalBytes ?? this.sourceTotalBytes,
    transferBytes: transferBytes ?? this.transferBytes,
    receivedBytes: receivedBytes ?? this.receivedBytes,
    receiveTotalBytes: replaceTransferProgress
        ? receiveTotalBytes
        : receiveTotalBytes ?? this.receiveTotalBytes,
    sourceSequence: sourceSequence ?? this.sourceSequence,
    responseReady: responseReady ?? this.responseReady,
    phaseStartedAt: phase == this.phase ? phaseStartedAt : elapsed,
  );
}
