#!/usr/bin/env python3
"""Generate a credential-free local LoongCollector pipeline with synthetic input.

Run its stdout-only pipeline in an isolated Linux collector installation, then
pass captured stdout to `check`. This never reads production journal or calls SLS.
"""
import argparse
import json
import re
from pathlib import Path

from config import FIELDS, processors

MARKER = 'SLS_SYNTHETIC_SECRET'


def wire(**changes):
    record = {'level': 'info', 'request_method': 'GET', 'request_uri': '/api/events',
              'status': 200, 'request_time': 0.01}
    record.update(changes)
    return json.dumps(record, separators=(',', ':'))


def wire_v2(authenticated=True, **changes):
    record = {'schema_version': 2, 'service': 'relayune-api', 'service_version': '0.3.22',
              'event': 'http_request', 'level': 'info', 'request_method': 'GET',
              'request_uri': '/health', 'status': 200, 'request_time': 123.456}
    record.update(changes)
    record['trace_id'] = '01234567-89ab-4cde-8abc-0123456789ab'
    if authenticated:
        record['user_ref'] = 'v1_' + 'a'*64
    record.update(auth_type='email_session' if authenticated else 'anonymous', client_type='unknown')
    return json.dumps(record, separators=(',', ':'))


def pipeline(output_file=None):
    samples = [
        ('agent-relay.service', wire_v2()),
        ('agent-relay.service', wire_v2(authenticated=False)),
        ('agent-relay.service', wire_v2(error='invalid_credentials', status=401, level='warn')),
        ('agent-relay.service', wire_v2(email=MARKER)),
        ('agent-relay.service', wire_v2(schema_version=3)),
        ('agent-relay.service', wire(request_uri='/api/responses/' + MARKER)),
        ('agent-relay.service', wire(request_uri='/api/auth/verify?token=' + MARKER)),
        ('agent-relay.service', wire(request_uri='/api/relay/devices/' + MARKER + '/ios-push')),
        ('agent-relay.service', wire(request_uri='/' + MARKER, error=MARKER)),
        ('agent-relay.service', wire(request_method=MARKER, request_uri='/health')),
        ('agent-relay.service', wire(status=400, level='warn', error='invalid_envelope')),
        ('agent-relay.service', wire(Authorization=MARKER)),
        ('agent-relay.service', wire()[:-1]),
        ('unrelated.service', wire(request_uri='/api/bootstrap')),
    ]
    return {'enable': True,
            'inputs': [{'Type': 'metric_mock', 'IntervalMs': 1000,
                        'Fields': {'_SYSTEMD_UNIT': unit, 'MESSAGE': text, 'credential': MARKER}}
                       for unit, text in samples],
            'processors': [{'Type': item['type'], **item['detail']} for item in processors()],
            'flushers': [{'Type': 'flusher_stdout', **({'FileName': str(output_file)} if output_file else {'OnlyStdout': True})}]}


def check(filename):
    text = Path(filename).read_text()
    if MARKER in text:
        raise ValueError('synthetic_secret_leaked')
    routes = set()
    has_safe_error = False
    has_v2 = False
    has_anonymous_v2 = False
    def unique_fields(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('duplicate_output_field')
            result[key] = value
        return result
    for line in text.splitlines():
        try:
            record = json.loads(re.sub(r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ', '', line), object_pairs_hook=unique_fields)
        except json.JSONDecodeError:
            continue
        if not isinstance(record, dict):
            continue
        if 'request_uri' not in record:
            continue
        if set(record) - set(FIELDS) - {key for key in record if key.startswith('__')}:
            raise ValueError('unexpected_field')
        if str(record.get('schema_version')) == '2':
            if float(record.get('request_time', -1)) != 123.456:
                raise ValueError('v2_millisecond_value_changed')
            if record.get('auth_type') == 'anonymous':
                if 'user_ref' in record:
                    raise ValueError('anonymous_identity_not_omitted')
                has_anonymous_v2 = True
            if record.get('auth_type') != 'anonymous' and record.get('user_ref') != 'v1_' + 'a'*64:
                raise ValueError('v2_identity_missing')
            has_v2 = True
        routes.add(record['request_uri'])
        has_safe_error |= record.get('error') == 'invalid_envelope'
    expected = {'/api/responses/:request_id', '/api/auth/verify',
                '/api/relay/devices/:device_id/ios-push', 'unmatched', '/health', '/api/events'}
    if routes != expected or not has_safe_error or not has_v2 or not has_anonymous_v2:
        raise ValueError('missing_or_unexpected_output')
    print('Synthetic collector output passed; live journal/checkpoint and SLS tests remain separate.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['render', 'check'])
    parser.add_argument('--file', type=Path, required=True)
    parser.add_argument('--collector-output', type=Path, help='Synthetic output file for daemonized collectors')
    args = parser.parse_args()
    if args.command == 'render':
        # JSON is valid YAML, suitable for the local pipeline configuration directory.
        with args.file.open('x') as target:
            json.dump(pipeline(args.collector_output), target, indent=2)
            target.write('\n')
    else:
        check(args.file)
