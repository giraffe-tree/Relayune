"""Offline SLS definitions. No credentials, network calls or optional dependencies."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OWNER = 'Relayune managed SLS HTTP monitoring v1'
LEGACY_FIELDS = ['level', 'request_method', 'request_uri', 'status', 'request_time', 'error']
FIELDS = ['schema_version', 'service', 'service_version', 'event', *LEGACY_FIELDS,
          'trace_id', 'user_ref', 'auth_type', 'client_type']
METHODS = 'GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE|UNKNOWN'
SAFE_ERRORS = json.loads((ROOT / 'shared/request-log-errors.json').read_text())
# Deliberately match only the producer's complete JSON serialization. Unknown
# fields, escaped values, truncation and changed schemas fail closed, not partially
# parsed. This also avoids raw JSON parser errors entering collector diagnostics.
LEGACY_PATTERN = (
    r'^\{"level":"(info|warn|error)","request_method":"([^"\\\x00-\x1f]{1,32})",'
    r'"request_uri":"([^"\\\x00-\x1f]+)","status":([1-5][0-9]{2}),'
    r'"request_time":((?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,9})?)'
    r'(?:,"error":"([^"\\\x00-\x1f]{1,128})")?\}$'
)
# One strict versioned envelope gate, followed by extraction with shared group order.
# Reject partial v2 records even though the extraction groups are optional for v1.
PREFIX = (r'"schema_version":(2),"service":"(relayune-api)",'
          r'"service_version":"([0-9]+[.][0-9]+[.][0-9]+(?:[-+][A-Za-z0-9.-]+)?)",'
          r'"event":"(http_request)",')
SUFFIX = (r',"trace_id":"([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})"'
          r'(?:,"user_ref":"(v[1-9][0-9]{0,3}_[a-f0-9]{64})")?'
          r',"auth_type":"(anonymous|email_session|device_token|browser_token|password|email_token)"'
          r',"client_type":"(web|desktop|mobile|unknown)"')
LEGACY_BODY = LEGACY_PATTERN[3:-3]
V2_BODY = LEGACY_BODY.replace('{0,6}', '{0,11}').replace('{1,9}', '{1,3}')
REQUEST_PATTERN = r'^\{(?:' + LEGACY_BODY + '|' + PREFIX + V2_BODY + SUFFIX + r')\}$'
EXTRACT_PATTERN = r'^\{(?:' + PREFIX + ')?' + LEGACY_BODY.replace('{0,6}', '{0,11}') + '(?:' + SUFFIX + r')?\}$'
DURATION_MS = '(CASE WHEN schema_version = 2 THEN request_time ELSE request_time * 1000 END)'
API = "request_uri <> '/health'"
TIME = '__time__ - __time__ % 60'
LARGE = "request_uri NOT IN ('/api/commands', '/api/relay/devices/:device_id/commands', '/api/relay/push', '/api/responses/:request_id')"


def plugin(kind, **detail):
    return {'type': kind, 'detail': detail}


def switch(field, cases, fallback):
    """First match wins; all outputs are fixed literals, never captured strings."""
    rules = [
        {'Case': {'RelationOperator': 'regexp', 'FieldConditions': {field: regex}},
         # The upstream add_fields action APPENDS even with IgnoreIfExist=False.
         # Drop the original first, otherwise a secret raw path survives as a
         # duplicate field in the protobuf record.
         'Actions': [{'type': 'processor_drop', 'DropKeys': [field]},
                     {'type': 'processor_add_fields', 'IgnoreIfExist': False,
                      'Fields': {field: value}}]}
        for regex, value in cases
    ]
    rules.append({'Case': {'RelationOperator': 'regexp', 'FieldConditions': {field: '.*'}},
                  'Actions': [{'type': 'processor_drop', 'DropKeys': [field]}] + fallback})
    return plugin('processor_fields_with_condition', Switch=rules, DropIfNotMatchCondition=False)


def processors():
    routes = json.loads((ROOT / 'shared/request-log-routes.json').read_text())
    route_cases = []
    for route in routes:
        # Accept both the current raw dynamic paths and already-normalized logs.
        for pattern in [route['pattern'], '^' + re.escape(route['template']) + '$']:
            route_cases.append((pattern.removesuffix('$') + r'(?:\?[^\r\n]*)?$', route['template']))
    return [
        plugin('processor_filter_regex', Include={'_SYSTEMD_UNIT': '^agent-relay[.]service$'}),
        plugin('processor_pick_key', Include=['MESSAGE']),
        plugin('processor_filter_regex', Include={'MESSAGE': REQUEST_PATTERN}),
        plugin('processor_regex', SourceKey='MESSAGE', Regex=EXTRACT_PATTERN, Keys=FIELDS,
               KeepSource=False, KeepSourceIfParseError=False, NoKeyError=False,
               NoMatchError=False, FullMatch=True),
        switch('request_uri', route_cases,
               [{'type': 'processor_add_fields', 'IgnoreIfExist': False,
                 'Fields': {'request_uri': 'unmatched'}}]),
        switch('request_method', [('^' + method + '$', method) for method in METHODS.split('|')],
               [{'type': 'processor_add_fields', 'IgnoreIfExist': False,
                 'Fields': {'request_method': 'UNKNOWN'}}]),
        switch('error', [('^' + error + '$', error) for error in SAFE_ERRORS],
               [{'type': 'processor_drop', 'DropKeys': ['error']}]),
        plugin('processor_fields_with_condition', Switch=[{
            'Case': {'RelationOperator': 'regexp', 'FieldConditions': {'user_ref': '^$'}},
            'Actions': [{'type': 'processor_drop', 'DropKeys': ['user_ref']}],
        }], DropIfNotMatchCondition=False),
        switch('schema_version', [('^2$', '2')],
               [{'type': 'processor_add_fields', 'IgnoreIfExist': False, 'Fields': {'schema_version': '1'}}]),
        plugin('processor_pick_key', Include=FIELDS),
    ]


def build(args):
    for name in ('project', 'logstore', 'machine_group'):
        if not re.fullmatch(r'[a-z][a-z0-9-]{2,62}', getattr(args, name)):
            raise ValueError('invalid_' + name)
    if not re.fullmatch(r'[a-z]{2}-[a-z]+(?:-[0-9]+)?', args.region):
        raise ValueError('invalid_region')
    if not 1 <= args.retention_days <= 30:
        raise ValueError('retention_must_be_1_to_30_days')
    if args.action_policy and not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}', args.action_policy):
        raise ValueError('invalid_action_policy')
    if args.enable_alerts and not args.action_policy:
        raise ValueError('enabling_alerts_requires_existing_action_policy')
    project, store = args.project, args.logstore
    journal = plugin('service_journal', JournalPaths=[], Units=['agent-relay.service'],
                     Kernel=False, SeekPosition='tail', UseJournalEventTime=True,
                     CursorFlushPeriodMs=1000, CursorSeekFallback='tail')
    # Empty JournalPaths uses systemd's default journal, supporting both volatile
    # /run/log/journal and persistent /var/log/journal without double collection.
    collection = {
        'configName': 'relayune-http-journal-v1', 'inputType': 'plugin',
        'inputDetail': {'plugin': {'inputs': [journal], 'processors': processors()},
                        'localStorage': True, 'enableRawLog': False},
        'outputType': 'LogService',
        'outputDetail': {'projectName': project, 'logstoreName': store},
    }
    index = {'keys': {field: {'type': 'text', 'doc_value': True, 'caseSensitive': True,
                               'token': [], 'chn': False}
                       for field in FIELDS if field not in ('status', 'request_time', 'schema_version')}}
    index['keys'].update({'schema_version': {'type': 'long', 'doc_value': True}, 'status': {'type': 'long', 'doc_value': True},
                          'request_time': {'type': 'double', 'doc_value': True}})
    queries = [
        ('每分钟请求数', 'linepro', 'time', ['requests'],
         f'* | SELECT {TIME} AS time, count(*) AS requests FROM log WHERE {API} GROUP BY time ORDER BY time'),
        ('延迟趋势（毫秒）', 'linepro', 'time', ['p50_ms', 'p95_ms', 'p99_ms'],
         f'* | SELECT {TIME} AS time, approx_percentile({DURATION_MS}, 0.5) AS p50_ms, '
         f'approx_percentile({DURATION_MS}, 0.95) AS p95_ms, '
         f'approx_percentile({DURATION_MS}, 0.99) AS p99_ms FROM log WHERE {API} GROUP BY time ORDER BY time'),
        ('接口调用量与性能', 'table', 'request_uri', ['requests', 'p95_ms', 'p99_ms', 'errors'],
         '* | SELECT request_method, request_uri, count(*) AS requests, '
         f'approx_percentile({DURATION_MS}, 0.95) AS p95_ms, '
         f'approx_percentile({DURATION_MS}, 0.99) AS p99_ms, count_if(status >= 500) AS errors '
         f'FROM log WHERE {API} GROUP BY request_method, request_uri ORDER BY requests DESC LIMIT 100'),
        ('状态码分布', 'table', 'status', ['requests'],
         f'* | SELECT status, count(*) AS requests FROM log WHERE {API} GROUP BY status ORDER BY requests DESC'),
        ('错误趋势', 'linepro', 'time', ['server_errors', 'rate_limited', 'client_closed'],
         f'* | SELECT {TIME} AS time, count_if(status >= 500) AS server_errors, '
         'count_if(status = 429) AS rate_limited, count_if(status = 499) AS client_closed '
         f'FROM log WHERE {API} GROUP BY time ORDER BY time'),
        ('轮询占比（非空轮询率）', 'table', 'requests', ['polls', 'poll_percent'],
         "* | SELECT count(*) AS requests, count_if(request_uri IN ('/api/relay/poll', '/api/relay/commands')) AS polls, "
         "100.0*count_if(request_uri IN ('/api/relay/poll', '/api/relay/commands'))/nullif(count(*),0) AS poll_percent "
         f'FROM log WHERE {API}'),
        ('5xx 比例（百分数）', 'linepro', 'time', ['error_percent'],
         f'* | SELECT {TIME} AS time, 100.0*count_if(status >= 500)/nullif(count(*),0) AS error_percent '
         f'FROM log WHERE {API} GROUP BY time ORDER BY time'),
        ('健康探测', 'linepro', 'time', ['probes', 'failed'],
         f'* | SELECT {TIME} AS time, count(*) AS probes, count_if(status >= 400) AS failed '
         "FROM log WHERE request_uri = '/health' GROUP BY time ORDER BY time"),
    ]
    dashboard = {'dashboardName': 'relayune-api-overview', 'displayName': 'Relayune 接口监控',
                 'description': OWNER, 'attribute': {'type': 'grid'}, 'charts': []}
    for i, (title, kind, x, y, query) in enumerate(queries):
        dashboard['charts'].append({
            'title': f'relayune-chart-{i}', 'type': kind, 'action': {},
            'display': {'displayName': title, 'height': 5, 'width': 6, 'xPos': (i % 2)*6,
                        'yPos': (i//2)*5, 'xAxis': [x], 'yAxis': y},
            'search': {'logstore': store, 'query': query, 'start': '-3600s', 'end': 'now', 'topic': ''},
        })
    alert_specs = [
        ('server-errors', '服务端错误率持续升高',
         f'* | SELECT count(*) AS requests, count_if(status >= 500) AS errors FROM log WHERE {API}',
         'requests >= 100 && errors >= 5 && errors * 100.0 / requests > 5', [], 3, True),
        ('latency', '普通接口 P95 持续超过 2 秒',
         '* | SELECT request_method, request_uri, count(*) AS requests, '
         f'approx_percentile({DURATION_MS},0.95) AS p95 FROM log WHERE {API} AND {LARGE} '
         'GROUP BY request_method, request_uri',
         'requests >= 100 && p95 > 2000', ['request_method', 'request_uri'], 3, True),
        ('health-missing', '健康探测日志中断（服务或采集异常）',
         "* | SELECT count(*) AS probes FROM log WHERE request_uri = '/health'",
         'probes == 0', [], 2, args.health_probe_installed),
    ]
    alerts = []
    for name, title, query, condition, groups, threshold, ready in alert_specs:
        conf = {
            'version': '2.0', 'type': 'default', 'dashboard': dashboard['dashboardName'],
            'queryList': [{'storeType': 'log', 'region': args.region, 'project': project, 'store': store,
                           'query': query, 'timeSpanType': 'Relative', 'start': '-6m', 'end': '-1m',
                           'powerSqlMode': 'disable'}],
            'groupConfiguration': {'type': 'custom' if groups else 'no_group', 'fields': groups},
            'joinConfigurations': [],
            'severityConfigurations': [{'severity': 6, 'evalCondition': {'condition': condition, 'countCondition': ''}}],
            'labels': [{'key': 'service', 'value': 'relayune'}],
            'annotations': [{'key': 'title', 'value': title}], 'autoAnnotation': False,
            'sendResolved': True, 'threshold': threshold, 'noDataFire': False,
        }
        if args.action_policy:
            conf['policyConfiguration'] = {'alertPolicyId': 'sls.builtin.dynamic',
                                            'actionPolicyId': args.action_policy,
                                            'repeatInterval': '30m', 'useDefault': False}
        alerts.append({'name': 'relayune-' + name, 'displayName': title, 'description': OWNER,
                       'type': 'Alert', 'status': 'ENABLED' if args.enable_alerts and ready else 'DISABLED',
                       'schedule': {'type': 'FixedRate', 'interval': '1m'}, 'configuration': conf})
    return {'schemaVersion': 2, 'region': args.region,
            'project': {'projectName': project, 'description': OWNER},
            'logstore': {'logstoreName': store, 'ttl': args.retention_days, 'shardCount': 1,
                         'autoSplit': False, 'appendMeta': False, 'enable_tracking': False},
            'useExistingResources': args.use_existing_resources,
            'index': index, 'collection': collection,
            'machineGroup': {'groupName': args.machine_group, 'groupType': '',
                             'groupAttribute': {'externalName': OWNER, 'groupTopic': 'relayune-http'},
                             'machineIdentifyType': 'userdefined', 'machineList': ['relayune-prod-http']},
            'dashboard': dashboard, 'alerts': alerts}
