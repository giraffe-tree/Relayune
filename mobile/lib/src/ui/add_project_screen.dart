import 'dart:async';

import 'package:flutter/material.dart';
import '../../l10n/relayune_localizations.dart';
import '../models.dart';
import '../state/app_controller.dart';
import 'project_copy.dart';
import 'theme.dart';

class AddProjectScreen extends StatefulWidget {
  const AddProjectScreen({
    super.key,
    required this.controller,
    required this.provider,
  });
  final AppController controller;
  final String provider;
  @override
  State<AddProjectScreen> createState() => _AddProjectScreenState();
}

class _AddProjectScreenState extends State<AddProjectScreen> {
  final _name = TextEditingController();
  final _prompt = TextEditingController();
  List<Map<String, dynamic>> _locations = [];
  String _mode = 'new', _path = '', _error = '';
  bool _busy = false, _more = false, _taskUnconfirmed = false;
  Timer? _checkTimer;
  int _checkVersion = 0;
  bool _checking = false, _canCreate = false;
  String _checkError = '', _checkedPath = '';
  late bool _wasOnline;
  Map<String, dynamic>? _directory;
  RelayProject? _project;
  late final String? _deviceId = widget.controller.bootstrap?.device.id;
  AppController get controller => widget.controller;
  bool get online =>
      controller.deviceOnline && controller.bootstrap?.device.id == _deviceId;
  String get _providerName =>
      const {
        'codex': 'Codex',
        'kimi': 'Kimi Code',
        'claude': 'Claude Code',
        'claude-cowork': 'Claude Cowork',
        'opencode': 'OpenCode',
      }[widget.provider] ??
      widget.provider;
  String t(String key) => projectText(context.l10n.localeName, key);

  bool _usable(Map<String, dynamic> location) =>
      location['available'] == true &&
      (_mode != 'new' || location['writable'] == true);

  String _locationError(Map<String, dynamic> location) =>
      location['error_code'] as String? ?? 'permission_denied';

  // Keep recent order within each group, but never hide usable roots behind
  // three unavailable parent suggestions.
  List<Map<String, dynamic>> get _orderedLocations => [
    ..._locations.where(_usable),
    ..._locations.where((location) => !_usable(location)),
  ];

  @override
  void initState() {
    super.initState();
    _wasOnline = online;
    controller.addListener(_connectionChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) => _run(_load));
  }

  @override
  void dispose() {
    controller.removeListener(_connectionChanged);
    _checkTimer?.cancel();
    _checkVersion++;
    _name.dispose();
    _prompt.dispose();
    super.dispose();
  }

  bool get _validName {
    final name = _name.text.trim();
    return name.isNotEmpty &&
        !['.', '..'].contains(name) &&
        !RegExp(r'[\\/\x00-\x1f\x7f]').hasMatch(name);
  }

  void _connectionChanged() {
    if (_wasOnline == online) return;
    _wasOnline = online;
    _scheduleCheck();
  }

  void _scheduleCheck() {
    _checkTimer?.cancel();
    final version = ++_checkVersion;
    final eligible =
        _mode == 'new' &&
        _project == null &&
        _path.isNotEmpty &&
        _validName &&
        online;
    setState(() {
      _canCreate = false;
      _checkedPath = '';
      _checkError = _name.text.trim().isNotEmpty && !_validName
          ? 'invalid_name'
          : '';
      _checking = eligible;
    });
    if (!eligible) return;
    final path = _path, name = _name.text.trim();
    _checkTimer = Timer(const Duration(milliseconds: 350), () async {
      try {
        final result = await controller.projectRequest('project.check', {
          'path': path,
          'name': name,
          'provider': widget.provider,
        });
        if (!mounted || version != _checkVersion || !online) return;
        setState(() {
          _checkedPath = result['path'] as String? ?? '';
          _canCreate = result['can_create'] == true && _checkedPath.isNotEmpty;
          _checkError = _canCreate ? '' : 'project_check_failed';
        });
      } on Object catch (error) {
        if (!mounted || version != _checkVersion) return;
        setState(
          () => _checkError = error is StateError
              ? error.message.toString()
              : 'project_check_failed',
        );
      } finally {
        if (mounted && version == _checkVersion) {
          setState(() => _checking = false);
        }
      }
    });
  }

  Future<void> _run(Future<void> Function() work) async {
    if (_busy || !online) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await work();
    } on Object catch (error) {
      if (mounted) {
        setState(
          () => _error = error is StateError
              ? error.message.toString()
              : 'project_failed',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _load() async {
    final response = await controller.projectRequest('project.locations', {
      'provider': widget.provider,
    });
    if (!mounted) return;
    setState(() {
      _locations = jsonMapList(response['locations']);
      final current = controller.activeRootSession?.cwd.replaceAll('\\', '/');
      final usable = _locations.where(
        (p) => p['available'] == true && p['writable'] == true,
      );
      final selected = _locations.where((p) => p['path'] == _path).firstOrNull;
      if (selected != null && !_usable(selected)) _path = '';
      if (_path.isEmpty && _mode == 'new') {
        _path =
            (usable
                        .where(
                          (p) =>
                              current?.startsWith(
                                '${p['path'].toString().replaceAll('\\', '/')}/',
                              ) ==
                              true,
                        )
                        .firstOrNull ??
                    usable.firstOrNull)?['path']
                as String? ??
            '';
      }
    });
    _scheduleCheck();
  }

  Future<void> _chooseLocation(Map<String, dynamic> location) async {
    if (_busy || !online) return;
    final target = location['path'] as String;
    if (!_usable(location)) {
      final refresh = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(t('location')),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(t(_locationError(location))),
                const SizedBox(height: 16),
                _pathLabel(target),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: Text(t('cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(t('refresh')),
            ),
          ],
        ),
      );
      if (!mounted || refresh != true) return;
      await _run(() async {
        await _load();
        if (!mounted) return;
        final refreshed = _locations
            .where((p) => p['path'] == target)
            .firstOrNull;
        if (refreshed == null) throw StateError('location_unavailable');
        if (!_usable(refreshed)) throw StateError(_locationError(refreshed));
        if (_mode == 'new') {
          setState(() => _path = target);
          _scheduleCheck();
        } else {
          await _browse(target);
        }
      });
    } else if (_mode == 'new') {
      setState(() => _path = target);
      _scheduleCheck();
    } else {
      await _run(() => _browse(target));
    }
  }

  Future<void> _browse(String path, [int offset = 0]) async {
    final response = await controller.projectRequest('project.browse', {
      'provider': widget.provider,
      'path': path,
      'offset': offset,
    });
    if (!mounted) return;
    setState(() {
      if (offset > 0) {
        response['directories'] = [
          ...jsonMapList(_directory?['directories']),
          ...jsonMapList(response['directories']),
        ];
      }
      _directory = response;
    });
  }

  Future<void> _create() async {
    if (_mode == 'new' && (!_canCreate || _checking)) return;
    final project = await controller.createProject(
      provider: widget.provider,
      mode: _mode,
      path: _path,
      name: _name.text,
    );
    if (mounted) setState(() => _project = project);
  }

  Widget _pathLabel(String path) => Text(
    path,
    textDirection: TextDirection.ltr,
    style: const TextStyle(fontSize: 12, color: RelayTheme.mutedBright),
  );

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: controller,
    builder: (context, _) {
      final selected = _locations.where((p) => p['path'] == _path).firstOrNull;
      final name = _name.text.trim();
      return Scaffold(
        appBar: AppBar(title: Text(t(_project == null ? 'title' : 'ready'))),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                '${controller.bootstrap?.device.name ?? ''} · $_providerName · ${t(online ? 'online' : 'offline')}',
              ),
              const SizedBox(height: 6),
              Text(
                t('local'),
                style: const TextStyle(
                  color: RelayTheme.mutedBright,
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: 22),
              if (_project case final project?) ...[
                Text(
                  project.name,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                _pathLabel(project.cwd),
                const SizedBox(height: 28),
                if (widget.provider == 'claude-cowork')
                  Text(t('coworkStart'))
                else ...[
                  TextField(
                    controller: _prompt,
                    minLines: 3,
                    maxLines: 6,
                    enabled: !_busy && !_taskUnconfirmed,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(labelText: t('prompt')),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed:
                        !_busy &&
                            online &&
                            _prompt.text.trim().isNotEmpty &&
                            !_taskUnconfirmed
                        ? () => _run(() async {
                            _taskUnconfirmed = true;
                            await controller.startProjectTask(
                              project,
                              _prompt.text.trim(),
                            );
                            if (context.mounted) {
                              Navigator.of(context).pop(true);
                            }
                          })
                        : null,
                    child: Text(t(_busy ? 'working' : 'start')),
                  ),
                  if (_taskUnconfirmed && !_busy) Text(t('taskFailed')),
                ],
              ] else if (_directory case final directory?) ...[
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => setState(() => _directory = null),
                  child: Text(t('back')),
                ),
                _pathLabel(directory['path'] as String),
                const SizedBox(height: 12),
                if (directory['parent'] case final String parent)
                  TextButton(
                    onPressed: _busy || !online
                        ? null
                        : () => _run(() => _browse(parent)),
                    child: Text('↑ ${t('back')}'),
                  ),
                for (final item in jsonMapList(directory['directories']))
                  ListTile(
                    leading: const Icon(Icons.folder_outlined),
                    title: Text(item['name'] as String),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: _busy || !online
                        ? null
                        : () => _run(() => _browse(item['path'] as String)),
                  ),
                if (jsonMapList(directory['directories']).isEmpty)
                  Text(t('noFolders')),
                if (directory['next_offset'] case final int offset)
                  TextButton(
                    onPressed: _busy || !online
                        ? null
                        : () => _run(
                            () => _browse(directory['path'] as String, offset),
                          ),
                    child: Text(t('loadMore')),
                  ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy || !online
                      ? null
                      : () => setState(() {
                          _path = directory['path'] as String;
                          _directory = null;
                          _scheduleCheck();
                        }),
                  child: Text(t('select')),
                ),
              ] else ...[
                SegmentedButton<String>(
                  segments: [
                    ButtonSegment(value: 'new', label: Text(t('new'))),
                    ButtonSegment(
                      value: 'existing',
                      label: Text(t('existing')),
                    ),
                  ],
                  selected: {_mode},
                  onSelectionChanged: _busy
                      ? null
                      : (values) => setState(() {
                          _mode = values.first;
                          _path = _mode == 'new'
                              ? (_locations
                                            .where(
                                              (p) =>
                                                  p['available'] == true &&
                                                  p['writable'] == true,
                                            )
                                            .firstOrNull?['path']
                                        as String? ??
                                    '')
                              : '';
                          _error = '';
                          _scheduleCheck();
                        }),
                ),
                const SizedBox(height: 20),
                if (_mode == 'new')
                  TextField(
                    key: const ValueKey('new-project-name'),
                    controller: _name,
                    maxLength: 80,
                    enabled: !_busy,
                    onChanged: (_) {
                      _error = '';
                      _scheduleCheck();
                    },
                    decoration: InputDecoration(labelText: t('name')),
                  ),
                const SizedBox(height: 12),
                Text(t('location')),
                Text(
                  t('parents'),
                  style: const TextStyle(
                    color: RelayTheme.mutedBright,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 8),
                for (final location
                    in (_more ? _orderedLocations : _orderedLocations.take(3)))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Material(
                      color: RelayTheme.panelRaised,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(9),
                        side: BorderSide(
                          color: _mode == 'new' && _path == location['path']
                              ? RelayTheme.green
                              : RelayTheme.line,
                        ),
                      ),
                      child: ListTile(
                        leading: !_usable(location)
                            ? const Icon(Icons.folder_off_outlined)
                            : _mode == 'new'
                            ? Icon(
                                _path == location['path']
                                    ? Icons.radio_button_checked
                                    : Icons.radio_button_off,
                                color: _path == location['path']
                                    ? RelayTheme.green
                                    : RelayTheme.muted,
                              )
                            : const Icon(Icons.folder_outlined),
                        title: Text(location['name'] as String),
                        subtitle: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _pathLabel(location['path'] as String),
                            Text(
                              (location['projects'] as List).join(' · '),
                              style: const TextStyle(fontSize: 12),
                            ),
                            if (!_usable(location))
                              Text(
                                t(_locationError(location)),
                                style: const TextStyle(fontSize: 12),
                              ),
                          ],
                        ),
                        enabled: !_busy && online,
                        onTap: () => _chooseLocation(location),
                      ),
                    ),
                  ),
                if (_locations.length > 3 && !_more)
                  TextButton(
                    onPressed: () => setState(() => _more = true),
                    child: Text(t('more')),
                  ),
                if (!_locations.any(_usable)) Text(t('empty')),
                Wrap(
                  spacing: 8,
                  children: [
                    TextButton(
                      onPressed: _busy || !online ? null : () => _run(_load),
                      child: Text(t('refresh')),
                    ),
                    TextButton(
                      onPressed:
                          _busy ||
                              !online ||
                              !_locations.any((p) => p['available'] == true)
                          ? null
                          : () => _run(
                              () => _browse(
                                _path.isNotEmpty
                                    ? _path
                                    : _locations.firstWhere(
                                            (p) => p['available'] == true,
                                          )['path']
                                          as String,
                              ),
                            ),
                      child: Text(t('browse')),
                    ),
                  ],
                ),
                if (_path.isNotEmpty)
                  _pathLabel(
                    _checkedPath.isNotEmpty
                        ? _checkedPath
                        : _mode == 'new' && name.isNotEmpty
                        ? '$_path${_path.endsWith('/') || _path.endsWith('\\')
                              ? ''
                              : _path.contains('\\')
                              ? '\\'
                              : '/'}$name'
                        : _path,
                  ),
                if (_mode == 'new' && name.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(
                    t(
                      _checking
                          ? 'checking'
                          : _canCreate
                          ? 'canCreate'
                          : _checkError.isNotEmpty
                          ? _checkError
                          : 'checkPending',
                    ),
                    style: TextStyle(
                      color: _checkError.isNotEmpty
                          ? RelayTheme.red
                          : RelayTheme.mutedBright,
                    ),
                  ),
                  if (_checkError.isNotEmpty && online)
                    TextButton(
                      onPressed: _busy ? null : _scheduleCheck,
                      child: Text(t('checkAgain')),
                    ),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  key: const ValueKey('create-project-submit'),
                  onPressed:
                      _busy ||
                          !online ||
                          _path.isEmpty ||
                          (_mode == 'new' &&
                              (!_canCreate ||
                                  _checking ||
                                  selected?['writable'] == false))
                      ? null
                      : () => _run(_create),
                  child: Text(
                    t(
                      _busy
                          ? 'working'
                          : _error.isNotEmpty
                          ? 'retry'
                          : _mode == 'new'
                          ? 'create'
                          : 'add',
                    ),
                  ),
                ),
              ],
              if (_error.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(
                    t(_error),
                    style: const TextStyle(color: RelayTheme.red),
                  ),
                ),
            ],
          ),
        ),
      );
    },
  );
}
