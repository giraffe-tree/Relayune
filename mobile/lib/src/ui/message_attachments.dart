part of 'workbench_screen.dart';

class _MessageAttachmentPreview extends StatefulWidget {
  const _MessageAttachmentPreview({
    super.key,
    this.imageSize,
    this.onOpen,
    this.onAspectRatio,
    this.fit = BoxFit.contain,
    required this.attachment,
    required this.session,
    required this.controller,
  });

  final Size? imageSize;
  final VoidCallback? onOpen;
  final ValueChanged<double>? onAspectRatio;
  final BoxFit fit;
  final RelayAttachment attachment;
  final RelaySession session;
  final AppController controller;

  @override
  State<_MessageAttachmentPreview> createState() =>
      _MessageAttachmentPreviewState();
}

class _MessageAttachmentPreviewState extends State<_MessageAttachmentPreview> {
  Future<Uint8List>? _thumbnailBytes;
  final _downloadProgress = ValueNotifier<DownloadProgress?>(null);
  int _imageGeneration = 0;
  bool _imageFailed = false;
  bool _deviceOnline = false;
  bool _openingPreview = false;
  bool _openingFile = false;

  @override
  void initState() {
    super.initState();
    _prepareImage();
  }

  @override
  void didUpdateWidget(covariant _MessageAttachmentPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.attachment.id != widget.attachment.id ||
        oldWidget.session.id != widget.session.id ||
        oldWidget.controller != widget.controller ||
        oldWidget.attachment.url != widget.attachment.url ||
        oldWidget.attachment.mimeType != widget.attachment.mimeType ||
        oldWidget.attachment.type != widget.attachment.type ||
        oldWidget.attachment.localBytes != widget.attachment.localBytes ||
        oldWidget.attachment.thumbnailBytes !=
            widget.attachment.thumbnailBytes ||
        (_imageFailed && !_deviceOnline && widget.controller.deviceOnline)) {
      _prepareImage();
    }
    _deviceOnline = widget.controller.deviceOnline;
  }

  void _prepareImage() {
    _imageGeneration += 1;
    _imageFailed = false;
    _deviceOnline = widget.controller.deviceOnline;
    _downloadProgress.value = null;
    final attachment = widget.attachment;
    if (!attachment.isImage) {
      _thumbnailBytes = null;
      return;
    }
    final generation = _imageGeneration;
    _thumbnailBytes = _attachmentPreviewBytes(
      widget.controller,
      widget.session,
      attachment,
      onProgress: (progress) {
        if (mounted && generation == _imageGeneration) {
          _downloadProgress.value = progress;
        }
      },
    );
    if (widget.onAspectRatio != null) {
      unawaited(_readAspectRatio(_thumbnailBytes!, generation));
    }
  }

  Future<void> _readAspectRatio(
    Future<Uint8List> pending,
    int generation,
  ) async {
    try {
      final bytes = await pending;
      final buffer = await ui.ImmutableBuffer.fromUint8List(bytes);
      try {
        final descriptor = await ui.ImageDescriptor.encoded(buffer);
        try {
          final ratio = descriptor.width / descriptor.height;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && generation == _imageGeneration) {
              widget.onAspectRatio?.call(ratio);
            }
          });
          WidgetsBinding.instance.ensureVisualUpdate();
        } finally {
          descriptor.dispose();
        }
      } finally {
        buffer.dispose();
      }
    } on Object {
      // The thumbnail itself owns loading errors and retry feedback.
    }
  }

  @override
  void dispose() {
    _downloadProgress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    final attachment = widget.attachment;
    if (!attachment.isImage) {
      final previewable =
          attachment.previewSupported &&
          (attachment.url.isNotEmpty || attachment.localBytes != null);
      final transitionDuration = MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 160);
      final fileCard = Container(
        width: double.infinity,
        constraints: const BoxConstraints(maxWidth: 320, minHeight: 60),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedSwitcher(
              duration: transitionDuration,
              child: _openingFile
                  ? const AnimatedRunningStatusIcon(
                      size: 17,
                      color: RelayTheme.green,
                      iconKey: ValueKey('message-file-loading-icon'),
                    )
                  : Icon(
                      attachment.mimeType == 'text/html'
                          ? Icons.space_dashboard_outlined
                          : Icons.insert_drive_file_outlined,
                      key: const ValueKey('message-file-idle-icon'),
                      size: 17,
                    ),
            ),
            const SizedBox(width: 7),
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    attachment.name.replaceAll('_', ' '),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13),
                  ),
                  const SizedBox(height: 2),
                  AnimatedSwitcher(
                    duration: transitionDuration,
                    child: Text(
                      _openingFile
                          ? copy.workbenchSecureFileReading
                          : previewable
                          ? _filePreviewKindLabel(attachment, copy)
                          : copy.workbenchFilePreviewUnsupported,
                      key: ValueKey(
                        _openingFile
                            ? 'message-file-reading'
                            : 'message-file-idle',
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: RelayTheme.muted,
                        fontSize: 11,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
      return Semantics(
        label: attachment.name,
        button: previewable,
        child: Material(
          key: ValueKey('message-file-${attachment.id}'),
          color: RelayTheme.panelRaised,
          borderRadius: BorderRadius.circular(10),
          clipBehavior: Clip.antiAlias,
          child: previewable
              ? InkWell(
                  onTap: _openingFile ? null : () => _openFilePreview(),
                  child: fileCard,
                )
              : fileCard,
        ),
      );
    }

    Widget placeholder() => ValueListenableBuilder<DownloadProgress?>(
      valueListenable: _downloadProgress,
      builder: (context, progress, _) => ImageLoadingPlaceholder(
        progress: progress,
        indicatorKey: ValueKey(
          'message-image-thumbnail-progress-${attachment.id}',
        ),
      ),
    );
    return FutureBuilder<Uint8List>(
      future: _thumbnailBytes,
      builder: (context, snapshot) {
        _imageFailed =
            snapshot.connectionState == ConnectionState.done &&
            snapshot.hasError;
        final ready =
            snapshot.connectionState == ConnectionState.done &&
            snapshot.hasData;
        final image = ready
            ? Image(
                image: ResizeImage(
                  MemoryImage(snapshot.data!),
                  width:
                      (((widget.imageSize?.width ?? 120) *
                                  MediaQuery.devicePixelRatioOf(context))
                              .ceil())
                          .clamp(1, 720),
                  height:
                      (((widget.imageSize?.height ?? 120) *
                                  MediaQuery.devicePixelRatioOf(context))
                              .ceil())
                          .clamp(1, 720),
                  policy: ResizeImagePolicy.fit,
                ),
                fit: widget.fit,
                alignment: Alignment.center,
                frameBuilder: (context, child, frame, synchronous) =>
                    synchronous || frame != null ? child : placeholder(),
              )
            : _imageFailed
            ? Container(
                color: const Color(0xFF181C1B),
                alignment: Alignment.center,
                padding: const EdgeInsets.all(12),
                child: Text(
                  '${copy.workbenchImageReadFailed(attachment.name)}\n${copy.commonRetry}',
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: RelayTheme.muted, fontSize: 10),
                ),
              )
            : placeholder();
        return Semantics(
          button: ready || _imageFailed,
          image: ready,
          label: copy.workbenchImageThumbnailLabel(attachment.name),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(9),
              onTap: _imageFailed
                  ? () => setState(_prepareImage)
                  : ready && !_openingPreview
                  ? (widget.onOpen ?? _openPreview)
                  : null,
              child: SizedBox(
                width: widget.imageSize?.width ?? 120,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(9),
                      child: SizedBox(
                        key: ValueKey(
                          'message-image-thumbnail-${attachment.id}',
                        ),
                        width: widget.imageSize?.width ?? 120,
                        height: widget.imageSize?.height ?? 120,
                        child: image,
                      ),
                    ),
                    if (widget.imageSize == null) ...[
                      const SizedBox(height: 5),
                      Text(
                        attachment.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: RelayTheme.muted,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _openFilePreview() async {
    if (_openingFile) return;
    setState(() => _openingFile = true);
    try {
      await _showFilePreview(
        context,
        controller: widget.controller,
        session: widget.session,
        attachment: widget.attachment,
      );
    } finally {
      if (mounted) setState(() => _openingFile = false);
    }
  }

  Future<void> _openPreview() async {
    if (_openingPreview) return;
    setState(() => _openingPreview = true);
    try {
      final bytes = await _thumbnailBytes;
      if (!mounted) return;
      final images = [widget.attachment];
      await showDialog<void>(
        context: context,
        builder: (context) => _ImageGallery(
          controller: widget.controller,
          session: widget.session,
          attachments: images,
          initialPreviews: {widget.attachment.id: bytes!},
          initialIndex: images.indexWhere(
            (image) => image.id == widget.attachment.id,
          ),
          onPageChanged: (_) {},
        ),
      );
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.workbenchOriginalReadFailed)),
        );
      }
    } finally {
      if (mounted) setState(() => _openingPreview = false);
    }
  }
}

class _ImagePreviewDialog extends StatefulWidget {
  const _ImagePreviewDialog({
    required this.controller,
    required this.session,
    required this.attachment,
    required this.previewBytes,
    this.onZoomChanged,
  });

  final AppController controller;
  final RelaySession session;
  final RelayAttachment attachment;
  final Uint8List previewBytes;
  final ValueChanged<bool>? onZoomChanged;

  @override
  State<_ImagePreviewDialog> createState() => _ImagePreviewDialogState();
}

class _ImagePreviewDialogState extends State<_ImagePreviewDialog> {
  Uint8List? _originalBytes;
  final _transform = TransformationController();
  bool _zoomed = false;
  Offset _doubleTapPosition = Offset.zero;

  @override
  void initState() {
    super.initState();
    _transform.addListener(() {
      final zoomed = _transform.value.getMaxScaleOnAxis() > 1.01;
      if (_zoomed != zoomed) {
        setState(() => _zoomed = zoomed);
        widget.onZoomChanged?.call(zoomed);
      }
    });
  }

  Future<Uint8List>? _originalRequest;
  bool _loadingOriginal = false;
  final _downloadProgress = ValueNotifier<DownloadProgress?>(null);

  @override
  void dispose() {
    _transform.dispose();
    _downloadProgress.dispose();
    super.dispose();
  }

  Future<Uint8List> _readOriginal() {
    if (_originalBytes != null) return Future.value(_originalBytes!);
    return _originalRequest ??= _fetchOriginal();
  }

  Future<Uint8List> _fetchOriginal() async {
    _downloadProgress.value = null;
    setState(() => _loadingOriginal = true);
    try {
      final bytes =
          widget.attachment.localBytes ??
          await widget.controller.loadAttachment(
            widget.session.id,
            widget.attachment,
            onProgress: (progress) {
              if (mounted) _downloadProgress.value = progress;
            },
          );
      if (mounted) setState(() => _originalBytes = bytes);
      return bytes;
    } finally {
      _originalRequest = null;
      if (mounted) setState(() => _loadingOriginal = false);
    }
  }

  Future<void> _loadOriginal() async {
    try {
      await _readOriginal();
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.l10n.workbenchOriginalReadFailed)),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bytes = _originalBytes ?? widget.previewBytes;
    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 720),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Flexible(
            child: Container(
              constraints: const BoxConstraints(minHeight: 220),
              color: Colors.black,
              child: GestureDetector(
                onDoubleTapDown: (details) =>
                    _doubleTapPosition = details.localPosition,
                onDoubleTap: () {
                  _transform.value = _zoomed
                      ? Matrix4.identity()
                      : (Matrix4.diagonal3Values(2.5, 2.5, 1)
                          ..setTranslationRaw(
                            -_doubleTapPosition.dx * 1.5,
                            -_doubleTapPosition.dy * 1.5,
                            0,
                          ));
                },
                child: InteractiveViewer(
                  transformationController: _transform,
                  minScale: 1,
                  maxScale: 5,
                  panEnabled: _zoomed,
                  child: Center(
                    child: Image.memory(
                      bytes,
                      key: ValueKey(
                        _originalBytes == null
                            ? 'message-image-dialog-preview-${widget.attachment.id}'
                            : 'message-image-original-${widget.attachment.id}',
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
          if (_loadingOriginal)
            _AttachmentDownloadProgress(
              progress: _downloadProgress,
              indicatorKey: ValueKey(
                'message-image-original-progress-${widget.attachment.id}',
              ),
            ),
          Padding(
            padding: const EdgeInsetsDirectional.fromSTEB(14, 8, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    _loadingOriginal
                        ? context.l10n.workbenchLoadingOriginal
                        : widget.attachment.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: RelayTheme.mutedBright,
                      fontSize: 12,
                    ),
                  ),
                ),
                SaveImageButton(
                  key: ValueKey('message-image-save-${widget.attachment.id}'),
                  loadBytes: _readOriginal,
                  name: widget.attachment.name,
                ),
                if (_originalBytes == null)
                  TextButton.icon(
                    key: ValueKey(
                      'message-image-load-original-${widget.attachment.id}',
                    ),
                    onPressed: _loadingOriginal ? null : _loadOriginal,
                    icon: const Icon(Icons.high_quality_outlined, size: 17),
                    label: Text(context.l10n.workbenchViewOriginal),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageAttachments extends StatefulWidget {
  const _MessageAttachments({
    super.key,
    required this.attachments,
    required this.session,
    required this.controller,
  });

  final List<RelayAttachment> attachments;
  final RelaySession session;
  final AppController controller;

  @override
  State<_MessageAttachments> createState() => _MessageAttachmentsState();
}

class _MessageAttachmentsState extends State<_MessageAttachments> {
  final _deck = GlobalKey<PhotoDeckState>();
  final _anchor = GlobalKey();
  final _extraFiles = GlobalKey();
  int _index = 0;
  double _aspectRatio = 1;
  bool _filesExpanded = false;
  bool _galleryOpen = false;
  bool _restored = false;

  List<RelayAttachment> get _images =>
      widget.attachments.where((a) => a.isImage).toList();

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_restored) return;
    _restored = true;
    final saved = PageStorage.maybeOf(
      context,
    )?.readState(context, identifier: widget.key);
    if (saved is ({String? imageId, bool overview, bool files})) {
      _index = math.max(0, _images.indexWhere((a) => a.id == saved.imageId));
      _filesExpanded = saved.files;
    }
  }

  void _remember() {
    final images = _images;
    PageStorage.maybeOf(context)?.writeState(context, (
      imageId: images.isEmpty
          ? null
          : images[_index.clamp(0, images.length - 1)].id,
      overview: false,
      files: _filesExpanded,
    ), identifier: widget.key);
  }

  @override
  void didUpdateWidget(covariant _MessageAttachments oldWidget) {
    super.didUpdateWidget(oldWidget);
    final old = oldWidget.attachments.where((a) => a.isImage).toList();
    if (old.firstOrNull?.id != _images.firstOrNull?.id) _aspectRatio = 1;
    final id = old.isEmpty ? null : old[_index.clamp(0, old.length - 1)].id;
    _index = math.max(0, _images.indexWhere((a) => a.id == id));
  }

  void _toggleFiles() {
    final anchor = _anchor.currentContext?.findRenderObject();
    final body = _extraFiles.currentContext?.findRenderObject();
    if (anchor is ConversationAnchorBox) {
      context
          .findAncestorStateOfType<_ConversationTurnState>()
          ?.widget
          .onToggleActivity(
            anchor,
            body is RenderBox && body.hasSize ? body.size.height : 0,
          );
    }
    setState(() {
      _filesExpanded = !_filesExpanded;
    });
    _remember();
  }

  Future<void> _openGallery(int index, {bool overview = false}) async {
    if (_galleryOpen) return;
    _galleryOpen = true;
    final selected = _images[index];
    final images = _images;
    try {
      await showDialog<void>(
        context: context,
        useSafeArea: true,
        builder: (_) => _ImageGallery(
          attachments: images,
          initialIndex: images.indexWhere((image) => image.id == selected.id),
          initialOverview: overview,
          session: widget.session,
          controller: widget.controller,
          onPageChanged: (value) {
            if (!mounted) return;
            final current = _images.indexWhere((a) => a.id == images[value].id);
            if (current < 0) return;
            setState(() => _index = current);
            _deck.currentState?.goTo(current);
            _remember();
          },
        ),
      );
    } finally {
      _galleryOpen = false;
    }
  }

  Widget _preview(
    RelayAttachment attachment, {
    Size? size,
    VoidCallback? onOpen,
    ValueChanged<double>? onAspectRatio,
    BoxFit fit = BoxFit.contain,
  }) => _MessageAttachmentPreview(
    key: ValueKey(attachment.id),
    attachment: attachment,
    session: widget.session,
    controller: widget.controller,
    imageSize: size,
    onOpen: onOpen,
    onAspectRatio: onAspectRatio,
    fit: fit,
  );

  void _setAspectRatio(double value) {
    final next = value.clamp(.2, 4.0);
    if ((_aspectRatio - next).abs() < .01) return;
    final anchor = _anchor.currentContext?.findRenderObject();
    if (anchor is ConversationAnchorBox) {
      context
          .findAncestorStateOfType<_ConversationTurnState>()
          ?.widget
          .onToggleActivity(anchor, 0);
    }
    setState(() => _aspectRatio = next);
  }

  @override
  Widget build(BuildContext context) {
    final images = _images;
    final files = widget.attachments.where((a) => !a.isImage).toList();
    return ConversationSizeAnchor(
      key: _anchor,
      child: Padding(
        padding: const EdgeInsets.only(top: 8),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 300),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (images.length == 1)
                LayoutBuilder(
                  builder: (context, constraints) {
                    final width = math.min(
                      math.min(196.0, 220 * _aspectRatio),
                      constraints.maxWidth,
                    );
                    return _preview(
                      images.single,
                      size: Size(width, width / _aspectRatio),
                      onAspectRatio: _setAspectRatio,
                    );
                  },
                ),
              if (images.length > 1)
                LayoutBuilder(
                  builder: (context, constraints) {
                    final controlWidth = 72.0;
                    return Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Flexible(
                          child: PhotoDeck(
                            key: _deck,
                            ids: images.map((a) => a.id).toList(),
                            initialIndex: _index,
                            aspectRatio: _aspectRatio,
                            semanticLabel: (i) =>
                                '${i + 1} / ${images.length}, ${context.l10n.workbenchImageThumbnailLabel(images[i].name)}',
                            itemBuilder: (context, i, size) => _preview(
                              images[i],
                              size: size,
                              fit: BoxFit.cover,
                              onAspectRatio: i == 0 ? _setAspectRatio : null,
                            ),
                            onOpen: _openGallery,
                            onPageChanged: (i) {
                              setState(() => _index = i);
                              _remember();
                            },
                          ),
                        ),
                        const SizedBox(width: 4),
                        SizedBox(
                          width: controlWidth,
                          child: TextButton(
                            key: const ValueKey(
                              'attachment-photo-overview-toggle',
                            ),
                            style: TextButton.styleFrom(
                              foregroundColor: RelayTheme.mutedBright,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                              ),
                              minimumSize: const Size(48, 48),
                              textStyle: Theme.of(
                                context,
                              ).textTheme.labelMedium?.copyWith(fontSize: 12),
                            ),
                            onPressed: () =>
                                _openGallery(_index, overview: true),
                            child: Text(
                              attachmentText(context, 'all'),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ),
                      ],
                    );
                  },
                ),
              if (files.isNotEmpty) ...[
                if (images.isNotEmpty) const SizedBox(height: 10),
                ...files
                    .take(3)
                    .map(
                      (file) => Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: _preview(file),
                      ),
                    ),
                if (_filesExpanded)
                  Column(
                    key: _extraFiles,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: files
                        .skip(3)
                        .map(
                          (file) => Padding(
                            padding: const EdgeInsets.only(bottom: 6),
                            child: _preview(file),
                          ),
                        )
                        .toList(),
                  ),
                if (files.length > 3)
                  TextButton(
                    key: const ValueKey('attachment-files-toggle'),
                    onPressed: _toggleFiles,
                    child: Text(
                      attachmentText(
                        context,
                        _filesExpanded ? 'fewer' : 'files',
                        _filesExpanded ? null : files.length - 3,
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// The same encrypted preview path is used by the deck and the large viewer.
Future<Uint8List> _attachmentPreviewBytes(
  AppController controller,
  RelaySession session,
  RelayAttachment attachment, {
  DownloadProgressCallback? onProgress,
}) async {
  if (attachment.thumbnailBytes != null) return attachment.thumbnailBytes!;
  if (attachment.localBytes != null) {
    return createImageThumbnail(
      attachment.localBytes!,
      mimeType: attachment.mimeType,
    );
  }
  if (attachment.url.isEmpty) {
    throw StateError(
      relayuneLocalizationsFor(controller.locale).workbenchImageUrlUnavailable,
    );
  }
  try {
    final bytes = await controller.loadAttachment(
      session.id,
      attachment,
      variant: RelayAttachmentVariant.preview,
      onProgress: onProgress,
    );
    return bytes.lengthInBytes <= maxImageThumbnailBytes
        ? bytes
        : createImageThumbnail(bytes, mimeType: attachment.mimeType);
  } on RelayApiException catch (error) {
    if (!const {
      'attachment_preview_unsupported',
      'attachment_preview_failed',
    }.contains(error.code)) {
      rethrow;
    }
    final original = await controller.loadAttachment(
      session.id,
      attachment,
      onProgress: onProgress,
    );
    return createImageThumbnail(original, mimeType: attachment.mimeType);
  }
}

class _ImageGallery extends StatefulWidget {
  const _ImageGallery({
    required this.attachments,
    required this.initialIndex,
    this.initialOverview = false,
    this.initialPreviews = const {},
    required this.session,
    required this.controller,
    required this.onPageChanged,
  });
  final List<RelayAttachment> attachments;
  final int initialIndex;
  final bool initialOverview;
  final Map<String, Uint8List> initialPreviews;
  final RelaySession session;
  final AppController controller;
  final ValueChanged<int> onPageChanged;

  @override
  State<_ImageGallery> createState() => _ImageGalleryState();
}

class _ImageGalleryState extends State<_ImageGallery> {
  late PageController _pages = PageController(initialPage: widget.initialIndex);
  late int _index = widget.initialIndex;
  late bool _overview = widget.initialOverview;
  bool _zoomed = false;
  final _pointers = <int>{};

  void _trackPointer(PointerEvent event, bool down) {
    final wasScaling = _pointers.length > 1;
    if (down) {
      _pointers.add(event.pointer);
    } else {
      _pointers.remove(event.pointer);
    }
    if (wasScaling != (_pointers.length > 1)) setState(() {});
  }

  void _select(int index) {
    _pages.dispose();
    _pages = PageController(initialPage: index);
    setState(() {
      _index = index;
      _overview = false;
      _zoomed = false;
    });
    widget.onPageChanged(index);
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onPageChanged(_index);
    });
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Dialog.fullscreen(
    key: const ValueKey('attachment-image-gallery'),
    backgroundColor: RelayTheme.background,
    child: ScaffoldMessenger(
      child: Scaffold(
        backgroundColor: RelayTheme.background,
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsetsDirectional.only(start: 20, end: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        '${_index + 1} / ${widget.attachments.length}',
                        key: const ValueKey('attachment-gallery-position'),
                      ),
                    ),
                    if (widget.attachments.length > 1)
                      IconButton(
                        key: const ValueKey(
                          'attachment-gallery-overview-toggle',
                        ),
                        tooltip: attachmentText(
                          context,
                          _overview ? 'collapse' : 'all',
                        ),
                        onPressed: () {
                          if (_overview) {
                            _select(_index);
                          } else {
                            setState(() => _overview = true);
                          }
                        },
                        icon: Icon(
                          _overview
                              ? Icons.photo_outlined
                              : Icons.grid_view_rounded,
                        ),
                      ),
                    IconButton(
                      tooltip: context.l10n.commonClose,
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: _overview
                    ? GridView.builder(
                        key: const ValueKey('attachment-photo-overview'),
                        padding: const EdgeInsets.all(12),
                        gridDelegate:
                            const SliverGridDelegateWithMaxCrossAxisExtent(
                              maxCrossAxisExtent: 160,
                              crossAxisSpacing: 6,
                              mainAxisSpacing: 6,
                            ),
                        itemCount: widget.attachments.length,
                        itemBuilder: (context, i) => LayoutBuilder(
                          builder: (context, constraints) =>
                              _MessageAttachmentPreview(
                                key: ValueKey(widget.attachments[i].id),
                                attachment: widget.attachments[i],
                                session: widget.session,
                                controller: widget.controller,
                                imageSize: Size.square(constraints.maxWidth),
                                fit: BoxFit.cover,
                                onOpen: () => _select(i),
                              ),
                        ),
                      )
                    : Listener(
                        onPointerDown: (event) => _trackPointer(event, true),
                        onPointerUp: (event) => _trackPointer(event, false),
                        onPointerCancel: (event) => _trackPointer(event, false),
                        child: PageView.builder(
                          key: const ValueKey('attachment-gallery-pager'),
                          controller: _pages,
                          physics: _zoomed || _pointers.length > 1
                              ? const NeverScrollableScrollPhysics()
                              : null,
                          itemCount: widget.attachments.length,
                          onPageChanged: (i) {
                            setState(() {
                              _index = i;
                              _zoomed = false;
                            });
                            widget.onPageChanged(i);
                          },
                          itemBuilder: (context, i) => _GalleryPage(
                            key: ValueKey(widget.attachments[i].id),
                            attachment: widget.attachments[i],
                            previewBytes: widget
                                .initialPreviews[widget.attachments[i].id],
                            session: widget.session,
                            controller: widget.controller,
                            onZoomChanged: (zoomed) {
                              if (mounted && _index == i && _zoomed != zoomed) {
                                setState(() => _zoomed = zoomed);
                              }
                            },
                          ),
                        ),
                      ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _GalleryPage extends StatefulWidget {
  const _GalleryPage({
    super.key,
    required this.attachment,
    required this.session,
    required this.controller,
    required this.onZoomChanged,
    this.previewBytes,
  });
  final Uint8List? previewBytes;
  final RelayAttachment attachment;
  final RelaySession session;
  final AppController controller;
  final ValueChanged<bool> onZoomChanged;

  @override
  State<_GalleryPage> createState() => _GalleryPageState();
}

class _GalleryPageState extends State<_GalleryPage> {
  late Future<Uint8List> _bytes = _load();
  final _progress = ValueNotifier<DownloadProgress?>(null);

  Future<Uint8List> _load() => widget.previewBytes != null
      ? Future.value(widget.previewBytes!)
      : _attachmentPreviewBytes(
          widget.controller,
          widget.session,
          widget.attachment,
          onProgress: (progress) {
            if (mounted) _progress.value = progress;
          },
        );

  @override
  void dispose() {
    _progress.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<Uint8List>(
    future: _bytes,
    initialData: widget.previewBytes,
    builder: (context, snapshot) {
      if (snapshot.hasData) {
        return _ImagePreviewDialog(
          controller: widget.controller,
          session: widget.session,
          attachment: widget.attachment,
          previewBytes: snapshot.data!,
          onZoomChanged: widget.onZoomChanged,
        );
      }
      if (snapshot.hasError) {
        return Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.all(20),
                child: Text(
                  context.l10n.workbenchImageReadFailed(widget.attachment.name),
                ),
              ),
              TextButton(
                onPressed: () => setState(() {
                  _progress.value = null;
                  _bytes = _load();
                }),
                child: Text(context.l10n.commonRetry),
              ),
            ],
          ),
        );
      }
      return ValueListenableBuilder<DownloadProgress?>(
        valueListenable: _progress,
        builder: (context, value, _) => ImageLoadingPlaceholder(
          progress: value,
          indicatorKey: ValueKey('gallery-loading-${widget.attachment.id}'),
        ),
      );
    },
  );
}
