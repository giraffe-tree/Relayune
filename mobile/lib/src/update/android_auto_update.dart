import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

const androidUpdateManifestUri =
    'https://relayune.giraffetree.cn/updates/android.json';
const androidUpdateMinimumCheckInterval = Duration(minutes: 10);
const _androidUpdateDownloadHost = 'open-chen.oss-cn-hangzhou.aliyuncs.com';

enum AndroidUpdatePromptAction { later, install }

typedef AndroidUpdatePrompt =
    Future<AndroidUpdatePromptAction> Function(VerifiedAndroidUpdate update);

class AndroidUpdateManifest {
  const AndroidUpdateManifest({
    required this.versionName,
    required this.versionCode,
    required this.url,
    required this.sha256,
    required this.size,
    required this.publishedAt,
    required this.notes,
  });

  final String versionName;
  final int versionCode;
  final Uri url;
  final String sha256;
  final int size;
  final DateTime publishedAt;
  final Map<String, String> notes;

  String get notesZhCn => notes['zh-CN']!;
  String get notesEn => notes['en']!;

  String notesForLocale(Locale locale) {
    final tag = locale.countryCode == null
        ? locale.languageCode
        : '${locale.languageCode}-${locale.countryCode}';
    return notes[tag] ?? notes[locale.languageCode] ?? notesEn;
  }

  factory AndroidUpdateManifest.fromJson(Map<String, dynamic> json) {
    const expectedKeys = {
      'version_name',
      'version_code',
      'url',
      'sha256',
      'size',
      'published_at',
      'notes',
    };
    if (json.length != expectedKeys.length ||
        !json.keys.toSet().containsAll(expectedKeys)) {
      throw const FormatException('Android update manifest schema is invalid');
    }
    final versionName = json['version_name'];
    final versionCode = json['version_code'];
    final rawUrl = json['url'];
    final rawSha256 = json['sha256'];
    final size = json['size'];
    final rawPublishedAt = json['published_at'];
    final rawNotes = json['notes'];
    if (versionName is! String || !_isSemanticVersion(versionName)) {
      throw const FormatException('version_name must be a semantic version');
    }
    if (versionCode is! int || versionCode <= 0) {
      throw const FormatException('version_code must be a positive integer');
    }
    if (rawUrl is! String) {
      throw const FormatException('url must be a string');
    }
    final url = Uri.tryParse(rawUrl);
    final expectedPath =
        '/apps/relayune/$versionName/Relayune-$versionName-Android.apk';
    if (url == null ||
        url.scheme != 'https' ||
        url.host != _androidUpdateDownloadHost ||
        url.hasPort ||
        url.userInfo.isNotEmpty ||
        url.query.isNotEmpty ||
        url.fragment.isNotEmpty ||
        url.path != expectedPath) {
      throw const FormatException('url is not an approved Relayune APK URL');
    }
    if (rawSha256 is! String ||
        !RegExp(r'^[a-fA-F0-9]{64}$').hasMatch(rawSha256)) {
      throw const FormatException('sha256 must contain 64 hexadecimal digits');
    }
    if (size is! int || size <= 0) {
      throw const FormatException('size must be a positive integer');
    }
    if (rawPublishedAt is! String) {
      throw const FormatException('published_at must be a string');
    }
    final publishedAt = DateTime.tryParse(rawPublishedAt);
    if (publishedAt == null ||
        !publishedAt.isUtc ||
        !_utcIsoTimestamp.hasMatch(rawPublishedAt)) {
      throw const FormatException('published_at must be a UTC ISO timestamp');
    }
    const allowedNoteLocales = {
      'en',
      'zh-CN',
      'hi',
      'es',
      'ar',
      'fr',
      'bn',
      'pt',
      'id',
      'ur',
    };
    if (rawNotes is! Map<String, dynamic> ||
        !rawNotes.keys.toSet().containsAll(const {'zh-CN', 'en'}) ||
        !allowedNoteLocales.containsAll(rawNotes.keys) ||
        rawNotes['zh-CN'] is! String ||
        (rawNotes['zh-CN'] as String).trim().isEmpty ||
        rawNotes['en'] is! String ||
        (rawNotes['en'] as String).trim().isEmpty ||
        rawNotes.values.any(
          (value) => value is! String || value.trim().isEmpty,
        )) {
      throw const FormatException(
        'notes must contain non-empty supported locale values including zh-CN and en',
      );
    }
    return AndroidUpdateManifest(
      versionName: versionName.trim(),
      versionCode: versionCode,
      url: url,
      sha256: rawSha256.toLowerCase(),
      size: size,
      publishedAt: publishedAt.toUtc(),
      notes: {
        for (final entry in rawNotes.entries)
          entry.key: (entry.value as String).trim(),
      },
    );
  }

  Map<String, dynamic> toJson() => {
    'version_name': versionName,
    'version_code': versionCode,
    'url': url.toString(),
    'sha256': sha256,
    'size': size,
    'published_at': publishedAt.toUtc().toIso8601String(),
    'notes': notes,
  };

  static final RegExp _semanticVersion = RegExp(
    r'^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)'
    r'(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?'
    r'(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$',
  );

  static bool _isSemanticVersion(String value) =>
      value == value.trim() && _semanticVersion.hasMatch(value);

  static final RegExp _utcIsoTimestamp = RegExp(
    r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$',
  );
}

class VerifiedAndroidUpdate {
  const VerifiedAndroidUpdate({required this.manifest, required this.apkPath});

  final AndroidUpdateManifest manifest;
  final String apkPath;

  factory VerifiedAndroidUpdate.fromJson(Map<String, dynamic> json) {
    final rawManifest = json['manifest'];
    final apkPath = json['apk_path'];
    if (rawManifest is! Map<String, dynamic> || apkPath is! String) {
      throw const FormatException('invalid verified Android update');
    }
    return VerifiedAndroidUpdate(
      manifest: AndroidUpdateManifest.fromJson(rawManifest),
      apkPath: apkPath,
    );
  }

  Map<String, dynamic> toJson() => {
    'manifest': manifest.toJson(),
    'apk_path': apkPath,
  };
}

class AndroidUpdateState {
  const AndroidUpdateState({this.lastCheckAt, this.verifiedUpdate});

  final DateTime? lastCheckAt;
  final VerifiedAndroidUpdate? verifiedUpdate;

  AndroidUpdateState copyWith({
    DateTime? lastCheckAt,
    VerifiedAndroidUpdate? verifiedUpdate,
    bool clearVerifiedUpdate = false,
  }) => AndroidUpdateState(
    lastCheckAt: lastCheckAt ?? this.lastCheckAt,
    verifiedUpdate: clearVerifiedUpdate
        ? null
        : verifiedUpdate ?? this.verifiedUpdate,
  );

  factory AndroidUpdateState.fromJson(Map<String, dynamic> json) {
    final rawLastCheckAt = json['last_check_at'];
    final rawVerifiedUpdate = json['verified_update'];
    final lastCheckAt = rawLastCheckAt is String
        ? DateTime.tryParse(rawLastCheckAt)?.toUtc()
        : null;
    return AndroidUpdateState(
      lastCheckAt: lastCheckAt,
      verifiedUpdate: rawVerifiedUpdate is Map<String, dynamic>
          ? VerifiedAndroidUpdate.fromJson(rawVerifiedUpdate)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
    if (lastCheckAt case final lastCheckAt?)
      'last_check_at': lastCheckAt.toUtc().toIso8601String(),
    if (verifiedUpdate case final verifiedUpdate?)
      'verified_update': verifiedUpdate.toJson(),
  };
}

abstract interface class AndroidUpdateStateStore {
  Future<AndroidUpdateState> read();

  Future<void> write(AndroidUpdateState state);
}

class FileAndroidUpdateStateStore implements AndroidUpdateStateStore {
  const FileAndroidUpdateStateStore(this.file);

  final File file;

  @override
  Future<AndroidUpdateState> read() async {
    try {
      if (!await file.exists()) return const AndroidUpdateState();
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! Map<String, dynamic>) return const AndroidUpdateState();
      return AndroidUpdateState.fromJson(decoded);
    } on Object {
      return const AndroidUpdateState();
    }
  }

  @override
  Future<void> write(AndroidUpdateState state) async {
    await file.parent.create(recursive: true);
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(jsonEncode(state.toJson()), flush: true);
    if (await file.exists()) await file.delete();
    await temporary.rename(file.path);
  }
}

class AndroidUpdateRepository {
  AndroidUpdateRepository({
    required AndroidUpdateStateStore stateStore,
    required Directory downloadDirectory,
    http.Client? client,
    Uri? manifestUri,
    DateTime Function()? now,
    Duration minimumCheckInterval = androidUpdateMinimumCheckInterval,
  }) : _stateStore = stateStore,
       _downloadDirectory = downloadDirectory,
       _client = client ?? http.Client(),
       _manifestUri = manifestUri ?? Uri.parse(androidUpdateManifestUri),
       _now = now ?? DateTime.now,
       _minimumCheckInterval = minimumCheckInterval;

  final AndroidUpdateStateStore _stateStore;
  final Directory _downloadDirectory;
  final http.Client _client;
  final Uri _manifestUri;
  final DateTime Function() _now;
  final Duration _minimumCheckInterval;
  bool _foreground = true;
  Completer<void> _cancelBackgroundWork = Completer<void>();
  final _backgroundEvents = StreamController<void>.broadcast(sync: true);

  void setForeground(bool foreground) {
    if (_foreground == foreground) return;
    _foreground = foreground;
    if (!foreground) {
      _cancelBackgroundWork.complete();
      _backgroundEvents.add(null);
    } else {
      _cancelBackgroundWork = Completer<void>();
    }
  }

  void _checkCancelled(Completer<void> cancellation) {
    if (cancellation.isCompleted) {
      throw StateError('Update deferred until foreground');
    }
  }

  Future<VerifiedAndroidUpdate?> readyUpdate(int currentVersionCode) async {
    final state = await _stateStore.read();
    final update = state.verifiedUpdate;
    if (update == null) return null;
    if (update.manifest.versionCode <= currentVersionCode) {
      await _discardVerifiedUpdate(state, update);
      return null;
    }
    if (!await _verifyFile(update)) {
      await _discardVerifiedUpdate(state, update);
      return null;
    }
    return update;
  }

  Future<VerifiedAndroidUpdate?> checkAndDownload(
    int currentVersionCode,
  ) async {
    if (!_foreground) return null;
    final cancellation = _cancelBackgroundWork;
    var state = await _stateStore.read();
    _checkCancelled(cancellation);
    final now = _now().toUtc();
    final lastCheckAt = state.lastCheckAt;
    if (lastCheckAt != null &&
        now.difference(lastCheckAt) < _minimumCheckInterval) {
      return null;
    }

    // Persist before network I/O so repeated failures cannot bypass throttling.
    state = state.copyWith(lastCheckAt: now);
    await _stateStore.write(state);

    final manifestRequest = http.Request('GET', _manifestUri)
      ..followRedirects = false;
    final streamedManifest = await _client.send(manifestRequest);
    final response = await http.Response.fromStream(streamedManifest);
    _checkCancelled(cancellation);
    if (response.statusCode != HttpStatus.ok) {
      throw HttpException(
        'Android update manifest returned ${response.statusCode}',
        uri: _manifestUri,
      );
    }
    final decoded = jsonDecode(utf8.decode(response.bodyBytes));
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Android update manifest must be an object');
    }
    final manifest = AndroidUpdateManifest.fromJson(decoded);
    if (manifest.versionCode <= currentVersionCode) {
      final stale = state.verifiedUpdate;
      if (stale != null && stale.manifest.versionCode <= currentVersionCode) {
        await _discardVerifiedUpdate(state, stale);
      }
      return null;
    }

    final cached = state.verifiedUpdate;
    if (cached != null &&
        cached.manifest.versionCode == manifest.versionCode &&
        cached.manifest.sha256 == manifest.sha256 &&
        cached.manifest.size == manifest.size &&
        await _verifyFile(cached)) {
      return cached;
    }

    _checkCancelled(cancellation);
    final verified = await _downloadAndVerify(manifest, cancellation);
    await _stateStore.write(
      state.copyWith(lastCheckAt: now, verifiedUpdate: verified),
    );
    if (cached != null && cached.apkPath != verified.apkPath) {
      await _deleteManagedApk(cached.apkPath);
    }
    return verified;
  }

  Future<VerifiedAndroidUpdate> _downloadAndVerify(
    AndroidUpdateManifest manifest,
    Completer<void> cancellation,
  ) async {
    await _downloadDirectory.create(recursive: true);
    final target = File(
      '${_downloadDirectory.path}/relayune-${manifest.versionCode}.apk',
    );
    final partial = File('${target.path}.part');
    if (await partial.exists()) await partial.delete();

    final request = http.Request('GET', manifest.url);
    request.followRedirects = false;
    final response = await _client.send(request);
    if (response.statusCode != HttpStatus.ok) {
      throw HttpException(
        'Android update download returned ${response.statusCode}',
        uri: manifest.url,
      );
    }

    final digestSink = _DigestSink();
    final hashInput = sha256.startChunkedConversion(digestSink);
    IOSink? output;
    var received = 0;
    var hashClosed = false;
    final iterator = StreamIterator(response.stream);
    var reading = false;
    final pause = _backgroundEvents.stream.listen((_) {
      unawaited(iterator.cancel().catchError((Object _) {}));
    });
    try {
      _checkCancelled(cancellation);
      output = partial.openWrite();
      reading = true;
      while (await iterator.moveNext()) {
        _checkCancelled(cancellation);
        final chunk = iterator.current;
        received += chunk.length;
        if (received > manifest.size) {
          throw const FormatException('Android update is larger than expected');
        }
        hashInput.add(chunk);
        output.add(chunk);
      }
      _checkCancelled(cancellation);
      hashClosed = true;
      hashInput.close();
      await output.flush();
      await output.close();
      output = null;
      if (received != manifest.size) {
        throw const FormatException('Android update size does not match');
      }
      if (digestSink.digest.toString() != manifest.sha256) {
        throw const FormatException('Android update SHA-256 does not match');
      }
      if (await target.exists()) await target.delete();
      await partial.rename(target.path);
      return VerifiedAndroidUpdate(manifest: manifest, apkPath: target.path);
    } on Object catch (error, stackTrace) {
      if (!hashClosed) {
        hashClosed = true;
        try {
          hashInput.close();
        } on Object {
          // Preserve the original network or verification failure.
        }
      }
      try {
        await output?.close();
      } on Object {
        // Preserve the original network or verification failure.
      }
      try {
        if (await partial.exists()) await partial.delete();
      } on Object {
        // A future check removes any leftover partial file before downloading.
      }
      Error.throwWithStackTrace(error, stackTrace);
    } finally {
      await pause.cancel();
      await iterator.cancel();
      if (!reading) {
        // StreamIterator is lazy: cancellation before its first moveNext must
        // still subscribe-and-cancel the HTTP body to release the connection.
        await response.stream.listen((_) {}).cancel();
      }
    }
  }

  Future<bool> _verifyFile(VerifiedAndroidUpdate update) async {
    final file = File(update.apkPath);
    if (!await file.exists()) return false;
    if (!await _isManagedApk(file)) return false;
    if (await file.length() != update.manifest.size) return false;
    return (await sha256.bind(file.openRead()).first).toString() ==
        update.manifest.sha256;
  }

  Future<void> _discardVerifiedUpdate(
    AndroidUpdateState state,
    VerifiedAndroidUpdate update,
  ) async {
    await _stateStore.write(state.copyWith(clearVerifiedUpdate: true));
    await _deleteManagedApk(update.apkPath);
  }

  Future<bool> _isManagedApk(File file) async {
    if (file.path.toLowerCase().endsWith('.apk') == false) return false;
    try {
      return (await file.parent.resolveSymbolicLinks()) ==
          (await _downloadDirectory.resolveSymbolicLinks());
    } on FileSystemException {
      return false;
    }
  }

  Future<void> _deleteManagedApk(String path) async {
    final file = File(path);
    if (await file.exists() && await _isManagedApk(file)) {
      await file.delete();
    }
  }

  void close() {
    unawaited(_backgroundEvents.close());
    _client.close();
  }
}

abstract interface class AndroidUpdateInstaller {
  Future<void> install(String apkPath);
}

class AndroidAutoUpdateCoordinator {
  AndroidAutoUpdateCoordinator({
    required AndroidUpdateRepository repository,
    required AndroidUpdateInstaller installer,
    required int currentVersionCode,
    required AndroidUpdatePrompt prompt,
  }) : _repository = repository,
       _installer = installer,
       _currentVersionCode = currentVersionCode,
       _prompt = prompt;

  final AndroidUpdateRepository _repository;
  final AndroidUpdateInstaller _installer;
  final int _currentVersionCode;
  final AndroidUpdatePrompt _prompt;
  bool _checking = false;
  bool _promptingOrInstalling = false;
  bool _disposed = false;
  bool _foreground = true;

  void setForeground(bool foreground) {
    _foreground = foreground;
    _repository.setForeground(foreground);
  }

  Future<void> onForeground() async {
    if (_disposed || !_foreground) return;
    if (!_promptingOrInstalling) {
      _promptingOrInstalling = true;
      try {
        final ready = await _repository.readyUpdate(_currentVersionCode);
        if (ready != null && _foreground && !_disposed) {
          final action = await _prompt(ready);
          if (action == AndroidUpdatePromptAction.install &&
              _foreground &&
              !_disposed) {
            await _installer.install(ready.apkPath);
          }
        }
      } finally {
        _promptingOrInstalling = false;
      }
    }
    await _checkInBackground();
  }

  Future<void> _checkInBackground() async {
    if (_checking || _disposed || !_foreground) return;
    _checking = true;
    try {
      // Intentionally do not prompt here. A package downloaded in this
      // foreground period is offered only on a later launch/resume.
      await _repository.checkAndDownload(_currentVersionCode);
    } on Object {
      // Update checks must never block or disrupt normal app use.
    } finally {
      _checking = false;
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _repository.close();
  }
}

class AndroidUpdateEnvironment {
  const AndroidUpdateEnvironment({
    required this.versionCode,
    required this.statePath,
    required this.downloadDirectory,
  });

  final int versionCode;
  final String statePath;
  final String downloadDirectory;
}

class AndroidUpdatePlatform implements AndroidUpdateInstaller {
  const AndroidUpdatePlatform({
    MethodChannel channel = const MethodChannel(
      'cn.giraffetree.relayune/android_update',
    ),
  }) : _channel = channel;

  final MethodChannel _channel;

  Future<AndroidUpdateEnvironment> environment() async {
    final raw = await _channel.invokeMapMethod<String, dynamic>('environment');
    final versionCode = raw?['version_code'];
    final statePath = raw?['state_path'];
    final downloadDirectory = raw?['download_directory'];
    if (versionCode is! int ||
        statePath is! String ||
        downloadDirectory is! String) {
      throw const FormatException('invalid Android update environment');
    }
    return AndroidUpdateEnvironment(
      versionCode: versionCode,
      statePath: statePath,
      downloadDirectory: downloadDirectory,
    );
  }

  @override
  Future<void> install(String apkPath) =>
      _channel.invokeMethod<void>('install', {'apk_path': apkPath});
}

Future<AndroidAutoUpdateCoordinator> createAndroidAutoUpdateCoordinator({
  required AndroidUpdatePrompt prompt,
}) async {
  const platform = AndroidUpdatePlatform();
  final environment = await platform.environment();
  return AndroidAutoUpdateCoordinator(
    repository: AndroidUpdateRepository(
      stateStore: FileAndroidUpdateStateStore(File(environment.statePath)),
      downloadDirectory: Directory(environment.downloadDirectory),
    ),
    installer: platform,
    currentVersionCode: environment.versionCode,
    prompt: prompt,
  );
}

class _DigestSink implements Sink<Digest> {
  Digest? _digest;

  Digest get digest {
    final value = _digest;
    if (value == null) throw StateError('SHA-256 digest is not ready');
    return value;
  }

  @override
  void add(Digest data) => _digest = data;

  @override
  void close() {}
}
