import 'package:relayune_mobile/src/models.dart';

RelaySession codexMessageSettingsSession({String id = 'codex'}) =>
    RelaySession.fromJson({
      'id': id,
      'provider': 'codex',
      'status': 'idle',
      'supports_message_model_settings': true,
      'supports_message_permission_settings': true,
      'session_config_options': [
        {
          'id': 'model',
          'type': 'select',
          'currentValue': 'first',
          'options': [
            {
              'value': 'first',
              'name': 'First model',
              'defaultReasoningEffort': 'low',
              'reasoningOptions': [
                {'value': 'low', 'name': 'Low'},
                {'value': 'high', 'name': 'High'},
              ],
            },
            {
              'value': 'next',
              'name': 'Next model',
              'defaultReasoningEffort': 'medium',
              'reasoningOptions': [
                {'value': 'medium', 'name': 'Medium'},
                {'value': 'high', 'name': 'High'},
              ],
            },
          ],
        },
        {
          'id': 'reasoning',
          'type': 'select',
          'currentValue': 'low',
          'options': [
            {'value': 'low', 'name': 'Low'},
            {'value': 'high', 'name': 'High'},
          ],
        },
        {
          'id': 'permissions',
          'type': 'select',
          'currentValue': 'default',
          'description': 'Confirmed desktop permissions',
          'options': [
            {'value': 'default', 'name': 'Default'},
            {'value': 'auto', 'name': 'Auto-review'},
            {'value': 'manual', 'name': 'Manual'},
            {'value': 'full', 'name': 'Full access'},
          ],
        },
      ],
    });
