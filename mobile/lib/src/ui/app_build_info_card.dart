import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../build_provenance.dart';
import '../version_info.dart';
import 'theme.dart';

class AppBuildInfoCard extends StatefulWidget {
  const AppBuildInfoCard({
    super.key,
    this.locale,
    this.provenance = const BuildProvenance(),
    this.loadVersion = loadRelayuneVersion,
  });

  final Locale? locale;
  final BuildProvenance provenance;
  final AppVersionLoader loadVersion;

  @override
  State<AppBuildInfoCard> createState() => _AppBuildInfoCardState();
}

class _AppBuildInfoCardState extends State<AppBuildInfoCard> {
  late Future<String> _version = widget.loadVersion();

  @override
  void didUpdateWidget(AppBuildInfoCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.loadVersion != widget.loadVersion) {
      _version = widget.loadVersion();
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = widget.locale == null
        ? context.l10n
        : relayuneLocalizationsFor(widget.locale!);
    final info = widget.provenance;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              copy.settingsBuildInfo,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            FutureBuilder<String>(
              future: _version,
              builder: (context, snapshot) => SelectableText(
                'Relayune ${snapshot.data ?? (snapshot.hasError ? copy.buildUnrecorded : '…')}',
                textDirection: TextDirection.ltr,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              copy.buildTime,
              style: const TextStyle(color: RelayTheme.muted),
            ),
            SelectableText(
              info.localBuildTime ?? copy.buildUnrecorded,
              key: const ValueKey('app-build-time'),
              textDirection: TextDirection.ltr,
            ),
            const SizedBox(height: 12),
            Text(
              copy.buildSourceCommit,
              style: const TextStyle(color: RelayTheme.muted),
            ),
            SelectableText(
              info.shortCommit ?? copy.buildUnrecorded,
              key: const ValueKey('app-build-commit'),
              textDirection: TextDirection.ltr,
            ),
            if (info.sourceDirty) Text(copy.buildUncommitted),
          ],
        ),
      ),
    );
  }
}
