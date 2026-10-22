#!/usr/bin/env python3
"""Render locally, then explicitly apply/verify SLS resources using a private key file."""
import argparse
import json
import os
import re
import stat
import sys
import time
from pathlib import Path

from config import OWNER, build


class SetupError(Exception):
    pass


class JsonDetail:
    """SDK detail interface; preserves the exact reviewed JSON definitions."""
    def __init__(self, value):
        self.value = value
        self.config_name = value.get('configName')
        self.logstore_name = value.get('outputDetail', {}).get('logstoreName')

    def to_json(self):
        return self.value


def credentials(path):
    if not path:
        raise SetupError('credentials_file_required')
    path = Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
            raise SetupError('credentials_file_requires_current_owner_and_0600')
        if info.st_size > 16384:
            raise SetupError('credentials_file_too_large')
        raw = stream.read()
    # Either an explicit JSON object or the established two-line local key format.
    if raw.lstrip().startswith('{'):
        data = json.loads(raw)
        key, secret = data.get('access_key_id'), data.get('access_key_secret')
        token = data.get('security_token')
    else:
        lines = raw.strip().splitlines()
        if len(lines) != 2:
            raise SetupError('credentials_file_invalid_format')
        key, secret = lines
        token = None
    if not all(isinstance(x, str) and x.strip() and not any(c.isspace() for c in x) for x in (key, secret)):
        raise SetupError('credentials_file_invalid_format')
    if token is not None and (not isinstance(token, str) or not token.strip()):
        raise SetupError('credentials_file_invalid_token')
    return key, secret, token


def emit(event, **fields):
    print(json.dumps({'event': event, **fields}, ensure_ascii=False), flush=True)


def body(response):
    value = response.get_body()
    return json.loads(value) if isinstance(value, str) else value


def read_optional(read, missing):
    try:
        return body(read())
    except Exception as error:
        # Authentication/network failures must never be mistaken for missing resources.
        code = getattr(error, 'get_error_code', lambda: '')()
        if code in missing:
            return None
        raise


def contains(actual, expected):
    """Allow server-generated metadata/defaults, never ignore expected settings."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(k in actual and contains(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(contains(a, e) for a, e in zip(actual, expected))
    return actual == expected


def set_alert_status(client, project, alert):
    # SLS job creation/update may ignore status in the body. Use the action API
    # and verify the read-back rather than assuming the submitted value applied.
    operation = client.enable_alert if alert['status'] == 'ENABLED' else client.disable_alert
    operation(project, alert['name'])
    if body(client.get_alert(project, alert['name'])).get('status') != alert['status']:
        raise SetupError('alert_status_not_applied')


def create_alert(client, project, alert):
    client.create_alert(project, alert)
    set_alert_status(client, project, alert)


def resources(client, config):
    p = config['project']['projectName']
    s = config['logstore']['logstoreName']
    group = config['machineGroup']['groupName']
    collector = config['collection']['configName']
    entries = [
        ('logstore', config['logstore'], lambda: client.get_logstore(p, s), {'LogStoreNotExist'},
         lambda: client.create_logstore(p, s, ttl=config['logstore']['ttl'], shard_count=1,
                                        auto_split=False, append_meta=False, enable_tracking=False)),
        ('index', config['index'], lambda: client.get_index_config(p, s), {'IndexConfigNotExist', 'LogStoreNotExist'},
         lambda: client.create_index(p, s, JsonDetail(config['index']))),
        ('machine_group', config['machineGroup'], lambda: client.get_machine_group(p, group), {'MachineGroupNotExist'},
         lambda: client.create_machine_group(p, JsonDetail(config['machineGroup']))),
        ('collection', config['collection'], lambda: client.get_logtail_config(p, collector), {'ConfigNotExist'},
         lambda: client.create_logtail_config(p, JsonDetail(config['collection']))),
        ('dashboard', config['dashboard'], lambda: client.get_dashboard(p, config['dashboard']['dashboardName']), {'DashboardNotExist'},
         lambda: client.create_dashboard(p, config['dashboard'])),
    ]
    for alert in config['alerts']:
        entries.append((alert['name'], alert, lambda a=alert: client.get_alert(p, a['name']), {'JobNotExist', 'AlertNotExist'},
                        lambda a=alert: create_alert(client, p, a)))
    return entries


def inspect(client, config):
    p = config['project']['projectName']
    project = read_optional(lambda: client.get_project(p), {'ProjectNotExist'})
    if project is None and config.get('useExistingResources'):
        raise SetupError('existing_project_required')
    if project is None:
        return None, [(entry, None) for entry in resources(client, config)]
    if project.get('description') != OWNER and not config.get('useExistingResources'):
        raise SetupError('project_name_owned_by_other_configuration')
    snapshots = []
    for entry in resources(client, config):
        name, expected, read, missing, _ = entry
        actual = read_optional(read, missing)
        if name == 'logstore' and config.get('useExistingResources'):
            if actual is None:
                raise SetupError('existing_logstore_required')
            # Preserve all existing storage settings; never adopt a missing store.
            snapshots.append((entry, actual))
            continue
        if actual is not None:
            # Extra indexed fields/full-text would violate the field allowlist.
            if name == 'index' and (set(actual.get('keys', {})) != set(expected['keys']) or actual.get('line')):
                raise SetupError('resource_conflict_index')
            if not contains(actual, expected):
                raise SetupError('resource_conflict_' + name)
        snapshots.append((entry, actual))
    return project, snapshots


def apply(client, config, activate=False):
    # Check *all* existing resources before the first mutation. Never overwrite,
    # delete, grant permissions, or silently adopt a colliding resource.
    project, snapshots = inspect(client, config)
    p = config['project']['projectName']
    group = config['machineGroup']['groupName']
    collector = config['collection']['configName']
    configs = []
    if activate and any(entry[0] == 'machine_group' and actual is not None for entry, actual in snapshots):
        configs = body(client.get_machine_group_applied_configs(p, group)).get('configs', [])
        if any(item != collector for item in configs):
            raise SetupError('machine_group_has_other_collectors')
    if project is None:
        client.create_project(p, OWNER)
        emit('created', resource='project', name=p)
    for (name, _, _, _, create), actual in snapshots:
        if actual is None:
            create()
            emit('created', resource=name)
        else:
            emit('unchanged', resource=name)
    if activate:
        if collector not in configs:
            client.apply_config_to_machine_group(p, collector, group)
            emit('collection_bound', machine_group=group)
    emit('resources_ready', collection_activation_requested=activate,
         enabled_alerts=sum(a['status'] == 'ENABLED' for a in config['alerts']),
         dashboard=f'https://sls.console.aliyun.com/lognext/project/{p}/dashboard/{config["dashboard"]["dashboardName"]}')


def migrate_v2(client, config, args):
    """Only replace exact deployed v1 definitions, never overwrite customizations."""
    from config_v1 import build as build_v1
    if not args.use_existing_resources:
        raise SetupError('migration_requires_existing_resources')
    legacy = build_v1(args)
    p, store = config['project']['projectName'], config['logstore']['logstoreName']
    body(client.get_project(p))
    body(client.get_logstore(p, store))
    updates = {
        'index': lambda value: client.update_index(p, store, JsonDetail(value)),
        'collection': lambda value: client.update_logtail_config(p, JsonDetail(value)),
        'dashboard': lambda value: client.update_dashboard(p, value),
    }
    old = {entry[0]: entry[1] for entry in resources(client, legacy)}
    plan = []
    for entry in resources(client, config):
        name, expected, read, missing, create = entry
        actual = read_optional(read, missing)
        if name == 'logstore':
            continue
        def matches(value):
            return contains(actual, value) and (name != 'index' or
                (set(actual.get('keys', {})) == set(value['keys']) and not actual.get('line')))
        if actual is None:
            plan.append((name, 'create', create))
        elif matches(expected):
            continue
        elif matches(old[name]):
            if name not in updates and not name.startswith('relayune-'):
                raise SetupError('migration_unsupported_' + name)
            update = updates.get(name, lambda value: client.update_alert(p, value))
            plan.append((name, 'update', lambda update=update, value=expected: update(value)))
        else:
            raise SetupError('migration_conflict_' + name)
    for name, operation, mutate in plan:
        emit('migration_plan', resource=name, operation=operation)
    if args.dry_run:
        return
    for name, operation, mutate in plan:
        mutate()
        if name.startswith('relayune-'):
            set_alert_status(client, p, next(a for a in config['alerts'] if a['name'] == name))
        emit('migrated', resource=name, operation=operation)
    inspect(client, config)
    emit('migration_verified', request_time_unit='milliseconds_for_schema_2')


def configure_alerts(client, config):
    """Explicitly change only notification policy/status on our matching rules."""
    p = config['project']['projectName']
    project = body(client.get_project(p))
    if project.get('description') != OWNER and not config.get('useExistingResources'):
        raise SetupError('project_name_owned_by_other_configuration')
    changes = []
    for expected in config['alerts']:
        actual = body(client.get_alert(p, expected['name']))
        # Existing queries, thresholds and ownership must still match. Do not
        # overwrite a rule a person has customized in the console.
        old, new = json.loads(json.dumps(actual)), json.loads(json.dumps(expected))
        for value in (old, new):
            value.pop('status', None)
            value['configuration'].pop('policyConfiguration', None)
        if not contains(old, new):
            raise SetupError('alert_definition_conflict')
        if not contains(actual, expected):
            # Preserve server-managed and optional fields from the current rule.
            actual['status'] = expected['status']
            if 'policyConfiguration' in expected['configuration']:
                actual['configuration']['policyConfiguration'] = expected['configuration']['policyConfiguration']
            else:
                actual['configuration'].pop('policyConfiguration', None)
            changes.append(actual)
    for alert in changes:
        client.update_alert(p, alert)
        set_alert_status(client, p, alert)
        emit('alert_configured', name=alert['name'], status=alert['status'])


def verify(client, config):
    from aliyun.log import GetLogsRequest
    p, s = config['project']['projectName'], config['logstore']['logstoreName']
    end = int(time.time())
    queries = [chart['search']['query'] for chart in config['dashboard']['charts']]
    queries += [alert['configuration']['queryList'][0]['query'] for alert in config['alerts']]
    for i, query in enumerate(queries):
        response = client.get_logs(GetLogsRequest(p, s, end-900, end, query=query))
        if not response.is_completed():
            raise SetupError('query_incomplete')
        emit('query_verified', query_index=i)
    response = client.get_logs(GetLogsRequest(p, s, end-900, end, query='* | SELECT count(*) AS count'))
    rows = response.get_logs()
    if not response.is_completed() or not rows or int(rows[0].get_contents().get('count', 0)) == 0:
        raise SetupError('no_logs_received_in_last_15_minutes')
    emit('ingestion_verified', received_logs=int(rows[0].get_contents()['count']))


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('command', choices=['render', 'inspect', 'apply', 'configure-alerts', 'verify', 'migrate-v2'], nargs='?', default='render')
    p.add_argument('--project', default='relayune-prod-observability')
    p.add_argument('--region', default='cn-huhehaote')
    p.add_argument('--logstore', default='api-access')
    p.add_argument('--machine-group', default='relayune-prod-http')
    p.add_argument('--retention-days', type=int, default=7)
    p.add_argument('--dry-run', action='store_true', help='Preview v2 migration without mutation')
    p.add_argument('--output', type=Path)
    p.add_argument('--credentials-file', type=Path)
    p.add_argument('--action-policy', help='Existing SLS notification action policy ID; never creates recipients')
    p.add_argument('--enable-alerts', action='store_true')
    p.add_argument('--health-probe-installed', action='store_true')
    p.add_argument('--use-existing-resources', action='store_true',
                   help='Require existing Project/Logstore and preserve their settings; retain child conflict checks')
    p.add_argument('--activate-collection', action='store_true', help='Bind config after host collector validation')
    return p


def main():
    args = parser().parse_args()
    try:
        if args.dry_run and args.command != 'migrate-v2':
            raise SetupError('dry_run_only_supported_for_migrate_v2')
        config = build(args)
        if args.command == 'render':
            output = json.dumps(config, ensure_ascii=False, indent=2) + '\n'
            if args.output:
                # Never clobber a user file or follow a symlink.
                with args.output.open('x') as target:
                    target.write(output)
                emit('rendered', path=str(args.output))
            else:
                print(output, end='')
            return 0
        from aliyun.log import LogClient
        key, secret, token = credentials(args.credentials_file)
        client = LogClient('https://' + config['region'] + '.log.aliyuncs.com', key, secret,
                           securityToken=token)
        client.timeout = 20
        if args.command == 'migrate-v2':
            migrate_v2(client, config, args)
        elif args.command == 'apply':
            apply(client, config, args.activate_collection)
        elif args.command == 'configure-alerts':
            configure_alerts(client, config)
        elif args.command == 'verify':
            verify(client, config)
        else:
            project, snapshots = inspect(client, config)
            emit('inspection', project_exists=project is not None,
                 resources={entry[0]: 'present' if actual is not None else 'missing' for entry, actual in snapshots})
        return 0
    except Exception as error:
        # SDK exceptions can contain credentials, URLs or provider payloads.
        # Only our own fixed codes, or a constrained provider error code, escape.
        code = str(error) if isinstance(error, SetupError) else 'operation_failed'
        provider = getattr(error, 'get_error_code', lambda: '')()
        if provider and re.fullmatch(r'[A-Za-z][A-Za-z0-9_.]{0,63}', provider):
            code = provider
        emit('failed', code=code)
        return 1


if __name__ == '__main__':
    sys.exit(main())
