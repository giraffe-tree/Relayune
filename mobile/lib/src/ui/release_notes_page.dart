import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../models.dart';
import '../network/relay_api.dart';
import 'theme.dart';

class ReleaseNotesPage extends StatefulWidget {
  const ReleaseNotesPage({super.key, required this.api, this.locale});

  final RelayApi api;
  final Locale? locale;

  @override
  State<ReleaseNotesPage> createState() => _ReleaseNotesPageState();
}

class _ReleaseNotesPageState extends State<ReleaseNotesPage> {
  Future<List<RelayRelease>>? _releases;
  String? _requestedLocale;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _loadForLocale(_currentLocale);
  }

  @override
  void didUpdateWidget(covariant ReleaseNotesPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.locale != widget.locale) {
      _loadForLocale(_currentLocale);
    }
  }

  void _loadForLocale(Locale currentLocale) {
    final locale = _apiLocale(currentLocale);
    if (locale == _requestedLocale) return;
    _requestedLocale = locale;
    _releases = widget.api.releases(locale: locale);
  }

  void _retry() {
    final next = widget.api.releases(locale: _requestedLocale ?? 'zh-CN');
    setState(() {
      _releases = next;
    });
  }

  @override
  Widget build(BuildContext context) {
    final languageCode = _languageCode;
    final copy = widget.locale == null
        ? context.l10n
        : relayuneLocalizationsFor(widget.locale!);
    return Scaffold(
      appBar: AppBar(title: Text(copy.releaseTitle)),
      body: SafeArea(
        top: false,
        child: FutureBuilder<List<RelayRelease>>(
          future: _releases,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return Center(
                child: Semantics(
                  label: copy.releaseLoading,
                  child: const CircularProgressIndicator(),
                ),
              );
            }
            if (snapshot.hasError) {
              return _ReleaseState(
                icon: Icons.cloud_off_outlined,
                title: copy.releaseErrorTitle,
                message: copy.releaseErrorMessage,
                actionLabel: copy.commonRetry,
                onAction: _retry,
              );
            }
            final releases = snapshot.data ?? const [];
            if (releases.isEmpty) {
              return _ReleaseState(
                icon: Icons.history_outlined,
                title: copy.releaseEmptyTitle,
                message: copy.releaseEmptyMessage,
              );
            }
            return ListView.separated(
              key: const Key('release-notes-list'),
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: releases.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, index) => _ReleaseCard(
                release: releases[index],
                languageCode: languageCode,
                copy: copy,
              ),
            );
          },
        ),
      ),
    );
  }

  String get _languageCode => _currentLocale.languageCode;

  Locale get _currentLocale =>
      widget.locale ?? View.of(context).platformDispatcher.locale;
}

class _ReleaseCard extends StatelessWidget {
  const _ReleaseCard({
    required this.release,
    required this.languageCode,
    required this.copy,
  });

  final RelayRelease release;
  final String languageCode;
  final AppLocalizations copy;

  @override
  Widget build(BuildContext context) {
    final title = release.title;
    final highlights = release.items;
    final versionLabel = 'v${release.version}';
    final contentDirection = _releaseContentDirection(release.locale);
    return Semantics(
      container: true,
      label: '${copy.releaseVersion} ${release.version}',
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(18),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    versionLabel,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if (release.publishedAt.isNotEmpty)
                    Text(
                      _dateLabel(context, release.publishedAt),
                      style: const TextStyle(
                        fontSize: 12,
                        color: RelayTheme.muted,
                      ),
                    ),
                ],
              ),
              if (release.platforms.isNotEmpty) ...[
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: release.platforms
                      .map(
                        (platform) => Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: RelayTheme.greenBackground,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            _platformLabel(platform, languageCode),
                            style: const TextStyle(
                              color: RelayTheme.greenStrong,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      )
                      .toList(growable: false),
                ),
              ],
              if (title.isNotEmpty) ...[
                const SizedBox(height: 14),
                Directionality(
                  key: ValueKey('release-title-direction-${release.version}'),
                  textDirection: contentDirection,
                  child: Text(
                    title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
              if (highlights.isNotEmpty) ...[
                const SizedBox(height: 12),
                ...highlights.asMap().entries.map(
                  (entry) => Padding(
                    padding: const EdgeInsets.only(bottom: 6),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Padding(
                          padding: EdgeInsets.only(top: 7),
                          child: Icon(
                            Icons.circle,
                            size: 5,
                            color: RelayTheme.fern,
                          ),
                        ),
                        const SizedBox(width: 9),
                        Expanded(
                          child: Directionality(
                            key: ValueKey(
                              'release-item-direction-${release.version}-${entry.key}',
                            ),
                            textDirection: contentDirection,
                            child: Text(entry.value),
                          ),
                        ),
                      ],
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

class _ReleaseState extends StatelessWidget {
  const _ReleaseState({
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 360),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 36, color: RelayTheme.muted),
            const SizedBox(height: 12),
            Text(
              title,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 6),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: RelayTheme.muted),
            ),
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 16),
              OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    ),
  );
}

String _dateLabel(BuildContext context, String value) {
  final date = DateTime.tryParse(value)?.toLocal();
  if (date == null) return value;
  return MaterialLocalizations.of(context).formatMediumDate(date);
}

String _apiLocale(Locale locale) =>
    relayuneResolveLocale([locale]).toLanguageTag();

TextDirection _releaseContentDirection(String locale) {
  final language = locale.split(RegExp('[-_]')).first.toLowerCase();
  return const {'ar', 'ur'}.contains(language)
      ? TextDirection.rtl
      : TextDirection.ltr;
}

String _platformLabel(String platform, String languageCode) {
  const shared = {
    'android': 'Android',
    'ios': 'iOS',
    'macos': 'macOS',
    'windows': 'Windows',
  };
  final normalized = platform.toLowerCase();
  if (shared[normalized] case final label?) return label;
  final copy = relayuneLocalizationsFor(Locale(languageCode));
  if (normalized == 'web') {
    return copy.releaseWeb;
  }
  if (normalized == 'server') {
    return copy.releaseServer;
  }
  return platform;
}
