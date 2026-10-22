import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../feedback/feedback_image.dart';
import '../feedback/feedback_info.dart';
import '../network/relay_api.dart';
import 'theme.dart';

class FeedbackPage extends StatefulWidget {
  const FeedbackPage({
    super.key,
    this.locale,
    this.loadInfo = loadFeedbackInfo,
    required this.api,
    this.email,
    this.pickImages = pickFeedbackImages,
  });
  final Locale? locale;
  final Future<FeedbackInfo> Function() loadInfo;
  final RelayApi api;
  final String? email;
  final FeedbackImagePicker pickImages;
  @override
  State<FeedbackPage> createState() => _FeedbackPageState();
}

class _FeedbackPageState extends State<FeedbackPage> {
  final _description = TextEditingController();
  late final _email = TextEditingController(text: widget.email ?? '');
  final _wechat = TextEditingController();
  final _images = <FeedbackImage>[];
  FeedbackInfo? _info;
  bool _bug = false;
  bool _busy = false;
  bool _picking = false;
  String? _status;
  String? _emailError;
  String? _submittedId;
  Map<String, dynamic>? _pending;
  String? _pendingBody;
  AppLocalizations get copy => widget.locale == null
      ? context.l10n
      : relayuneLocalizationsFor(widget.locale!);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    FeedbackInfo info;
    try {
      info = await widget.loadInfo().timeout(const Duration(seconds: 5));
    } catch (_) {
      info = const FeedbackInfo();
    }
    if (mounted) setState(() => _info = info);
  }

  @override
  void dispose() {
    _description.dispose();
    _email.dispose();
    _wechat.dispose();
    super.dispose();
  }

  String _value(String? value) =>
      value == null || value.trim().isEmpty ? copy.feedbackUnknown : value;
  Map<String, String> get _environment => {
    'app_version': _value(_info?.appVersion),
    'device_model': _value(_info?.model),
    'os_version': _value(_info?.system),
  };
  Map<String, String> get _fields => {
    copy.feedbackVersion: _environment['app_version']!,
    copy.feedbackModel: _environment['device_model']!,
    copy.feedbackSystem: _environment['os_version']!,
  };

  Future<void> _addImages() async {
    if (_busy || _picking) return;
    final remaining = maxFeedbackImages - _images.length;
    if (remaining == 0) {
      setState(() => _status = copy.feedbackImageLimit);
      return;
    }
    setState(() {
      _picking = true;
      _status = null;
    });
    try {
      final picked = await widget.pickImages(remaining);
      if (!mounted) return;
      if (picked.length > remaining) {
        setState(() => _status = copy.feedbackImageLimit);
        return;
      }
      if (picked.any(
        (image) =>
            image.bytes.isEmpty || image.bytes.length > maxFeedbackImageBytes,
      )) {
        throw const FormatException('feedback_image_invalid');
      }
      setState(() => _images.addAll(picked));
    } catch (_) {
      if (mounted) setState(() => _status = copy.feedbackImageFailed);
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  void _preview(FeedbackImage image) {
    showDialog<void>(
      context: context,
      builder: (context) => Dialog.fullscreen(
        backgroundColor: Colors.black,
        child: SafeArea(
          child: Column(
            children: [
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: IconButton(
                  tooltip: copy.feedbackDone,
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ),
              Expanded(
                child: InteractiveViewer(
                  child: Center(
                    child: Image.memory(
                      image.bytes,
                      semanticLabel: copy.feedbackImagePreview,
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _send() async {
    if (_busy || _picking || _info == null || _submittedId != null) return;
    if (_description.text.trim().isEmpty) {
      setState(() => _status = copy.feedbackEmpty);
      return;
    }
    final email = _email.text.trim();
    if (email.isNotEmpty &&
        (email.length > 254 ||
            !RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(email))) {
      setState(() => _emailError = copy.feedbackEmailInvalid);
      return;
    }
    final payload = <String, dynamic>{
      'category': _bug ? 'bug' : 'suggestion',
      'description': _description.text.trim(),
      'environment': _environment,
      'client': 'mobile',
      'contact': {'email': email, 'wechat': _wechat.text.trim()},
      'images': _images.map((image) => image.toJson()).toList(),
    };
    final body = jsonEncode(payload);
    setState(() {
      _busy = true;
      _status = null;
      _emailError = null;
    });
    try {
      if (_pending == null || _pendingBody != body) {
        final random = Random.secure();
        _pending = {
          'id': List.generate(
            16,
            (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),
          ).join(),
          ...payload,
        };
        _pendingBody = body;
      }
      final id = await widget.api.submitFeedback(_pending!);
      if (mounted) setState(() => _submittedId = id);
    } catch (_) {
      if (mounted) setState(() => _status = copy.feedbackFailed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _heading(String title, {String? trailing}) => Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
          ),
        ),
        if (trailing != null)
          Text(
            trailing,
            style: const TextStyle(fontSize: 12, color: RelayTheme.muted),
          ),
      ],
    ),
  );
  Widget _panel(Widget child) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: RelayTheme.panel,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: RelayTheme.lineSoft),
    ),
    child: child,
  );

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final locked = _busy || _picking;
    return PopScope(
      canPop: !_busy,
      child: Scaffold(
        appBar: AppBar(title: Text(copy.feedbackTitle)),
        bottomNavigationBar: _submittedId != null
            ? null
            : SafeArea(
                top: false,
                child: Container(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                  decoration: const BoxDecoration(
                    color: RelayTheme.background,
                    border: Border(top: BorderSide(color: RelayTheme.lineSoft)),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (_status != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: Semantics(
                            liveRegion: true,
                            child: Text(
                              _status!,
                              style: const TextStyle(
                                color: RelayTheme.red,
                                fontSize: 12,
                              ),
                            ),
                          ),
                        ),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          key: const ValueKey('feedback-submit'),
                          onPressed: locked || _info == null ? null : _send,
                          child: Text(
                            _busy
                                ? copy.feedbackSending
                                : _picking
                                ? copy.feedbackPreparingImages
                                : copy.feedbackSend,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
        body: SafeArea(
          top: false,
          bottom: false,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: _submittedId != null
                  ? Padding(
                      padding: const EdgeInsets.all(28),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            padding: const EdgeInsets.all(18),
                            decoration: const BoxDecoration(
                              color: RelayTheme.greenBackground,
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.check_rounded,
                              size: 32,
                              color: RelayTheme.green,
                            ),
                          ),
                          const SizedBox(height: 24),
                          Text(
                            copy.feedbackSuccess,
                            style: textTheme.titleLarge,
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 24),
                          Text(
                            copy.feedbackReference,
                            style: textTheme.bodySmall,
                          ),
                          const SizedBox(height: 8),
                          SelectableText(
                            _submittedId!,
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 28),
                          FilledButton(
                            onPressed: () => Navigator.of(context).pop(),
                            child: Text(copy.feedbackDone),
                          ),
                        ],
                      ),
                    )
                  : ListView(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                      children: [
                        Text(
                          copy.feedbackIntro,
                          style: const TextStyle(
                            fontSize: 26,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.7,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          copy.feedbackSubtitle,
                          style: const TextStyle(
                            fontSize: 13,
                            color: RelayTheme.mutedBright,
                            height: 1.5,
                          ),
                        ),
                        const SizedBox(height: 24),
                        Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            color: RelayTheme.panelRaised,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            children: [
                              for (final bug in [false, true])
                                Expanded(
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 2,
                                    ),
                                    child: ChoiceChip(
                                      showCheckmark: false,
                                      label: SizedBox(
                                        width: double.infinity,
                                        child: Text(
                                          bug
                                              ? copy.feedbackBug
                                              : copy.feedbackSuggestion,
                                          textAlign: TextAlign.center,
                                        ),
                                      ),
                                      avatar: Icon(
                                        bug
                                            ? Icons.bug_report_outlined
                                            : Icons.lightbulb_outline,
                                        size: 17,
                                      ),
                                      selected: _bug == bug,
                                      onSelected: locked
                                          ? null
                                          : (_) => setState(() => _bug = bug),
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 20),
                        _panel(
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _heading(copy.feedbackDescription),
                              TextField(
                                key: const ValueKey('feedback-description'),
                                controller: _description,
                                enabled: !_busy,
                                minLines: 4,
                                maxLines: 8,
                                maxLength: 2000,
                                style: const TextStyle(
                                  fontSize: 14,
                                  height: 1.65,
                                ),
                                decoration: InputDecoration(
                                  hintText: _bug
                                      ? copy.feedbackBugHint
                                      : copy.feedbackSuggestionHint,
                                  hintStyle: const TextStyle(
                                    fontSize: 13,
                                    color: RelayTheme.muted,
                                    height: 1.6,
                                  ),
                                  filled: false,
                                  contentPadding: EdgeInsets.zero,
                                  border: InputBorder.none,
                                  enabledBorder: InputBorder.none,
                                  focusedBorder: InputBorder.none,
                                  counterStyle: const TextStyle(
                                    fontSize: 11,
                                    color: RelayTheme.muted,
                                  ),
                                ),
                              ),
                              const Divider(
                                height: 28,
                                color: RelayTheme.lineSoft,
                              ),
                              _heading(
                                copy.feedbackImages,
                                trailing:
                                    '${_images.length}/3 · ${copy.feedbackOptional}',
                              ),
                              Wrap(
                                spacing: 10,
                                runSpacing: 10,
                                children: [
                                  for (var i = 0; i < _images.length; i++)
                                    SizedBox(
                                      width: 80,
                                      height: 80,
                                      child: Stack(
                                        children: [
                                          Positioned.fill(
                                            child: ClipRRect(
                                              borderRadius:
                                                  BorderRadius.circular(10),
                                              child: Material(
                                                color: RelayTheme.panelSoft,
                                                child: InkWell(
                                                  onTap: () =>
                                                      _preview(_images[i]),
                                                  child: Image.memory(
                                                    _images[i].bytes,
                                                    semanticLabel:
                                                        '${copy.feedbackImagePreview} ${i + 1}',
                                                    fit: BoxFit.cover,
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                          Positioned(
                                            top: 0,
                                            right: 0,
                                            child: IconButton(
                                              key: ValueKey(
                                                'feedback-remove-image-$i',
                                              ),
                                              tooltip: copy.feedbackRemoveImage,
                                              visualDensity:
                                                  VisualDensity.compact,
                                              style: IconButton.styleFrom(
                                                backgroundColor: Colors.black87,
                                              ),
                                              onPressed: locked
                                                  ? null
                                                  : () => setState(
                                                      () => _images.removeAt(i),
                                                    ),
                                              icon: const Icon(
                                                Icons.close,
                                                size: 14,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  if (_images.length < 3)
                                    SizedBox(
                                      width: 80,
                                      height: 80,
                                      child: OutlinedButton(
                                        key: const ValueKey(
                                          'feedback-add-image',
                                        ),
                                        onPressed: locked ? null : _addImages,
                                        style: OutlinedButton.styleFrom(
                                          padding: EdgeInsets.zero,
                                          side: const BorderSide(
                                            color: RelayTheme.line,
                                          ),
                                          shape: RoundedRectangleBorder(
                                            borderRadius: BorderRadius.circular(
                                              10,
                                            ),
                                          ),
                                        ),
                                        child: Column(
                                          mainAxisAlignment:
                                              MainAxisAlignment.center,
                                          children: [
                                            const Icon(
                                              Icons
                                                  .add_photo_alternate_outlined,
                                              size: 22,
                                            ),
                                            const SizedBox(height: 6),
                                            Text(
                                              copy.feedbackAddImage,
                                              style: const TextStyle(
                                                fontSize: 10,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ),
                                ],
                              ),
                              const SizedBox(height: 10),
                              Text(
                                copy.feedbackImagesHint,
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: RelayTheme.muted,
                                  height: 1.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 24),
                        _heading(
                          copy.feedbackContact,
                          trailing: copy.feedbackOptional,
                        ),
                        _panel(
                          Column(
                            children: [
                              TextField(
                                key: const ValueKey('feedback-email'),
                                controller: _email,
                                enabled: !_busy,
                                keyboardType: TextInputType.emailAddress,
                                autocorrect: false,
                                maxLength: 254,
                                onChanged: (_) {
                                  if (_emailError != null) {
                                    setState(() => _emailError = null);
                                  }
                                },
                                style: const TextStyle(fontSize: 14),
                                decoration: InputDecoration(
                                  labelText: copy.feedbackEmail,
                                  helperText: copy.feedbackEmailHint,
                                  helperMaxLines: 2,
                                  hintText: 'name@example.com',
                                  errorText: _emailError,
                                  counterText: '',
                                  prefixIcon: const Icon(
                                    Icons.alternate_email,
                                    size: 18,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 16),
                              TextField(
                                key: const ValueKey('feedback-wechat'),
                                controller: _wechat,
                                enabled: !_busy,
                                autocorrect: false,
                                maxLength: 64,
                                style: const TextStyle(fontSize: 14),
                                decoration: InputDecoration(
                                  labelText: copy.feedbackWechat,
                                  hintText: copy.feedbackWechatHint,
                                  counterText: '',
                                  prefixIcon: const Icon(
                                    Icons.chat_bubble_outline_rounded,
                                    size: 18,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 10),
                        Text(
                          copy.feedbackContactHint,
                          style: const TextStyle(
                            fontSize: 11,
                            color: RelayTheme.muted,
                            height: 1.5,
                          ),
                        ),
                        const SizedBox(height: 24),
                        _heading(copy.feedbackInfo),
                        if (_info == null)
                          Text(copy.feedbackLoading, style: textTheme.bodySmall)
                        else
                          ..._fields.entries.map(
                            (entry) => Padding(
                              padding: const EdgeInsets.symmetric(vertical: 5),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Text(
                                      entry.key,
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: RelayTheme.muted,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    flex: 2,
                                    child: SelectableText(
                                      entry.value,
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: RelayTheme.mutedBright,
                                      ),
                                      textAlign: TextAlign.end,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        const SizedBox(height: 12),
                        Text(
                          copy.feedbackPrivacy,
                          style: const TextStyle(
                            fontSize: 11,
                            color: RelayTheme.muted,
                            height: 1.5,
                          ),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
