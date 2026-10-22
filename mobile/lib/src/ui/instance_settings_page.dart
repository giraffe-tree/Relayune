import 'package:flutter/material.dart';

import '../config.dart';
import '../network/instance_endpoint.dart';
import '../network/relay_api.dart';
import '../state/app_controller.dart';

class InstanceSettingsPage extends StatefulWidget {
  const InstanceSettingsPage({
    super.key,
    required this.controller,
    this.probeFactory,
  });
  final AppController controller;

  /// Allows an isolated anonymous transport in widget tests.
  final RelayApi Function(String origin, String? certificatePem)? probeFactory;
  @override
  State<InstanceSettingsPage> createState() => _InstanceSettingsPageState();
}

class _InstanceSettingsPageState extends State<InstanceSettingsPage> {
  late final _origin = TextEditingController(
    text: widget.controller.api.origin,
  );
  late final _certificate = TextEditingController(
    text: widget.controller.api.certificatePem ?? '',
  );
  bool _busy = false;
  String? _error;
  bool get zh => Localizations.localeOf(context).languageCode == 'zh';
  String text(String chinese, String english) => zh ? chinese : english;
  @override
  void dispose() {
    _origin.dispose();
    _certificate.dispose();
    super.dispose();
  }

  Future<bool> _confirm(String title, String message) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(title),
          content: SingleChildScrollView(child: SelectableText(message)),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(text('取消', 'Cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(text('确认', 'Confirm')),
            ),
          ],
        ),
      ) ??
      false;

  Future<void> _connect() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    RelayApi? probe;
    try {
      final origin = normalizeInstanceOrigin(_origin.text);
      final pem = _certificate.text.trim();
      if (origin == RelayConfig.officialOrigin && pem.isNotEmpty) {
        throw FormatException(
          text(
            '官方服务使用系统信任的证书，不接受额外证书。',
            'The official service uses system trust; remove the custom CA.',
          ),
        );
      }
      final fingerprint = certificateFingerprint(pem);
      final displayFingerprint = fingerprint == null
          ? null
          : RegExp(
              r'.{2}',
            ).allMatches(fingerprint).map((match) => match.group(0)).join(':');
      if (fingerprint != null &&
          !await _confirm(
            text('核对实例证书', 'Verify the instance CA'),
            '${text('请通过部署者的本机安装输出或其他可信渠道核对以下 SHA-256。只有完全一致才继续。不要从未知网页导入证书。', 'Compare this SHA-256 with the owner’s local installation output or another trusted channel. Continue only if it matches. Never trust a certificate from an unknown page.')}\n\n$origin\n\n$displayFingerprint',
          )) {
        return;
      }
      // A new, anonymous client has no session, browser token or old cookies.
      probe =
          widget.probeFactory?.call(origin, pem) ??
          RelayApi(origin: origin, certificatePem: pem);
      final capabilities = await probe.discoverInstance();
      if (!mounted) return;
      final confirmed = await _confirm(
        text('连接到此服务器？', 'Connect to this server?'),
        '$origin\n\n${capabilities.usernameMode ? text('用户名密码登录', 'Username and password') : text('邮箱登录', 'Email sign-in')}\n\n${capabilities.setupRequired ? text('此实例尚未初始化，请由部署者在服务器本机完成。\n\n', 'The owner must initialize this instance locally on the server.\n\n') : ''}${text('切换将退出当前实例，删除手机上的登录、电脑配对密钥和加密缓存，停止通知与连接。新实例需要重新登录并逐台配对；同名账户也不会合并。', 'Switching signs out, deletes this phone’s current login, computer pairing keys and encrypted cache, and stops notifications and connections. Sign in and pair every computer again; matching account names are never merged.')}',
      );
      if (!confirmed || !mounted) return;
      if (widget.controller.changeInstance == null) {
        throw StateError('Instance switching unavailable');
      }
      final route = ModalRoute.of(context);
      final navigator = Navigator.of(context);
      await widget.controller.changeInstance!(origin, pem.isEmpty ? null : pem);
      // Instance teardown can already remove this page. Its exit animation may
      // leave it mounted briefly; never pop the login route underneath it.
      if (mounted && route?.isCurrent == true && navigator.canPop()) {
        navigator.pop();
      }
    } on Object {
      if (mounted) {
        setState(
          () => _error = text(
            '未能连接或切换。请核对 HTTPS 地址、VPN／公网入口、证书指纹和服务器状态。不会忽略证书验证。',
            'Could not connect or switch. Check the HTTPS address, VPN/public entry, CA fingerprint and server status. Certificate validation remains enabled.',
          ),
        );
      }
    } finally {
      probe?.close();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(text('服务实例', 'Server instance'))),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(
          text(
            '官方服务或自己的 Relayune 服务器',
            'Official service or your Relayune server',
          ),
          style: Theme.of(context).textTheme.titleLarge,
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: _origin,
          enabled: !_busy,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: InputDecoration(
            labelText: text('HTTPS 服务地址', 'HTTPS server origin'),
            hintText: 'https://192.0.2.10',
          ),
        ),
        TextButton(
          onPressed: _busy
              ? null
              : () {
                  _origin.text = RelayConfig.officialOrigin;
                  _certificate.clear();
                },
          child: Text(text('使用官方服务', 'Use official service')),
        ),
        const SizedBox(height: 12),
        Text(
          text(
            '使用自备 VPN 或安全公网入口。没有公共证书时，可粘贴安装程序生成的公开 CA 证书，并通过可信渠道核对指纹。证书只用于所选实例，不会关闭主机名、有效期或签名验证。',
            'Use your VPN or a secure public entry. For a private CA, paste the public certificate generated by the installer and compare its fingerprint through a trusted channel. Trust applies only to this instance; hostname, expiry and signature checks remain enabled.',
          ),
        ),
        const SizedBox(height: 16),
        TextFormField(
          controller: _certificate,
          enabled: !_busy,
          maxLines: 5,
          autocorrect: false,
          enableSuggestions: false,
          decoration: InputDecoration(
            labelText: text(
              '公开 CA 证书（可选，PEM）',
              'Public CA certificate (optional, PEM)',
            ),
            hintText: '-----BEGIN CERTIFICATE-----',
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Text(_error!, style: const TextStyle(color: Colors.orange)),
          ),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: _busy ? null : _connect,
          child: Text(text('检查连接并切换', 'Check connection and switch')),
        ),
        if (_busy)
          const Padding(
            padding: EdgeInsets.all(16),
            child: LinearProgressIndicator(),
          ),
      ],
    ),
  );
}
