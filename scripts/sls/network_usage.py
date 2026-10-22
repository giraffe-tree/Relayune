#!/usr/bin/env python3
"""Render the isolated payload-usage collector/index and ready-to-run SLS SQL.

No credentials or network calls. Keep http_request v2 and its strict collector intact.
Deploy to a separate logstore so existing request-count dashboards remain accurate.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ['schema_version', 'service', 'service_version', 'event', 'window_start_ms',
          'window_end_ms', 'transport', 'request_method', 'request_uri', 'message_kind',
          'rx_payload_bytes', 'tx_payload_bytes', 'units', 'aborted']
NUMERIC = {'schema_version', 'window_start_ms', 'window_end_ms', 'rx_payload_bytes',
           'tx_payload_bytes', 'units', 'aborted'}
ROUTES = sorted({x['template'] for x in json.loads((ROOT / 'shared/request-log-routes.json').read_text())} | {'unmatched'})
NUMBER = r'(0|[1-9][0-9]{0,15})'
PATTERN = (r'^\{"schema_version":(1),"service":"(relayune-api)",'
           r'"service_version":"([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)",'
           r'"event":"(network_usage)","window_start_ms":' + NUMBER +
           r',"window_end_ms":' + NUMBER + r',"transport":"(http|websocket)",'
           r'"request_method":"(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE|UNKNOWN)",'
           r'"request_uri":"(' + '|'.join(re.escape(x) for x in ROUTES) + r')",'
           r'"message_kind":"(body|ready|presence|invalidate|heartbeat|ping|pong|subscribe|other)",'
           r'"rx_payload_bytes":' + NUMBER + r',"tx_payload_bytes":' + NUMBER +
           r',"units":' + NUMBER + r',"aborted":' + NUMBER + r'\}$')

QUERIES = {
    'outbound_share': '* | SELECT transport, request_method, request_uri, message_kind, '
        'sum(tx_payload_bytes) AS bytes, '
        '100.0 * sum(tx_payload_bytes) / nullif(sum(sum(tx_payload_bytes)) OVER (), 0) AS percent '
        'FROM log GROUP BY transport, request_method, request_uri, message_kind ORDER BY bytes DESC',
    'inbound_share': '* | SELECT transport, request_method, request_uri, message_kind, '
        'sum(rx_payload_bytes) AS bytes, '
        '100.0 * sum(rx_payload_bytes) / nullif(sum(sum(rx_payload_bytes)) OVER (), 0) AS percent '
        'FROM log GROUP BY transport, request_method, request_uri, message_kind ORDER BY bytes DESC',
    'minute_usage': '* | SELECT window_end_ms / 60000 AS minute, transport, '
        'sum(tx_payload_bytes) AS tx_bytes, sum(rx_payload_bytes) AS rx_bytes, '
        'sum(units) AS units, sum(aborted) AS aborted FROM log GROUP BY minute, transport ORDER BY minute',
}


def build(project='relayune', logstore='relayune-network-usage'):
    for value in (project, logstore):
        if not re.fullmatch(r'[a-z][a-z0-9-]{2,62}', value):
            raise ValueError('invalid_resource_name')
    if logstore == 'relayune':
        raise ValueError('separate_logstore_required')
    processors = [
        {'type': 'processor_filter_regex', 'detail': {'Include': {'_SYSTEMD_UNIT': '^agent-relay[.]service$'}}},
        {'type': 'processor_pick_key', 'detail': {'Include': ['MESSAGE']}},
        {'type': 'processor_filter_regex', 'detail': {'Include': {'MESSAGE': PATTERN}}},
        {'type': 'processor_regex', 'detail': {'SourceKey': 'MESSAGE', 'Regex': PATTERN,
          'Keys': FIELDS, 'KeepSource': False, 'KeepSourceIfParseError': False, 'NoKeyError': False,
          'NoMatchError': False, 'FullMatch': True}},
        {'type': 'processor_pick_key', 'detail': {'Include': FIELDS}},
    ]
    return {
        'project': project,
        'logstore': {'logstoreName': logstore, 'ttl': 7, 'shardCount': 1},
        'index': {'keys': {key: {'type': 'long' if key in NUMERIC else 'text', 'doc_value': True,
                    **({} if key in NUMERIC else {'caseSensitive': True, 'token': [], 'chn': False})}
                    for key in FIELDS}},
        'collection': {'configName': 'relayune-network-usage-v1', 'inputType': 'plugin',
          'inputDetail': {'plugin': {'inputs': [{'type': 'service_journal', 'detail': {
              'JournalPaths': [], 'Units': ['agent-relay.service'], 'Kernel': False,
              'SeekPosition': 'tail', 'UseJournalEventTime': True, 'CursorFlushPeriodMs': 1000,
              'CursorSeekFallback': 'tail'}}], 'processors': processors},
              'localStorage': True, 'enableRawLog': False},
          'outputType': 'LogService', 'outputDetail': {'projectName': project, 'logstoreName': logstore}},
        'queries': QUERIES,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    with args.output.open('x') as target:
        json.dump(build(), target, ensure_ascii=False, indent=2)
        target.write('\n')
