import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../l10n/relayune_localizations.dart';
import '../state/app_controller.dart';
import '../state/font_size.dart';
import 'account_deletion_page.dart';
import 'app_build_info_card.dart';
import 'feedback_page.dart';
import 'community_page.dart';
import 'notification_permission_sheet.dart';
import 'release_notes_page.dart';
import 'theme.dart';
import 'instance_settings_page.dart';
import 'transport_settings_page.dart';
import '../state/agent_order.dart';

typedef ExternalUriOpener = Future<bool> Function(Uri uri);

class SettingsPage extends StatefulWidget {
  const SettingsPage({
    super.key,
    required this.controller,
    required this.devicePageBuilder,
    this.locale,
    this.openExternal,
  });

  final AppController controller;
  final WidgetBuilder devicePageBuilder;
  final Locale? locale;
  final ExternalUriOpener? openExternal;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  static final _supportUri = Uri(
    scheme: 'mailto',
    path: 'giraffetree1@gmail.com',
    queryParameters: {'subject': 'Relayune Support'},
  );

  AppController get controller => widget.controller;

  Future<void> _showSidebarAgents() async {
    bool saving = false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, update) => SafeArea(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: Text(context.l10n.settingsSidebarAgents),
                ),
                for (final id in controller.agentOrder)
                  SwitchListTile.adaptive(
                    key: ValueKey('sidebar-agent-$id'),
                    title: Text(
                      '${agentLabels[id]}${isBetaAgent(id) ? ' · Beta' : ''}',
                    ),
                    value: controller.visibleAgents.contains(id),
                    onChanged: saving
                        ? null
                        : (enabled) async {
                            update(() => saving = true);
                            final next = [...controller.visibleAgents];
                            if (enabled) {
                              next.add(id);
                            } else {
                              next.remove(id);
                            }
                            final saved = await controller.setVisibleAgents(
                              next,
                            );
                            if (!context.mounted) return;
                            update(() => saving = false);
                            if (!saved) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    context.l10n.workbenchAgentOrderSaveFailed,
                                  ),
                                ),
                              );
                            }
                          },
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final copy = _SettingsCopy.from(context, widget.locale);
    final l10n = widget.locale == null
        ? context.l10n
        : relayuneLocalizationsFor(widget.locale!);
    return Scaffold(
      appBar: AppBar(title: Text(copy.pageTitle)),
      body: SafeArea(
        top: false,
        child: AnimatedBuilder(
          animation: controller,
          builder: (context, _) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
            children: [
              _AccountSummary(
                key: const ValueKey('settings-account-summary'),
                email: controller.accountDisplayName,
                accountLabel: copy.signedInAccount,
              ),
              const SizedBox(height: 24),
              _SettingsSection(
                title: copy.preferencesSection,
                children: [
                  _SettingsTile(
                    key: const ValueKey('settings-instance-entry'),
                    icon: Icons.dns_outlined,
                    title: Localizations.localeOf(context).languageCode == 'zh'
                        ? '服务实例'
                        : 'Server instance',
                    subtitle: controller.api.origin,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) =>
                            InstanceSettingsPage(controller: controller),
                      ),
                    ),
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-sidebar-agents'),
                    icon: Icons.view_sidebar_outlined,
                    title: l10n.settingsSidebarAgents,
                    subtitle: l10n.settingsSidebarAgentsSubtitle,
                    onTap: _showSidebarAgents,
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-transport-entry'),
                    icon: Icons.swap_horiz_rounded,
                    title:
                        (widget.locale ?? Localizations.localeOf(context))
                                .languageCode ==
                            'zh'
                        ? '连接链路'
                        : 'Connection route',
                    subtitle: TransportSettingsPage.status(
                      controller,
                      (widget.locale ?? Localizations.localeOf(context))
                              .languageCode ==
                          'zh',
                    ),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => TransportSettingsPage(
                          controller: controller,
                          locale: widget.locale,
                        ),
                      ),
                    ),
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-device-entry'),
                    icon: Icons.laptop_mac_rounded,
                    title: copy.device,
                    subtitle: controller.deviceStatusLabel,
                    onTap: _openDevice,
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-language-entry'),
                    icon: Icons.language_rounded,
                    title: copy.language,
                    subtitle: controller.usesSystemLocale
                        ? copy.languageSystemDefaultValue(
                            relayuneNativeLanguageName(controller.systemLocale),
                          )
                        : relayuneNativeLanguageName(controller.locale),
                    onTap: _showLanguagePicker,
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-font-size-entry'),
                    icon: Icons.format_size_rounded,
                    title: l10n.settingsFontSize,
                    subtitle: _fontSizeLabel(l10n, controller.fontSize),
                    onTap: () => _showFontSizePicker(l10n),
                  ),
                  SwitchListTile.adaptive(
                    key: const ValueKey('settings-haptics-switch'),
                    secondary: const Icon(Icons.vibration_rounded),
                    title: Text(l10n.settingsHapticsTitle),
                    subtitle: Text(l10n.settingsHapticsSubtitle),
                    value: controller.haptics.enabled,
                    onChanged: controller.setHapticsEnabled,
                  ),
                  _SettingsTile(
                    key: const ValueKey('notification-settings-entry'),
                    icon: Icons.notifications_outlined,
                    title: l10n.workbenchNotificationSettings,
                    subtitle: l10n.workbenchNotificationStatus(
                      controller.notificationStatusLabel,
                    ),
                    onTap: () =>
                        showNotificationPermissionPrimer(context, controller),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              _SettingsSection(
                title: copy.accountSection,
                children: [
                  _SettingsTile(
                    key: const ValueKey('settings-release-notes-entry'),
                    icon: Icons.history_outlined,
                    title: copy.releaseNotes,
                    onTap: _openReleaseNotes,
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-logout-entry'),
                    icon: Icons.logout_rounded,
                    title: copy.logout,
                    color: RelayTheme.red,
                    onTap: _logout,
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-delete-account-entry'),
                    icon: Icons.person_remove_outlined,
                    title: l10n.accountDeletionTitle,
                    color: RelayTheme.red,
                    onTap: () {
                      if (controller.usernameLogin) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              Localizations.localeOf(context).languageCode ==
                                      'zh'
                                  ? '自托管所有者账户请通过服务器本机管理，不能在手机删除。'
                                  : 'Manage the self-hosted owner account locally on the server.',
                            ),
                          ),
                        );
                      } else {
                        openAccountDeletion(context, controller);
                      }
                    },
                  ),
                ],
              ),
              const SizedBox(height: 24),
              _SettingsSection(
                title: copy.helpAndLegalSection,
                children: [
                  _SettingsTile(
                    key: const ValueKey('settings-community-entry'),
                    icon: Icons.groups_outlined,
                    title:
                        (widget.locale ?? Localizations.localeOf(context))
                                .languageCode ==
                            'zh'
                        ? '加入内测群'
                        : 'Join beta group',
                    subtitle:
                        (widget.locale ?? Localizations.localeOf(context))
                                .languageCode ==
                            'zh'
                        ? '微信交流 · 获取最新群二维码'
                        : 'WeChat · Get the latest group QR code',
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => CommunityPage(locale: widget.locale),
                      ),
                    ),
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-feedback-entry'),
                    icon: Icons.feedback_outlined,
                    title:
                        (widget.locale == null
                                ? context.l10n
                                : relayuneLocalizationsFor(widget.locale!))
                            .feedbackTitle,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => FeedbackPage(
                          email: controller.usernameLogin
                              ? null
                              : controller.email,
                          locale: widget.locale,
                          api: controller.api,
                        ),
                      ),
                    ),
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-support-entry'),
                    icon: Icons.support_agent_rounded,
                    title: copy.support,
                    subtitle: 'giraffetree1@gmail.com',
                    onTap: () => _openExternal(_supportUri, copy),
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-terms-entry'),
                    icon: Icons.description_outlined,
                    title: copy.terms,
                    subtitle: copy.legalLanguage,
                    onTap: () => _openExternal(
                      Uri.parse(
                        controller.api.origin,
                      ).resolve(copy.termsUri.path),
                      copy,
                    ),
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-privacy-entry'),
                    icon: Icons.privacy_tip_outlined,
                    title: copy.privacy,
                    subtitle: copy.legalLanguage,
                    onTap: () => _openExternal(
                      Uri.parse(
                        controller.api.origin,
                      ).resolve(copy.privacyUri.path),
                      copy,
                    ),
                  ),
                  _SettingsTile(
                    key: const ValueKey('settings-licenses-entry'),
                    icon: Icons.copyright_outlined,
                    title: MaterialLocalizations.of(context).licensesPageTitle,
                    onTap: () => showLicensePage(
                      context: context,
                      applicationName: 'Relayune',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
              AppBuildInfoCard(
                key: const ValueKey('settings-build-info'),
                locale: widget.locale,
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _openDevice() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: widget.devicePageBuilder));
  }

  String _fontSizeLabel(AppLocalizations l10n, RelayFontSize size) =>
      switch (size) {
        RelayFontSize.small => l10n.settingsFontSizeSmall,
        RelayFontSize.medium => l10n.settingsFontSizeMedium,
        RelayFontSize.large => l10n.settingsFontSizeLarge,
      };

  Future<void> _showFontSizePicker(AppLocalizations l10n) async {
    final selection = await showModalBottomSheet<RelayFontSize>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                child: Text(
                  l10n.settingsFontSize,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              for (final size in RelayFontSize.values)
                ListTile(
                  key: ValueKey('settings-font-size-${size.name}'),
                  title: Text(_fontSizeLabel(l10n, size)),
                  selected: controller.fontSize == size,
                  trailing: controller.fontSize == size
                      ? const Icon(
                          Icons.check_rounded,
                          color: RelayTheme.greenStrong,
                        )
                      : null,
                  onTap: () => Navigator.of(context).pop(size),
                ),
            ],
          ),
        ),
      ),
    );
    if (selection == null || !mounted) return;
    final saved = await controller.setFontSize(selection);
    if (saved || !mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(l10n.settingsFontSizeSaveFailed)));
  }

  Future<void> _showLanguagePicker() async {
    final copy = _SettingsCopy.from(context, widget.locale);
    final selectedTag = controller.preferredLocaleTag;
    final selection = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(sheetContext).height * 0.78,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(24, 4, 24, 12),
                child: Text(
                  copy.language,
                  style: Theme.of(
                    sheetContext,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
                ),
              ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    _LanguageChoiceTile(
                      key: const ValueKey('settings-language-system'),
                      title: copy.languageSystemDefault,
                      subtitle: relayuneNativeLanguageName(
                        controller.systemLocale,
                      ),
                      selected: selectedTag == null,
                      value: '',
                    ),
                    for (final option in relayuneLanguageOptions)
                      _LanguageChoiceTile(
                        key: ValueKey('settings-language-${option.tag}'),
                        title: option.nativeName,
                        selected: selectedTag == option.tag,
                        value: option.tag,
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
    if (selection == null || !mounted) return;
    final saved = await controller.setPreferredLocale(
      selection.isEmpty ? null : selection,
    );
    if (saved || !mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(copy.languageSaveFailed)));
  }

  void _openReleaseNotes() {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            ReleaseNotesPage(api: controller.api, locale: widget.locale),
      ),
    );
  }

  void _logout() {
    Navigator.of(context).pop();
    unawaited(controller.logout());
  }

  Future<void> _openExternal(Uri uri, _SettingsCopy copy) async {
    try {
      final opened = await (widget.openExternal ?? _launchExternal)(uri);
      if (opened || !mounted) return;
    } catch (_) {
      if (!mounted) return;
    }
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(copy.openLinkFailed)));
  }

  static Future<bool> _launchExternal(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);
}

class _AccountSummary extends StatelessWidget {
  const _AccountSummary({
    super.key,
    required this.email,
    required this.accountLabel,
  });
  final String email;
  final String accountLabel;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            accountLabel,
            style: const TextStyle(color: RelayTheme.muted, fontSize: 12),
          ),
          const SizedBox(height: 6),
          SelectableText(
            email,
            textDirection: TextDirection.ltr,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ],
      ),
    ),
  );
}

class _SettingsSection extends StatelessWidget {
  const _SettingsSection({required this.title, required this.children});

  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(4, 0, 4, 9),
        child: Text(
          title,
          style: const TextStyle(
            color: RelayTheme.mutedBright,
            fontSize: 13,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            for (var index = 0; index < children.length; index++) ...[
              children[index],
              if (index < children.length - 1)
                const Divider(indent: 52, height: 1),
            ],
          ],
        ),
      ),
    ],
  );
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    super.key,
    required this.icon,
    required this.title,
    required this.onTap,
    this.subtitle,
    this.color,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Color? color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    minTileHeight: 56,
    leading: Icon(icon, color: color),
    title: Text(
      title,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(color: color, fontWeight: FontWeight.w600),
    ),
    subtitle: subtitle == null
        ? null
        : Text(
            subtitle!,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: RelayTheme.muted, fontSize: 12),
          ),
    trailing: Icon(Icons.chevron_right_rounded, color: color),
    onTap: onTap,
  );
}

class _LanguageChoiceTile extends StatelessWidget {
  const _LanguageChoiceTile({
    super.key,
    required this.title,
    required this.selected,
    required this.value,
    this.subtitle,
  });

  final String title;
  final String? subtitle;
  final bool selected;
  final String value;

  @override
  Widget build(BuildContext context) => ListTile(
    title: Text(title),
    subtitle: subtitle == null ? null : Text(subtitle!),
    trailing: selected
        ? const Icon(Icons.check_rounded, color: RelayTheme.greenStrong)
        : null,
    onTap: () => Navigator.of(context).pop(value),
  );
}

class _SettingsCopy {
  const _SettingsCopy({
    required this.pageTitle,
    required this.signedInAccount,
    required this.accountSection,
    required this.preferencesSection,
    required this.helpAndLegalSection,
    required this.device,
    required this.language,
    required this.languageSystemDefault,
    required this.languageSystemDefaultValue,
    required this.languageSaveFailed,
    required this.releaseNotes,
    required this.logout,
    required this.support,
    required this.terms,
    required this.privacy,
    required this.legalLanguage,
    required this.termsUri,
    required this.privacyUri,
    required this.close,
    required this.openLinkFailed,
  });

  final String pageTitle;
  final String signedInAccount;
  final String accountSection;
  final String preferencesSection;
  final String helpAndLegalSection;
  final String device;
  final String language;
  final String languageSystemDefault;
  final String Function(String language) languageSystemDefaultValue;
  final String languageSaveFailed;
  final String releaseNotes;
  final String logout;
  final String support;
  final String terms;
  final String privacy;
  final String legalLanguage;
  final Uri termsUri;
  final Uri privacyUri;
  final String close;
  final String openLinkFailed;

  static _SettingsCopy from(BuildContext context, Locale? locale) {
    final resolvedLocale = locale ?? Localizations.maybeLocaleOf(context);
    final copy = resolvedLocale == null
        ? context.l10n
        : relayuneLocalizationsFor(resolvedLocale);
    final chinese = resolvedLocale?.languageCode == 'zh';
    final legalPrefix = chinese ? 'zh' : 'en';
    return _SettingsCopy(
      pageTitle: copy.settingsTitle,
      signedInAccount: copy.settingsSignedInAccount,
      accountSection: copy.settingsAccountSection,
      preferencesSection: copy.settingsPreferencesSection,
      helpAndLegalSection: copy.settingsHelpLegalSection,
      device: copy.workbenchDevice,
      language: copy.settingsLanguage,
      languageSystemDefault: copy.settingsLanguageSystemDefault,
      languageSystemDefaultValue: copy.settingsLanguageSystemDefaultValue,
      languageSaveFailed: copy.settingsLanguageSaveFailed,
      releaseNotes: copy.settingsReleaseNotes,
      logout: copy.commonLogOut,
      support: copy.settingsSupport,
      terms: copy.settingsTerms,
      privacy: copy.settingsPrivacy,
      legalLanguage: copy.settingsLegalLanguage,
      termsUri: Uri.parse(
        'https://relayune.giraffetree.cn/$legalPrefix/legal/terms/',
      ),
      privacyUri: Uri.parse(
        'https://relayune.giraffetree.cn/$legalPrefix/legal/privacy/',
      ),
      close: copy.commonClose,
      openLinkFailed: copy.settingsOpenLinkFailed,
    );
  }
}
