import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/src/update/android_auto_update.dart';

void main() {
  late Directory temporaryDirectory;

  setUp(() async {
    temporaryDirectory = await Directory.systemTemp.createTemp(
      'relayune-android-update-test-',
    );
  });

  tearDown(() async {
    if (await temporaryDirectory.exists()) {
      await temporaryDirectory.delete(recursive: true);
    }
  });

  test(
    'background cancels a stalled automatic APK stream and leaves no partial package',
    () async {
      final bytes = utf8.encode('verified apk');
      final stream = StreamController<List<int>>();
      var cancelled = false;
      stream.onCancel = () {
        cancelled = true;
      };
      final started = Completer<void>();
      final store = _MemoryStateStore();
      final repository = AndroidUpdateRepository(
        stateStore: store,
        downloadDirectory: temporaryDirectory,
        client: MockClient.streaming((request, _) async {
          if (request.url.path.endsWith('android.json')) {
            return http.StreamedResponse(
              Stream.value(
                utf8.encode(jsonEncode(_manifestJson(bytes: bytes))),
              ),
              200,
            );
          }
          started.complete();
          return http.StreamedResponse(stream.stream, 200);
        }),
      );
      final checking = repository.checkAndDownload(7);
      final failure = expectLater(checking, throwsStateError);
      await started.future;
      repository.setForeground(false);
      await failure;
      expect(cancelled, isTrue);
      expect(store.state.verifiedUpdate, isNull);
      expect(
        temporaryDirectory.listSync().whereType<File>().where(
          (file) => file.path.endsWith('.part'),
        ),
        isEmpty,
      );
      repository.close();
      await stream.close();
    },
  );

  test('background does not start an automatic update check', () async {
    var requests = 0;
    final repository = AndroidUpdateRepository(
      stateStore: _MemoryStateStore(),
      downloadDirectory: temporaryDirectory,
      client: MockClient((_) async {
        requests++;
        return http.Response('', 500);
      }),
    );
    repository.setForeground(false);
    expect(await repository.checkAndDownload(7), isNull);
    expect(requests, 0);
    repository.close();
  });

  test(
    '[MOB-UPD-001][flutter] manifest accepts only the production-safe schema',
    () {
      final validJson = _manifestJson(bytes: utf8.encode('verified apk'));
      final manifest = AndroidUpdateManifest.fromJson(validJson);

      expect(manifest.versionName, '0.2.8');
      expect(manifest.versionCode, 8);
      expect(manifest.url.scheme, 'https');
      expect(manifest.notesZhCn, '改进自动更新。');
      expect(manifest.notesEn, 'Improved automatic updates.');
      expect(
        () => AndroidUpdateManifest.fromJson({
          ..._manifestJson(bytes: utf8.encode('verified apk')),
          'url': 'http://downloads.example.test/relayune.apk',
        }),
        throwsFormatException,
      );
      for (final invalid in <Map<String, dynamic>>[
        {...validJson, 'version_name': '00.2.8'},
        {
          ...validJson,
          'url':
              'https://attacker.example.test/apps/relayune/0.2.8/Relayune-0.2.8-Android.apk',
        },
        {
          ...validJson,
          'url':
              'https://open-chen.oss-cn-hangzhou.aliyuncs.com/apps/relayune/0.2.8/not-relayune.apk',
        },
        {...validJson, 'published_at': '2026-08-11T18:00:00+08:00'},
        {
          ...validJson,
          'notes': {'zh-CN': ' ', 'en': 'Improved automatic updates.'},
        },
        {
          ...validJson,
          'notes': {'zh-CN': '改进自动更新。', 'en': ''},
        },
        {...validJson, 'unexpected': true},
        {
          ...validJson,
          'notes': {
            'zh-CN': '改进自动更新。',
            'en': 'Improved automatic updates.',
            'unexpected': true,
          },
        },
      ]) {
        expect(
          () => AndroidUpdateManifest.fromJson(invalid),
          throwsFormatException,
        );
      }
    },
  );

  test(
    '[MOB-UPD-002][flutter] persisted check time enforces ten-minute throttle',
    () async {
      final bytes = utf8.encode('verified apk');
      final store = _MemoryStateStore();
      var now = DateTime.parse('2026-08-11T10:00:00Z');
      var manifestRequests = 0;
      final repository = AndroidUpdateRepository(
        stateStore: store,
        downloadDirectory: temporaryDirectory,
        now: () => now,
        client: MockClient((request) async {
          if (request.url.path.endsWith('android.json')) {
            manifestRequests += 1;
            return _jsonResponse(_manifestJson(bytes: bytes));
          }
          return http.Response.bytes(bytes, 200);
        }),
      );

      await repository.checkAndDownload(7);
      now = now.add(const Duration(minutes: 9, seconds: 59));
      await repository.checkAndDownload(7);
      expect(manifestRequests, 1);

      now = now.add(const Duration(seconds: 1));
      await repository.checkAndDownload(7);
      expect(manifestRequests, 2);
      expect(store.state.lastCheckAt, now);
    },
  );

  test(
    '[MOB-UPD-003][flutter] download streams and verifies size and SHA-256',
    () async {
      final bytes = List<int>.generate(64 * 1024, (index) => index % 251);
      final store = _MemoryStateStore();
      final repository = AndroidUpdateRepository(
        stateStore: store,
        downloadDirectory: temporaryDirectory,
        client: _clientFor(bytes),
      );

      final downloaded = await repository.checkAndDownload(7);

      expect(downloaded, isNotNull);
      expect(await File(downloaded!.apkPath).readAsBytes(), bytes);
      expect(
        store.state.verifiedUpdate?.manifest.sha256,
        sha256.convert(bytes).toString(),
      );
      expect(store.state.verifiedUpdate?.manifest.size, bytes.length);
      expect(File('${downloaded.apkPath}.part').existsSync(), isFalse);
    },
  );

  test(
    '[MOB-UPD-004][flutter] failed verification preserves the older verified package',
    () async {
      final oldBytes = utf8.encode('old verified apk');
      final badBytes = utf8.encode('tampered new apk');
      final oldFile = File('${temporaryDirectory.path}/relayune-8.apk');
      await oldFile.writeAsBytes(oldBytes);
      final oldUpdate = VerifiedAndroidUpdate(
        manifest: _manifest(bytes: oldBytes, versionCode: 8),
        apkPath: oldFile.path,
      );
      final store = _MemoryStateStore(
        AndroidUpdateState(verifiedUpdate: oldUpdate),
      );
      final repository = AndroidUpdateRepository(
        stateStore: store,
        downloadDirectory: temporaryDirectory,
        client: MockClient((request) async {
          if (request.url.path.endsWith('android.json')) {
            final advertisedBytes = utf8.encode('expected new apk');
            return _jsonResponse(
              _manifestJson(bytes: advertisedBytes, versionCode: 9),
            );
          }
          return http.Response.bytes(badBytes, 200);
        }),
      );

      await expectLater(repository.checkAndDownload(7), throwsFormatException);

      expect(await oldFile.readAsBytes(), oldBytes);
      expect(store.state.verifiedUpdate?.apkPath, oldFile.path);
      expect(
        File('${temporaryDirectory.path}/relayune-9.apk').existsSync(),
        isFalse,
      );
      expect(
        File('${temporaryDirectory.path}/relayune-9.apk.part').existsSync(),
        isFalse,
      );
    },
  );

  test(
    '[MOB-UPD-005][flutter] a fresh download prompts only on the next foreground',
    () async {
      final bytes = utf8.encode('verified apk');
      final store = _MemoryStateStore();
      final installer = _FakeInstaller();
      final prompts = <VerifiedAndroidUpdate>[];
      final coordinator = AndroidAutoUpdateCoordinator(
        repository: AndroidUpdateRepository(
          stateStore: store,
          downloadDirectory: temporaryDirectory,
          client: _clientFor(bytes),
        ),
        installer: installer,
        currentVersionCode: 7,
        prompt: (update) async {
          prompts.add(update);
          return AndroidUpdatePromptAction.install;
        },
      );

      await coordinator.onForeground();
      expect(
        prompts,
        isEmpty,
        reason: 'download must not interrupt this foreground',
      );
      expect(installer.paths, isEmpty);

      await coordinator.onForeground();
      expect(prompts, hasLength(1));
      expect(installer.paths, [prompts.single.apkPath]);
    },
  );

  test(
    '[MOB-UPD-006][flutter] state switch succeeds before the older APK is removed',
    () async {
      final oldBytes = utf8.encode('old verified apk');
      final newBytes = utf8.encode('new verified apk');
      final oldFile = File('${temporaryDirectory.path}/relayune-8.apk');
      await oldFile.writeAsBytes(oldBytes);
      final store = _MemoryStateStore(
        AndroidUpdateState(
          verifiedUpdate: VerifiedAndroidUpdate(
            manifest: _manifest(bytes: oldBytes, versionCode: 8),
            apkPath: oldFile.path,
          ),
        ),
      );
      final repository = AndroidUpdateRepository(
        stateStore: store,
        downloadDirectory: temporaryDirectory,
        client: _clientFor(newBytes, versionCode: 9),
      );

      final downloaded = await repository.checkAndDownload(7);

      expect(store.writes.last.verifiedUpdate?.apkPath, downloaded?.apkPath);
      expect(store.writes.last.verifiedUpdate?.manifest.versionCode, 9);
      expect(await File(downloaded!.apkPath).exists(), isTrue);
      expect(await oldFile.exists(), isFalse);
    },
  );

  test(
    '[MOB-UPD-007][flutter] coordinator disposal closes its persistent HTTP client',
    () {
      final client = _TrackingClient(_clientFor(utf8.encode('verified apk')));
      final repository = AndroidUpdateRepository(
        stateStore: _MemoryStateStore(),
        downloadDirectory: temporaryDirectory,
        client: client,
      );
      final coordinator = AndroidAutoUpdateCoordinator(
        repository: repository,
        installer: _FakeInstaller(),
        currentVersionCode: 7,
        prompt: (_) async => AndroidUpdatePromptAction.later,
      );

      coordinator.dispose();

      expect(client.closed, isTrue);
    },
  );

  test(
    '[MOB-UPD-008][flutter] native installer applies fail-closed APK identity gates',
    () async {
      final source = await File(
        'android/app/src/main/kotlin/cn/giraffetree/relayune/MainActivity.kt',
      ).readAsString();

      expect(source, contains('archive.packageName != packageName'));
      expect(
        source,
        contains('longVersionCode(archive) <= longVersionCode(installed)'),
      );
      expect(source, contains('archiveSigners != installedSigners'));
      expect(source, contains('MessageDigest.getInstance("SHA-256")'));
      expect(source, contains('FileProvider.getUriForFile'));
      expect(source, contains('packageManager.canRequestPackageInstalls()'));
      expect(
        RegExp(
          r'validationError = validateArchive\(pending\.first\)',
        ).hasMatch(source),
        isTrue,
      );
    },
  );
}

http.Client _clientFor(List<int> bytes, {int versionCode = 8}) => MockClient((
  request,
) async {
  if (request.url.path.endsWith('android.json')) {
    return _jsonResponse(_manifestJson(bytes: bytes, versionCode: versionCode));
  }
  return http.Response.bytes(bytes, 200);
});

http.Response _jsonResponse(Map<String, dynamic> value) =>
    http.Response.bytes(utf8.encode(jsonEncode(value)), 200);

AndroidUpdateManifest _manifest({
  required List<int> bytes,
  int versionCode = 8,
}) => AndroidUpdateManifest.fromJson(
  _manifestJson(bytes: bytes, versionCode: versionCode),
);

Map<String, dynamic> _manifestJson({
  required List<int> bytes,
  int versionCode = 8,
}) => {
  'version_name': '0.2.$versionCode',
  'version_code': versionCode,
  'url':
      'https://open-chen.oss-cn-hangzhou.aliyuncs.com/apps/relayune/0.2.$versionCode/Relayune-0.2.$versionCode-Android.apk',
  'sha256': sha256.convert(bytes).toString(),
  'size': bytes.length,
  'published_at': '2026-08-11T10:00:00Z',
  'notes': {'zh-CN': '改进自动更新。', 'en': 'Improved automatic updates.'},
};

class _MemoryStateStore implements AndroidUpdateStateStore {
  _MemoryStateStore([this.state = const AndroidUpdateState()]);

  AndroidUpdateState state;
  final List<AndroidUpdateState> writes = [];

  @override
  Future<AndroidUpdateState> read() async => state;

  @override
  Future<void> write(AndroidUpdateState state) async {
    this.state = state;
    writes.add(state);
  }
}

class _FakeInstaller implements AndroidUpdateInstaller {
  final List<String> paths = [];

  @override
  Future<void> install(String apkPath) async => paths.add(apkPath);
}

class _TrackingClient extends http.BaseClient {
  _TrackingClient(this.delegate);

  final http.Client delegate;
  bool closed = false;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) =>
      delegate.send(request);

  @override
  void close() {
    closed = true;
    delegate.close();
  }
}
