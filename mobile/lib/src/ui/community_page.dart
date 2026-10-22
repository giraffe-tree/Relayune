import 'dart:async';

import 'package:flutter/material.dart';
import 'package:gal/gal.dart';
import 'package:intl/intl.dart';

import '../network/community_api.dart';

class CommunityPage extends StatefulWidget {
  const CommunityPage({super.key, this.locale, this.api});
  final Locale? locale;
  final CommunityApi? api;

  @override
  State<CommunityPage> createState() => _CommunityPageState();
}

class _CommunityPageState extends State<CommunityPage>
    with WidgetsBindingObserver {
  late final CommunityApi _api = widget.api ?? CommunityApi();
  Timer? _refreshTimer;
  Timer? _expiryTimer;
  CommunityQr? _qr;
  bool _loading = true;
  bool _failed = false;
  bool _saving = false;
  int _request = 0;

  bool get _chinese =>
      (widget.locale ?? Localizations.localeOf(context)).languageCode == 'zh';
  String _copy(String zh, String en) => _chinese ? zh : en;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startRefreshTimer();
    unawaited(_refresh());
  }

  void _startRefreshTimer() {
    _refreshTimer?.cancel();
    _refreshTimer = Timer.periodic(
      const Duration(minutes: 1),
      (_) => _refresh(),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _startRefreshTimer();
      unawaited(_refresh());
    } else {
      _refreshTimer?.cancel();
    }
  }

  Future<void> _refresh() async {
    final request = ++_request;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final qr = await _api.load();
      if (!mounted || request != _request) return;
      _expiryTimer?.cancel();
      setState(() {
        _qr = qr;
        _loading = false;
      });
      if (!qr.expired) {
        _expiryTimer = Timer(qr.expiresAt.difference(DateTime.now()), () {
          if (mounted) setState(() {});
        });
      }
    } catch (_) {
      if (!mounted || request != _request) return;
      setState(() {
        _qr = null;
        _failed = true;
        _loading = false;
      });
    }
  }

  Future<void> _save() async {
    final qr = _qr;
    if (qr == null || qr.expired || qr.bytes == null || _saving) return;
    setState(() => _saving = true);
    var accessDenied = false;
    try {
      if (!await Gal.hasAccess() && !await Gal.requestAccess()) {
        accessDenied = true;
        throw StateError('Photo access denied');
      }
      if (!mounted || qr.expired || _qr != qr) return;
      await Gal.putImageBytes(qr.bytes!, name: 'Relayune-community');
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            _copy(
              '已保存到相册，在微信「扫一扫」中选择这张图片。',
              'Saved to Photos. Select this image in WeChat Scan.',
            ),
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      final denied =
          accessDenied ||
          error is GalException && error.type == GalExceptionType.accessDenied;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            denied
                ? _copy(
                    '请在系统设置中允许保存图片到相册后重试。',
                    'Allow saving to Photos in system settings, then try again.',
                  )
                : _copy('保存失败，请重试。', 'Could not save the image. Try again.'),
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _refreshTimer?.cancel();
    _expiryTimer?.cancel();
    if (widget.api == null) _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final qr = _qr;
    final active = qr != null && !qr.expired && qr.bytes != null && !_failed;
    return Scaffold(
      appBar: AppBar(title: Text(_copy('加入内测群', 'Join beta group'))),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refresh,
          child: ListView(
            padding: const EdgeInsets.all(24),
            physics: const AlwaysScrollableScrollPhysics(),
            children: [
              Text(
                _copy('Relayune 用户内测群', 'Relayune WeChat beta group'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              Text(
                _copy(
                  '交流使用体验，一起改进 Relayune。',
                  'Share your experience and help improve Relayune.',
                ),
              ),
              const SizedBox(height: 24),
              if (_loading) const LinearProgressIndicator(),
              if (active) ...[
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Image.memory(
                    qr.bytes!,
                    key: ValueKey(qr.imageUri.toString()),
                    semanticLabel: _copy('内测群二维码', 'Beta group QR code'),
                    errorBuilder: (_, error, stack) => Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        _copy(
                          '图片无法显示，请刷新重试。',
                          'Unable to display image. Please refresh.',
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  _copy('有效至 ', 'Valid until ') +
                      DateFormat('yyyy-MM-dd HH:mm').format(
                        qr.expiresAt.toUtc().add(const Duration(hours: 8)),
                      ) +
                      _copy('（北京时间）', ' (UTC+8)'),
                ),
                const SizedBox(height: 16),
                FilledButton.icon(
                  key: const ValueKey('community-save'),
                  onPressed: _saving || _loading ? null : _save,
                  icon: const Icon(Icons.download_rounded),
                  label: Text(
                    _saving
                        ? _copy('正在保存…', 'Saving…')
                        : _copy('保存二维码到相册', 'Save QR to Photos'),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  _copy(
                    '保存后打开微信「扫一扫」，从相册选择二维码加入群聊。',
                    'Open WeChat Scan and choose the saved image from Photos to join.',
                  ),
                ),
              ] else if (!_loading) ...[
                const Icon(Icons.qr_code_rounded, size: 64),
                const SizedBox(height: 16),
                Text(
                  _failed
                      ? _copy(
                          '暂时无法获取最新二维码，请检查网络后重试。',
                          'Unable to load the latest QR code. Check your connection and retry.',
                        )
                      : _copy(
                          '群二维码已过期，正在等待更新。',
                          'This QR code has expired. Waiting for an update.',
                        ),
                ),
              ],
              const SizedBox(height: 16),
              TextButton.icon(
                key: const ValueKey('community-refresh'),
                onPressed: _loading ? null : _refresh,
                icon: const Icon(Icons.refresh_rounded),
                label: Text(_copy('刷新二维码', 'Refresh QR code')),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
