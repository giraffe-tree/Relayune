import 'package:flutter/material.dart';

import '../state/app_controller.dart';

class TransportSettingsPage extends StatelessWidget {
  const TransportSettingsPage({
    super.key,
    required this.controller,
    this.locale,
  });
  final AppController controller;
  final Locale? locale;

  static String status(AppController controller, bool zh) =>
      switch (controller.directReadStatus) {
        'direct' => zh ? '当前：WebRTC 直连' : 'Active: WebRTC direct',
        'connecting' => zh ? '正在连接，当前使用服务器' : 'Connecting; using server',
        'unsupported' =>
          zh
              ? '当前使用服务器，请连接支持直连的 Desktop'
              : 'Using server; connect an updated Desktop',
        'fallback' =>
          zh
              ? '当前使用服务器，稍后自动检测直连'
              : 'Using server; direct connection will be checked again',
        _ => zh ? '当前：服务器中转' : 'Active: server relay',
      };

  @override
  Widget build(BuildContext context) {
    final zh = (locale ?? Localizations.localeOf(context)).languageCode == 'zh';
    return Scaffold(
      appBar: AppBar(title: Text(zh ? '连接链路' : 'Connection route')),
      body: AnimatedBuilder(
        animation: controller,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(
              zh ? '会话连接方式' : 'Session connection route',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            for (final direct in [true, false])
              ListTile(
                key: ValueKey('transport-${direct ? 'direct' : 'server'}'),
                contentPadding: EdgeInsets.zero,
                leading: Icon(
                  direct ? Icons.swap_horiz_rounded : Icons.cloud_outlined,
                ),
                title: Text(
                  direct
                      ? (zh ? '自动选择（推荐）' : 'Automatic (recommended)')
                      : (zh ? '服务器中转' : 'Server relay'),
                ),
                subtitle: Text(
                  direct
                      ? (zh
                            ? '后台验证直连，可用时自动切换，失效时回退服务器'
                            : 'Verify a direct connection in the background; switch automatically and fall back when needed')
                      : (zh
                            ? '始终通过服务器传输'
                            : 'Always transfer through the server'),
                ),
                trailing: controller.directReadsEnabled == direct
                    ? const Icon(Icons.check_rounded)
                    : null,
                onTap: () async {
                  final saved = await controller.setDirectReads(direct);
                  if (!saved && context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          zh ? '未能保存，请重试' : 'Could not save. Please retry.',
                        ),
                      ),
                    );
                  }
                },
              ),
            const Divider(height: 32),
            Text(
              status(controller, zh),
              key: const ValueKey('transport-active-status'),
            ),
            if (controller.directReadsEnabled)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  key: const ValueKey('transport-retry'),
                  onPressed:
                      controller.directReadStatus == 'connecting' ||
                          controller.directReadStatus == 'direct'
                      ? null
                      : controller.retryAutomaticRoute,
                  child: Text(zh ? '立即检测' : 'Check now'),
                ),
              ),
            const SizedBox(height: 16),
            Text(
              zh
                  ? '消息、审批、实时更新、历史与附件均优先直连。直连中断时自动回退；登录、授权与连接协商仍需服务器。两种链路都保持端到端加密。'
                  : 'Messages, approvals, live updates, history and attachments prefer a direct connection, with automatic server fallback. Sign-in, authorization and connection setup still need the server. Both routes remain end-to-end encrypted.',
            ),
          ],
        ),
      ),
    );
  }
}
