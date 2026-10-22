import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../state/app_controller.dart';
import '../widgets/opening_scene.dart';
import '../widgets/status_banner.dart';
import 'theme.dart';
import 'instance_settings_page.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, required this.controller});

  final AppController controller;

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _formKey = GlobalKey<FormState>();
  bool _busy = false;
  bool _obscure = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final compact =
        MediaQuery.viewInsetsOf(context).bottom > 0 ||
        controller.loginStage != LoginStage.email;
    return Scaffold(
      backgroundColor: const Color(0xFF0B1220),
      body: OpeningScene(
        welcome: true,
        child: SafeArea(
          child: LayoutBuilder(
            builder: (context, constraints) => SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(24, 26, 24, 24),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: (constraints.maxHeight - 50).clamp(
                    0.0,
                    double.infinity,
                  ),
                ),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 420),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (!compact) ...[
                          const SizedBox(height: 34),
                          const OpeningHero(),
                          const SizedBox(height: 32),
                        ],
                        Container(
                          padding: const EdgeInsets.fromLTRB(22, 24, 22, 20),
                          decoration: BoxDecoration(
                            color: const Color(0xD9101E2B),
                            borderRadius: BorderRadius.circular(24),
                            border: Border.all(color: const Color(0xFF344651)),
                          ),
                          child: Form(
                            key: _formKey,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                Text(
                                  _title(controller.loginStage),
                                  style: const TextStyle(
                                    fontSize: 21,
                                    fontWeight: FontWeight.w500,
                                    letterSpacing: -.5,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Text(
                                  _subtitle(controller),
                                  style: const TextStyle(
                                    color: Color(0xFFBDCED8),
                                    fontSize: 13,
                                    height: 1.6,
                                  ),
                                ),
                                TextButton.icon(
                                  onPressed: _busy
                                      ? null
                                      : () => Navigator.of(context).push(
                                          MaterialPageRoute<void>(
                                            builder: (_) =>
                                                InstanceSettingsPage(
                                                  controller: controller,
                                                ),
                                          ),
                                        ),
                                  icon: const Icon(Icons.dns_outlined),
                                  label: Text(controller.api.origin),
                                ),
                                const SizedBox(height: 22),
                                StatusBanner(controller: controller),
                                if (controller.instanceDiscoveryRequired)
                                  FilledButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _run(
                                            () => controller.initialize(),
                                          ),
                                    child: Text(
                                      Localizations.localeOf(
                                                context,
                                              ).languageCode ==
                                              'zh'
                                          ? '重新检查服务'
                                          : 'Check server again',
                                    ),
                                  )
                                else if (controller.loginStage ==
                                    LoginStage.email)
                                  _emailForm(controller),
                                if (controller.loginStage ==
                                    LoginStage.password)
                                  _passwordForm(controller),
                                if (controller.loginStage ==
                                    LoginStage.verificationSent)
                                  _verification(controller),
                                if (_busy) ...[
                                  const SizedBox(height: 18),
                                  const LinearProgressIndicator(minHeight: 2),
                                ],
                                const SizedBox(height: 20),
                                Row(
                                  children: [
                                    const Icon(
                                      Icons.lock_outline,
                                      size: 13,
                                      color: Color(0xFFB4EBDC),
                                    ),
                                    const SizedBox(width: 7),
                                    Expanded(
                                      child: Text(
                                        context.l10n.authSecurityBadge,
                                        style: const TextStyle(
                                          color: Color(0xFFB4EBDC),
                                          fontSize: 11,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                        const Padding(
                          padding: EdgeInsets.fromLTRB(8, 20, 8, 0),
                          child: _SecurityNote(),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _emailForm(AppController controller) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      TextFormField(
        controller: _email,
        autofocus: false,
        keyboardType: controller.usernameLogin
            ? TextInputType.text
            : TextInputType.emailAddress,
        textInputAction: TextInputAction.done,
        autofillHints: controller.usernameLogin
            ? const [AutofillHints.username]
            : const [AutofillHints.email],
        decoration: InputDecoration(
          labelText: controller.usernameLogin
              ? (Localizations.localeOf(context).languageCode == 'zh'
                    ? '用户名'
                    : 'Username')
              : context.l10n.authEmailLabel,
          hintText: controller.usernameLogin ? 'admin' : 'you@example.com',
          prefixIcon: const Icon(Icons.alternate_email),
        ),
        validator: (value) => controller.usernameLogin
            ? ((value?.trim().isNotEmpty ?? false)
                  ? null
                  : (Localizations.localeOf(context).languageCode == 'zh'
                        ? '请输入用户名'
                        : 'Enter your username'))
            : RegExp(
                r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
              ).hasMatch(value?.trim() ?? '')
            ? null
            : context.l10n.authInvalidEmail,
        onFieldSubmitted: (_) => _continueEmail(controller),
      ),
      const SizedBox(height: 14),
      FilledButton(
        style: FilledButton.styleFrom(
          backgroundColor: const Color(0xFFB4EBDC),
          foregroundColor: const Color(0xFF102926),
          minimumSize: const Size.fromHeight(48),
        ),
        onPressed: _busy ? null : () => _continueEmail(controller),
        child: Text(context.l10n.authContinue),
      ),
    ],
  );

  Widget _passwordForm(AppController controller) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Row(
        children: [
          Expanded(
            child: Text(
              controller.email,
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
          TextButton(
            onPressed: _busy ? null : controller.resetLogin,
            child: Text(
              controller.usernameLogin
                  ? (Localizations.localeOf(context).languageCode == 'zh'
                        ? '更换用户名'
                        : 'Change username')
                  : context.l10n.authChangeEmail,
            ),
          ),
        ],
      ),
      const SizedBox(height: 8),
      TextFormField(
        controller: _password,
        autofocus: true,
        obscureText: _obscure,
        textInputAction: TextInputAction.done,
        autofillHints: const [AutofillHints.password],
        decoration: InputDecoration(
          labelText: context.l10n.authPasswordLabel,
          prefixIcon: const Icon(Icons.lock_outline),
          suffixIcon: IconButton(
            tooltip: _obscure
                ? context.l10n.authShowPassword
                : context.l10n.authHidePassword,
            onPressed: () => setState(() => _obscure = !_obscure),
            icon: Icon(
              _obscure
                  ? Icons.visibility_outlined
                  : Icons.visibility_off_outlined,
            ),
          ),
        ),
        validator: (value) => (value?.isNotEmpty ?? false)
            ? null
            : context.l10n.authPasswordRequired,
        onFieldSubmitted: (_) => _login(controller),
      ),
      const SizedBox(height: 14),
      FilledButton(
        onPressed: _busy ? null : () => _login(controller),
        child: Text(context.l10n.authSignIn),
      ),
      if (!controller.usernameLogin)
        TextButton(
          onPressed: _busy
              ? null
              : () => _run(() async {
                  await controller.resendVerification();
                }),
          child: Text(context.l10n.authVerifyEmailAction),
        ),
    ],
  );

  Widget _verification(AppController controller) => Card(
    child: Padding(
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Icon(Icons.mark_email_unread_outlined, size: 44),
          const SizedBox(height: 14),
          Text(
            controller.email,
            textAlign: TextAlign.center,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          Text(
            context.l10n.authVerificationInstructions,
            textAlign: TextAlign.center,
            style: const TextStyle(height: 1.45),
          ),
          const SizedBox(height: 18),
          FilledButton(
            onPressed: _busy
                ? null
                : () => _run(controller.markVerificationComplete),
            child: Text(context.l10n.authPasswordSet),
          ),
          TextButton(
            onPressed: _busy ? null : () => _run(controller.resendVerification),
            child: Text(context.l10n.authResendEmail),
          ),
          TextButton(
            onPressed: _busy ? null : controller.resetLogin,
            child: Text(context.l10n.commonBack),
          ),
        ],
      ),
    ),
  );

  void _continueEmail(AppController controller) {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    _run(() => controller.continueWithEmail(_email.text));
  }

  void _login(AppController controller) {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    _run(() => controller.login(_password.text));
  }

  String _title(LoginStage stage) => widget.controller.usernameLogin
      ? (Localizations.localeOf(context).languageCode == 'zh'
            ? '登录自建实例'
            : 'Sign in to your instance')
      : switch (stage) {
          LoginStage.email => context.l10n.authEmailTitle,
          LoginStage.password => context.l10n.authPasswordTitle,
          LoginStage.verificationSent => context.l10n.authVerificationTitle,
        };

  String _subtitle(AppController controller) => controller.usernameLogin
      ? (Localizations.localeOf(context).languageCode == 'zh'
            ? '使用部署者设置的用户名和密码；无需邮箱。'
            : 'Use the username and password set by the owner. No email required.')
      : switch (controller.loginStage) {
          LoginStage.email => context.l10n.authEmailSubtitle,
          LoginStage.password => context.l10n.authPasswordSubtitle,
          LoginStage.verificationSent => context.l10n.authVerificationSubtitle,
        };
}

class _SecurityNote extends StatelessWidget {
  const _SecurityNote();

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Icon(Icons.shield_outlined, size: 18, color: RelayTheme.muted),
      const SizedBox(width: 10),
      Expanded(
        child: Text(
          context.l10n.authSecurityNote,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: RelayTheme.muted,
            height: 1.45,
          ),
        ),
      ),
    ],
  );
}
