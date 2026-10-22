import 'package:flutter/foundation.dart';

import '../models.dart';

class SessionComposerDraft extends ChangeNotifier {
  SessionComposerDraft({this.text = '', List<UploadAttachment>? attachments})
    : attachments = [...?attachments];

  // Question answers live with the session, not the transient activity dock.
  final Map<String, String> approvalAnswers = {};

  String text;
  List<UploadAttachment> attachments;

  void replaceAttachments(Iterable<UploadAttachment> next) {
    attachments = List<UploadAttachment>.of(next);
  }

  // Notify the currently mounted composer even if the submitting page has
  // already been disposed and reopened while its request was in flight.
  void restoreFailedSubmission(String sentText, List<UploadAttachment> sent) {
    final prefix = sentText.isEmpty || text.isEmpty
        ? sentText
        : '$sentText\n\n';
    text = '$prefix$text';
    final sentIds = sent.map((item) => item.id).toSet();
    replaceAttachments([
      ...sent,
      ...attachments.where((item) => !sentIds.contains(item.id)),
    ]);
    notifyListeners();
  }

  void clear() {
    text = '';
    attachments = [];
  }
}

class SessionComposerDraftStore {
  final Map<String, SessionComposerDraft> _drafts = {};

  SessionComposerDraft forSession(String sessionId) =>
      _drafts.putIfAbsent(sessionId, SessionComposerDraft.new);
}
