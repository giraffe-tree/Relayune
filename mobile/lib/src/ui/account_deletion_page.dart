import 'package:flutter/material.dart';

import '../../l10n/relayune_localizations.dart';
import '../network/relay_api.dart';
import '../state/app_controller.dart';
import 'theme.dart';

class AccountDeletionPage extends StatefulWidget {
  const AccountDeletionPage({super.key, required this.controller});
  final AppController controller;

  @override
  State<AccountDeletionPage> createState() => _AccountDeletionPageState();
}

class _AccountDeletionPageState extends State<AccountDeletionPage> {
  final _password = TextEditingController();
  bool _deleting = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    if (_deleting || _password.text.isEmpty) return;
    final copy = context.l10n;
    setState(() {
      _deleting = true;
      _error = null;
    });
    try {
      await widget.controller.deleteAccount(_password.text);
      _password.clear();
      if (!mounted) return;
      final messenger = ScaffoldMessenger.of(context);
      Navigator.of(context).popUntil((route) => route.isFirst);
      messenger.showSnackBar(SnackBar(content: Text(copy.accountDeletionDone)));
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _deleting = false;
        _error =
            error is RelayApiException && error.code == 'invalid_credentials'
            ? copy.accountDeletionWrongPassword
            : copy.accountDeletionFailed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final copy = context.l10n;
    return PopScope(
      canPop: !_deleting,
      child: Scaffold(
        appBar: AppBar(title: Text(copy.accountDeletionTitle)),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              SelectableText(
                widget.controller.email,
                textDirection: TextDirection.ltr,
              ),
              const SizedBox(height: 20),
              Text(
                copy.accountDeletionBody,
                style: const TextStyle(height: 1.6),
              ),
              const SizedBox(height: 20),
              TextField(
                key: const ValueKey('account-deletion-password'),
                controller: _password,
                enabled: !_deleting,
                obscureText: true,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  labelText: copy.accountDeletionPassword,
                ),
                onChanged: (_) => setState(() {}),
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(
                  _error!,
                  key: const ValueKey('account-deletion-error'),
                  style: const TextStyle(color: RelayTheme.red),
                ),
              ],
              const SizedBox(height: 24),
              FilledButton(
                key: const ValueKey('account-deletion-confirm'),
                style: FilledButton.styleFrom(backgroundColor: RelayTheme.red),
                onPressed: _deleting || _password.text.isEmpty ? null : _delete,
                child: Text(
                  _deleting
                      ? copy.accountDeletionBusy
                      : copy.accountDeletionConfirm,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

void openAccountDeletion(BuildContext context, AppController controller) {
  Navigator.of(context).push<void>(
    MaterialPageRoute(
      builder: (_) => AccountDeletionPage(controller: controller),
    ),
  );
}
