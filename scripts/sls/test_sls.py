import contextlib
import copy
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from config import FIELDS, OWNER, REQUEST_PATTERN, ROOT, build, processors
from manage import SetupError, apply, configure_alerts, credentials, inspect, parser, read_optional, migrate_v2


class FakeError(Exception):
    def __init__(self, code):
        self.code = code

    def get_error_code(self):
        return self.code


class Response:
    def __init__(self, value):
        self.value = copy.deepcopy(value)

    def get_body(self):
        return self.value


class MemoryClient:
    """Failure-injectable resource store; no credentials or network."""
    def __init__(self):
        self.state = {}
        self.mutations = []
        self.failure = None

    def get(self, name, missing):
        if self.failure:
            raise FakeError(self.failure)
        if name not in self.state:
            raise FakeError(missing)
        return Response(self.state[name])

    def put(self, name, value):
        if name in self.state:
            raise FakeError('AlreadyExists')
        self.state[name] = copy.deepcopy(value)
        self.mutations.append(name)

    def get_project(self, p): return self.get('project', 'ProjectNotExist')
    def create_project(self, p, d): self.put('project', {'projectName': p, 'description': d})
    def get_logstore(self, p, s): return self.get('logstore', 'LogStoreNotExist')
    def create_logstore(self, p, s, **kw):
        self.put('logstore', {'logstoreName': s, 'ttl': kw['ttl'], 'shardCount': kw['shard_count'],
                             'autoSplit': kw['auto_split'], 'appendMeta': kw['append_meta'],
                             'enable_tracking': kw['enable_tracking']})
    def get_index_config(self, p, s): return self.get('index', 'IndexConfigNotExist')
    def create_index(self, p, s, detail): self.put('index', detail.to_json())
    def get_machine_group(self, p, g): return self.get('group', 'MachineGroupNotExist')
    def create_machine_group(self, p, detail): self.put('group', detail.to_json())
    def get_logtail_config(self, p, c): return self.get('collector', 'ConfigNotExist')
    def create_logtail_config(self, p, detail): self.put('collector', detail.to_json())
    def get_dashboard(self, p, d): return self.get('dashboard', 'DashboardNotExist')
    def create_dashboard(self, p, detail): self.put('dashboard', detail)
    def get_alert(self, p, a): return self.get(a, 'JobNotExist')
    def create_alert(self, p, detail):
        self.put(detail['name'], dict(detail, status='ENABLED'))
    def enable_alert(self, p, name): self.state[name]['status'] = 'ENABLED'
    def disable_alert(self, p, name): self.state[name]['status'] = 'DISABLED'
    def update_alert(self, p, detail):
        self.state[detail['name']] = copy.deepcopy(detail)
        self.mutations.append('update:' + detail['name'])
    def update_index(self, p, s, detail): self.replace('index', detail.to_json())
    def update_logtail_config(self, p, detail): self.replace('collector', detail.to_json())
    def update_dashboard(self, p, detail): self.replace('dashboard', detail)
    def replace(self, key, value):
        self.state[key] = copy.deepcopy(value)
        self.mutations.append('update:' + key)
    def get_machine_group_applied_configs(self, p, g): return Response({'configs': self.state.get('binding', [])})
    def apply_config_to_machine_group(self, p, c, g): self.put('binding', [c])


def message(**changes):
    value = {'level': 'info', 'request_method': 'GET', 'request_uri': '/api/responses/private',
             'status': 200, 'request_time': 0.123}
    value.update(changes)
    return json.dumps(value, separators=(',', ':'))


class ConfigTests(unittest.TestCase):
    def setUp(self):
        self.config = build(parser().parse_args([]))

    def test_offline_render_needs_neither_sdk_nor_key(self):
        result = subprocess.run([sys.executable, '-S', str(ROOT/'scripts/sls/manage.py'), 'render'],
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout), self.config)

    def test_safe_defaults(self):
        self.assertEqual(self.config['logstore']['ttl'], 7)
        self.assertEqual(self.config['logstore']['shardCount'], 1)
        self.assertEqual(set(self.config['index']['keys']), set(FIELDS))
        self.assertNotIn('line', self.config['index'])
        self.assertTrue(all(a['status'] == 'DISABLED' for a in self.config['alerts']))
        self.assertEqual(len(self.config['dashboard']['charts']), 8)
        for chart in self.config['dashboard']['charts']:
            self.assertRegex(chart['title'], r'^[a-z0-9-]+$')
        self.assertNotIn('logType', self.config['collection']['inputDetail'])
        self.assertEqual(self.config['collection']['inputDetail']['plugin']['inputs'][0]['detail']['Units'], ['agent-relay.service'])

    def test_invalid_destinations_and_unbounded_retention_rejected(self):
        for options in [['--region', 'evil.example.com'], ['--project', '../secret'], ['--retention-days', '365']]:
            with self.assertRaises(ValueError): build(parser().parse_args(options))

    def test_alert_enable_requires_policy_and_missing_health_stays_disabled(self):
        with self.assertRaises(ValueError): build(parser().parse_args(['--enable-alerts']))
        config = build(parser().parse_args(['--enable-alerts', '--action-policy', 'existing-policy']))
        self.assertEqual([a['status'] for a in config['alerts']], ['ENABLED', 'ENABLED', 'DISABLED'])

    def test_wire_schema_rejects_sensitive_extras_and_malformed_payloads(self):
        regex = re.compile(REQUEST_PATTERN)
        self.assertIsNotNone(regex.fullmatch(message()))
        self.assertIsNotNone(regex.fullmatch(message(error='invalid_envelope', status=400, level='warn')))
        for raw in [message(Authorization='Bearer secret'), message(email='secret@example.com'),
                    message()[:-1], message() + ' trailing', '{"level":"info"}',
                    message(request_time=float('nan')), message(request_time=-1),
                    message(request_uri='/bad\\escaped'), message(status=200.5),
                    '{"event":"listening","credentials":"private"}']:
            self.assertIsNone(regex.fullmatch(raw), raw)

    def test_generated_routing_rules_output_only_fixed_known_labels(self):
        # Evaluate the generated route rule table with raw inputs, not a separate
        # hand-maintained list of routes. Actual collector integration remains a
        # Linux acceptance step; this tests the safety of every generated rule.
        switch = processors()[4]['detail']['Switch']
        cases = [('/api/responses/private?token=secret', '/api/responses/:request_id'),
                 ('/api/relay/pairings/pair_private/cancel', '/api/relay/pairings/:pairing_id/cancel'),
                 ('/api/relay/devices/dev_private/ios-push', '/api/relay/devices/:device_id/ios-push'),
                 ('/secret@example.com', 'unmatched'), ('/api/auth/verify?token=secret', '/api/auth/verify')]
        for raw, expected in cases:
            rule = next(r for r in switch if re.search(r['Case']['FieldConditions']['request_uri'], raw))
            self.assertEqual(rule['Actions'][-1]['Fields']['request_uri'], expected)
        for processor in processors():
            if processor['type'] == 'processor_fields_with_condition':
                for rule in processor['detail']['Switch']:
                    field = next(iter(rule['Case']['FieldConditions']))
                    self.assertEqual(rule['Actions'][0], {'type': 'processor_drop', 'DropKeys': [field]})
        self.assertEqual(processors()[-1]['detail']['Include'], FIELDS)
        self.assertFalse(processors()[3]['detail']['KeepSourceIfParseError'])
        self.assertFalse(processors()[3]['detail']['NoMatchError'])

    def test_v2_envelope_and_extraction_reject_unsafe_or_partial_metadata(self):
        from config import EXTRACT_PATTERN
        from smoke import wire_v2
        raw = wire_v2()
        self.assertIsNotNone(re.fullmatch(REQUEST_PATTERN, raw))
        fields = dict(zip(FIELDS, re.fullmatch(EXTRACT_PATTERN, raw).groups()))
        self.assertEqual(fields['request_time'], '123.456')
        self.assertEqual(fields['schema_version'], '2')
        self.assertEqual(fields['user_ref'], 'v1_' + 'a'*64)
        for bad in [wire_v2(email='private@example.com'), wire_v2(schema_version=3),
                    raw.replace('v1_' + 'a'*64, 'private@example.com'),
                    raw.replace('"schema_version":2,', ''),
                    raw.replace(',"client_type":"unknown"', '')]:
            self.assertIsNone(re.fullmatch(REQUEST_PATTERN, bad))

    def test_latency_queries_convert_legacy_seconds_and_keep_v2_milliseconds(self):
        from config import DURATION_MS
        for i in [1, 2]:
            query = self.config['dashboard']['charts'][i]['search']['query']
            self.assertIn(DURATION_MS, query)
            self.assertNotIn(')*1000', query)
        alert = self.config['alerts'][1]['configuration']
        self.assertIn(DURATION_MS, alert['queryList'][0]['query'])
        self.assertIn('p95 > 2000', alert['severityConfigurations'][0]['evalCondition']['condition'])

    def test_query_windows_and_health_separation(self):
        for chart in self.config['dashboard']['charts'][:-1]:
            self.assertIn("request_uri <> '/health'", chart['search']['query'])
        for alert in self.config['alerts']:
            query = alert['configuration']['queryList'][0]
            self.assertEqual((query['start'], query['end']), ('-6m', '-1m'))
            self.assertGreater(alert['configuration']['threshold'], 1)


class ProvisioningTests(unittest.TestCase):
    def setUp(self):
        self.config = build(parser().parse_args([]))
        self.client = MemoryClient()

    def run_apply(self, activate=False):
        with contextlib.redirect_stdout(io.StringIO()): apply(self.client, self.config, activate)

    def test_repeated_apply_is_idempotent_and_does_not_bind_by_default(self):
        self.run_apply()
        first = list(self.client.mutations)
        self.run_apply()
        self.assertEqual(self.client.mutations, first)
        self.assertNotIn('binding', self.client.state)

    def test_inspect_never_mutates(self):
        inspect(self.client, self.config)
        self.assertEqual(self.client.mutations, [])

    def test_permission_failure_does_not_create_project(self):
        self.client.failure = 'Unauthorized'
        with self.assertRaises(FakeError): self.run_apply()
        self.assertEqual(self.client.mutations, [])

    def test_existing_foreign_project_is_not_adopted(self):
        self.client.state['project'] = {'description': 'another application'}
        with self.assertRaisesRegex(SetupError, 'owned_by_other'): self.run_apply()
        self.assertEqual(self.client.mutations, [])

    def test_existing_resources_preserve_settings_and_remain_idempotent(self):
        self.config = build(parser().parse_args(['--use-existing-resources']))
        self.client.state.update(project={'description': 'user project'},
                                 logstore={'ttl': 120, 'shardCount': 1, 'autoSplit': True})
        before = copy.deepcopy(self.client.state)
        self.run_apply()
        first = list(self.client.mutations)
        self.run_apply()
        self.assertEqual(first, self.client.mutations)
        for key in before:
            self.assertEqual(before[key], self.client.state[key])
        self.client.state['index']['keys']['email'] = {'type': 'text'}
        with self.assertRaisesRegex(SetupError, 'conflict_index'): self.run_apply()
        self.assertEqual(first, self.client.mutations)

    def test_existing_mode_requires_both_resources_before_mutating(self):
        self.config = build(parser().parse_args(['--use-existing-resources']))
        with self.assertRaisesRegex(SetupError, 'existing_project_required'): self.run_apply()
        self.client.state['project'] = {'description': 'user project'}
        with self.assertRaisesRegex(SetupError, 'existing_logstore_required'): self.run_apply()
        self.assertEqual(self.client.mutations, [])

    def test_conflict_found_before_any_mutation(self):
        self.run_apply()
        del self.client.state['collector']
        self.client.state['dashboard']['displayName'] = 'user changed dashboard'
        before = list(self.client.mutations)
        with self.assertRaisesRegex(SetupError, 'conflict_dashboard'): self.run_apply()
        self.assertEqual(self.client.mutations, before)

    def test_broader_index_is_rejected(self):
        self.run_apply()
        self.client.state['index']['keys']['email'] = {'type': 'text'}
        with self.assertRaisesRegex(SetupError, 'conflict_index'): self.run_apply()

    def test_partial_creation_resumes_without_overwriting(self):
        original = self.client.create_dashboard
        with patch.object(self.client, 'create_dashboard', side_effect=FakeError('ServerBusy')):
            with self.assertRaises(FakeError): self.run_apply()
        self.client.create_dashboard = original
        self.run_apply()
        self.assertEqual(self.client.mutations.count('logstore'), 1)
        self.assertIn('dashboard', self.client.state)

    def test_explicit_activation_only_binds_our_config(self):
        self.run_apply(True)
        self.run_apply(True)
        self.assertEqual(self.client.mutations.count('binding'), 1)

    def test_foreign_binding_is_not_replaced(self):
        self.run_apply()
        self.client.state['binding'] = ['another-config']
        with self.assertRaisesRegex(SetupError, 'other_collectors'): self.run_apply(True)

    def test_only_exact_not_found_codes_are_treated_as_missing(self):
        for code in ['Unauthorized', 'InvalidAccessKeyId', 'RequestTimeout', 'ServerBusy']:
            with self.assertRaises(FakeError):
                read_optional(lambda: (_ for _ in ()).throw(FakeError(code)), {'ProjectNotExist'})

    def test_explicit_alert_activation_preserves_definitions_and_is_idempotent(self):
        self.run_apply()
        config = build(parser().parse_args(['--enable-alerts', '--action-policy', 'existing']))
        with contextlib.redirect_stdout(io.StringIO()):
            configure_alerts(self.client, config)
            before = list(self.client.mutations)
            configure_alerts(self.client, config)
        self.assertEqual(self.client.mutations, before)
        self.assertEqual(self.client.state['relayune-server-errors']['status'], 'ENABLED')
        self.assertEqual(self.client.state['relayune-health-missing']['status'], 'DISABLED')

    def test_status_action_readback_failure_is_reported(self):
        with patch.object(self.client, 'disable_alert', return_value=None):
            with self.assertRaisesRegex(SetupError, 'alert_status_not_applied'): self.run_apply()

    def test_customized_alert_is_not_overwritten(self):
        self.run_apply()
        self.client.state['relayune-latency']['configuration']['threshold'] = 20
        before = list(self.client.mutations)
        config = build(parser().parse_args(['--enable-alerts', '--action-policy', 'existing']))
        with self.assertRaisesRegex(SetupError, 'definition_conflict'):
            configure_alerts(self.client, config)
        self.assertEqual(self.client.mutations, before)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        from config_v1 import build as build_v1
        self.args = parser().parse_args(['migrate-v2', '--use-existing-resources'])
        self.config = build(self.args)
        self.client = MemoryClient()
        with contextlib.redirect_stdout(io.StringIO()): apply(self.client, build_v1(parser().parse_args([])))
        self.client.state['logstore']['ttl'] = 120
        self.client.mutations.clear()

    def migrate(self):
        with contextlib.redirect_stdout(io.StringIO()): migrate_v2(self.client, self.config, self.args)

    def test_migration_is_resumable_and_preserves_storage_and_binding(self):
        self.client.state['binding'] = ['relayune-http-journal-v1']
        self.migrate()
        self.assertEqual(self.client.state['logstore']['ttl'], 120)
        self.assertEqual(self.client.state['binding'], ['relayune-http-journal-v1'])
        self.assertEqual(set(self.client.state['index']['keys']), set(FIELDS))
        before = list(self.client.mutations)
        self.migrate()
        self.assertEqual(before, self.client.mutations)

    def test_customized_definition_stops_before_any_mutation(self):
        self.client.state['dashboard']['displayName'] = 'custom'
        with self.assertRaisesRegex(SetupError, 'migration_conflict_dashboard'): self.migrate()
        self.assertEqual(self.client.mutations, [])

    def test_dry_run_and_partial_failure(self):
        self.args.dry_run = True
        self.migrate()
        self.assertEqual(self.client.mutations, [])
        self.args.dry_run = False
        with patch.object(self.client, 'update_dashboard', side_effect=FakeError('ServerBusy')):
            with self.assertRaises(FakeError): self.migrate()
        self.migrate()
        self.assertEqual(self.client.mutations.count('update:index'), 1)


class CredentialsTests(unittest.TestCase):
    def test_private_file_only_and_no_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'key'
            path.write_text('synthetic-id\nsynthetic-secret\n')
            path.chmod(0o600)
            self.assertEqual(credentials(path), ('synthetic-id', 'synthetic-secret', None))
            link = Path(folder)/'link'
            link.symlink_to(path)
            with self.assertRaises(OSError): credentials(link)
            path.chmod(0o644)
            with self.assertRaises(SetupError): credentials(path)

    def test_render_does_not_overwrite_existing_file(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder)/'plan.json'
            output.write_text('keep me')
            result = subprocess.run([sys.executable, str(ROOT/'scripts/sls/manage.py'), 'render', '--output', str(output)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(output.read_text(), 'keep me')


class SmokeCheckerTests(unittest.TestCase):
    def test_checker_rejects_secrets_and_duplicate_fields(self):
        from smoke import MARKER, check
        with tempfile.TemporaryDirectory() as folder:
            filename = Path(folder)/'out'
            for text, reason in [(MARKER, 'secret_leaked'),
                                 ('{"request_uri":"/health","request_uri":"/api/events"}', 'duplicate_output'),
                                 ('{}', 'missing_or_unexpected')]:
                filename.write_text(text)
                with self.assertRaisesRegex(ValueError, reason): check(filename)

    def test_checker_accepts_vendor_timestamp_and_rejects_prefixed_duplicates(self):
        from smoke import check
        with tempfile.TemporaryDirectory() as folder:
            filename = Path(folder)/'out'
            routes = ['/api/responses/:request_id', '/api/auth/verify',
                      '/api/relay/devices/:device_id/ios-push', 'unmatched', '/health', '/api/events']
            filename.write_text(''.join('2026-09-10 17:00:00 ' + json.dumps(
                {'request_uri': route, 'error': 'invalid_envelope', 'schema_version': '2',
                 'request_time': '123.456', 'user_ref': 'v1_' + 'a'*64}) + '\n' for route in routes))
            with filename.open('a') as output:
                output.write('2026-09-10 17:00:00 ' + json.dumps({'request_uri': '/health',
                    'schema_version': '2', 'request_time': '123.456', 'auth_type': 'anonymous'}) + '\n')
            with contextlib.redirect_stdout(io.StringIO()): check(filename)
            filename.write_text('2026-09-10 17:00:00 {"request_uri":"/health","request_uri":"/api/events"}')
            with self.assertRaisesRegex(ValueError, 'duplicate_output_field'): check(filename)

    def test_local_smoke_pipeline_has_no_cloud_or_journal_input(self):
        from smoke import pipeline
        value = pipeline()
        self.assertTrue(all(item['Type'] == 'metric_mock' for item in value['inputs']))
        self.assertEqual(value['flushers'], [{'Type': 'flusher_stdout', 'OnlyStdout': True}])


class SDKContractTests(unittest.TestCase):
    def test_actual_sdk_serializes_our_definitions_without_network(self):
        from aliyun.log import LogClient
        from manage import JsonDetail
        config = build(parser().parse_args([]))
        client = LogClient('https://cn-huhehaote.log.aliyuncs.com', 'synthetic-id', 'synthetic-secret')
        calls = []

        def transport(method, project, data, resource, params, headers):
            calls.append((method, resource, json.loads(data) if data else None))
            return {}, {}

        with patch.object(client, '_send', side_effect=transport), patch.object(client, 'get_logstore'):
            client.create_index('test-project', 'api-access', JsonDetail(config['index']))
            client.create_machine_group('test-project', JsonDetail(config['machineGroup']))
            client.create_logtail_config('test-project', JsonDetail(config['collection']))
            client.create_dashboard('test-project', config['dashboard'])
            client.create_alert('test-project', config['alerts'][0])
            client.update_logtail_config('test-project', JsonDetail(config['collection']))
        self.assertEqual(calls[-1], ('PUT', '/configs/' + config['collection']['configName'], config['collection']))
        for (_, _, actual), expected in zip(calls, [config['index'], config['machineGroup'], config['collection'], config['dashboard'], config['alerts'][0]]):
            self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main()
