import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/local_web_gateway.dart';
import 'package:relayune_mobile/src/network/local_web_progress.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';

void main() {
  test(
    'resource observations keep bytes, status, query privacy and navigation ownership',
    () async {
      final observed = <LocalWebResourceProgress>[];
      final gate = Completer<void>();
      final requested = Completer<void>();
      final gateway = await LocalWebGateway.start(
        Uri.parse('http://localhost:8766/'),
        'preview',
        (payload, {onProgress}) async {
          requested.complete();
          onProgress?.call(const DownloadProgress(30, 100));
          await gate.future;
          onProgress?.call(const DownloadProgress(100, 100));
          return {
            'status': 404,
            'headers': {'content-type': 'text/css'},
            'base64': base64Encode(utf8.encode('not found')),
          };
        },
        onResourceProgress: observed.add,
      );
      final client = HttpClient();
      addTearDown(() async {
        client.close(force: true);
        await gateway.close();
      });
      final bootstrap = await client.getUrl(gateway.entry)
        ..followRedirects = false;
      final bootstrapResponse = await bootstrap.close();
      final cookie = bootstrapResponse.cookies.single;
      await bootstrapResponse.drain<void>();
      expect(observed, isEmpty); // Never report the private capability URL.
      gateway.beginNavigation();
      final request = await client.getUrl(
        gateway.origin.resolve('/missing.css?token=private'),
      );
      request.cookies.add(cookie);
      final responseFuture = request.close();
      await requested.future;
      expect(observed.first.phase, LocalWebResourcePhase.waiting);
      expect(observed.last.fraction, .3);
      expect(observed.every((item) => item.path == '/missing.css'), isTrue);
      gateway.beginNavigation();
      gate.complete();
      final response = await responseFuture;
      await response.drain<void>();
      await Future<void>.delayed(Duration.zero);
      expect(response.statusCode, 404);
      expect(observed.last.phase, LocalWebResourcePhase.failed);
      expect(observed.last.statusCode, 404);
      expect(observed.every((item) => item.epoch == 1), isTrue);
    },
  );

  test(
    'a failing progress observer cannot break or repeat the request',
    () async {
      var calls = 0;
      final gateway = await LocalWebGateway.start(
        Uri.parse('http://localhost:8766/'),
        'preview',
        (_, {onProgress}) async {
          calls++;
          onProgress?.call(const DownloadProgress(1, null));
          return {
            'status': 200,
            'headers': {'content-type': 'text/plain'},
            'base64': base64Encode(utf8.encode('OK')),
          };
        },
        onResourceProgress: (_) => throw StateError('UI observer'),
      );
      final client = HttpClient();
      addTearDown(() async {
        client.close(force: true);
        await gateway.close();
      });
      final bootstrap = await client.getUrl(gateway.entry)
        ..followRedirects = false;
      final response = await bootstrap.close();
      final cookie = response.cookies.single;
      await response.drain<void>();
      final request = await client.postUrl(gateway.origin.resolve('/save'));
      request.cookies.add(cookie);
      request.write('once');
      final result = await request.close();
      expect(await utf8.decoder.bind(result).join(), 'OK');
      expect(calls, 1);
    },
  );

  test(
    'compatibility assets are private, local and keep the early HTML charset',
    () async {
      var upstreamCalls = 0;
      var fontLoads = 0;
      final gateway = await LocalWebGateway.start(
        Uri.parse('http://localhost:8766/'),
        'preview',
        (_, {onProgress}) async {
          upstreamCalls++;
          return {
            'status': 200,
            'headers': {'content-type': 'text/html'},
            'base64': base64Encode(
              utf8.encode(
                '<!doctype html><html><head><meta charset="utf-8"></head><body>中文</body></html>',
              ),
            ),
          };
        },
        compatibilityScript: '/* bundled script */',
        loadCompatibilityFont: () async {
          fontLoads++;
          return Uint8List.fromList([119, 79, 70, 50]);
        },
      );
      final client = HttpClient();
      addTearDown(() async {
        client.close(force: true);
        await gateway.close();
      });
      final font = gateway.origin.resolve('/_relayune/compat/cjk.woff2');
      final unauthorized = await client.getUrl(font);
      final denied = await unauthorized.close();
      expect(denied.statusCode, 502);
      await denied.drain<void>();
      expect(fontLoads, 0);
      final bootstrap = await client.getUrl(gateway.entry)
        ..followRedirects = false;
      final boot = await bootstrap.close();
      final cookie = boot.cookies.single;
      await boot.drain<void>();
      final page = await client.getUrl(gateway.origin)
        ..cookies.add(cookie);
      final html = await utf8.decoder.bind(await page.close()).join();
      expect(
        html,
        contains(
          '<script defer src="/_relayune/compat/font-fallback.js"></script>',
        ),
      );
      expect(html.indexOf('<meta charset'), lessThan(1024));
      expect(html, contains('中文'));
      final script =
          await client.getUrl(
              gateway.origin.resolve('/_relayune/compat/font-fallback.js'),
            )
            ..cookies.add(cookie);
      expect(
        await utf8.decoder.bind(await script.close()).join(),
        '/* bundled script */',
      );
      final get = await client.getUrl(font)
        ..cookies.add(cookie);
      final response = await get.close();
      expect(response.headers.contentType?.mimeType, 'font/woff2');
      expect(await response.fold<List<int>>([], (a, b) => a..addAll(b)), [
        119,
        79,
        70,
        50,
      ]);
      final post = await client.postUrl(font)
        ..cookies.add(cookie);
      final blocked = await post.close();
      expect(blocked.statusCode, 502);
      await blocked.drain<void>();
      expect(fontLoads, 1);
      expect(upstreamCalls, 1);
    },
  );

  test(
    'recognizes only explicit local web addresses and preserves fragments',
    () {
      expect(localWebUri('http://127.0.0.1:8766/#auth')?.fragment, 'auth');
      for (final url in [
        'http://127.1:8766',
        'http://localhost:80',
        'http://user@localhost:8766',
        'file:///tmp/a',
        'https://example.com:8766',
      ]) {
        expect(localWebUri(url), isNull, reason: url);
      }
    },
  );

  test(
    '[MOB-ATT-012][flutter] private renderer forwards pages, images, API bodies and preview-only cookies',
    () async {
      final calls = <Map<String, dynamic>>[];
      final gateway = await LocalWebGateway.start(
        Uri.parse('http://127.0.0.1:8766/#auth'),
        'preview',
        (payload, {onProgress}) async {
          calls.add(payload);
          return {
            'status': 200,
            'headers': {
              'content-type': payload['path'] == '/'
                  ? 'text/html'
                  : 'application/json',
              if (payload['path'] == '/')
                'set-cookie': ['login=isolated; HttpOnly; Path=/'],
            },
            'base64': base64Encode(
              utf8.encode(
                payload['path'] == '/'
                    ? '<img src="http://127.0.0.1:8766/image.png"><a href="sources/code.html">Code</a>'
                    : '{"ok":true}',
              ),
            ),
          };
        },
      );
      final client = HttpClient();
      addTearDown(() async {
        client.close(force: true);
        await gateway.close();
      });
      final bootstrap = await client.getUrl(gateway.entry);
      bootstrap.followRedirects = false;
      final bootstrapResponse = await bootstrap.close();
      expect(bootstrapResponse.statusCode, 303);
      expect(bootstrapResponse.headers.value('location'), '/#auth');
      final cookie = bootstrapResponse.cookies.single;
      expect(cookie.httpOnly, isTrue);
      expect(
        bootstrapResponse.headers.value('set-cookie'),
        contains('SameSite=Strict'),
      );
      await bootstrapResponse.drain<void>();

      final get = await client.getUrl(gateway.origin);
      get.cookies.add(cookie);
      final response = await get.close();
      expect(response.statusCode, 200);
      expect(
        response.headers.value('content-security-policy'),
        contains("connect-src 'self'"),
      );
      expect(response.headers.value('set-cookie'), isNull);
      expect(response.headers.value('referrer-policy'), 'same-origin');
      final html = await utf8.decoder.bind(response).join();
      expect(html, contains('${gateway.origin}/image.png'));
      expect(html, contains('sources/code.html'));
      expect((calls.first['headers'] as Map).containsKey('cookie'), isFalse);

      final post = await client.postUrl(gateway.origin.resolve('/api/save'));
      post.cookies.add(cookie);
      post.headers.set('origin', gateway.origin.origin);
      post.headers.contentType = ContentType.json;
      post.write('{"text":"你好"}');
      final postResponse = await post.close();
      expect(postResponse.statusCode, 200);
      expect(await utf8.decoder.bind(postResponse).join(), '{"ok":true}');
      expect(calls.last['method'], 'POST');
      expect(
        utf8.decode(base64Decode(calls.last['base64'] as String)),
        '{"text":"你好"}',
      );
      expect((calls.last['headers'] as Map)['origin'], 'http://127.0.0.1:8766');
      expect((calls.last['headers'] as Map)['cookie'], 'login=isolated');
      expect(jsonEncode(calls).contains(cookie.value), isFalse);

      final form = await client.postUrl(gateway.origin.resolve('/submit'));
      form.cookies.add(cookie);
      form.headers.set('origin', gateway.origin.origin);
      form.headers.set('referer', gateway.origin.resolve('/form').toString());
      form.headers.contentType = ContentType(
        'application',
        'x-www-form-urlencoded',
        charset: 'utf-8',
      );
      final formBody = 'note=${Uri.encodeQueryComponent('中文表单验收')}';
      form.write(formBody);
      expect((await form.close()).statusCode, 200);
      expect(
        utf8.decode(base64Decode(calls.last['base64'] as String)),
        formBody,
      );
      expect((calls.last['headers'] as Map)['origin'], gateway.upstream.origin);
      expect((calls.last['headers'] as Map).containsKey('referer'), isFalse);
    },
  );

  test(
    'unauthenticated, cross-origin and oversized requests never reach the desktop',
    () async {
      var calls = 0;
      final gateway = await LocalWebGateway.start(
        Uri.parse('http://localhost:8766/'),
        'preview',
        (_, {onProgress}) async {
          calls++;
          throw StateError('must not reach');
        },
      );
      final client = HttpClient();
      addTearDown(() async {
        client.close(force: true);
        await gateway.close();
      });
      final unauthorized = await client.getUrl(
        gateway.origin.resolve('/api/delete'),
      );
      expect((await unauthorized.close()).statusCode, 502);
      final bootstrap = await client.getUrl(gateway.entry)
        ..followRedirects = false;
      final response = await bootstrap.close();
      final cookie = response.cookies.single;
      await response.drain<void>();
      final cross = await client.postUrl(gateway.origin.resolve('/api/delete'));
      cross.cookies.add(cookie);
      cross.headers.set('origin', 'https://evil.test');
      expect((await cross.close()).statusCode, 502);
      final opaque = await client.postUrl(
        gateway.origin.resolve('/api/delete'),
      );
      opaque.cookies.add(cookie);
      opaque.headers.set('origin', 'null');
      expect((await opaque.close()).statusCode, 502);
      final large = await client.postUrl(gateway.origin.resolve('/api/save'));
      large.cookies.add(cookie);
      large.add(List.filled(LocalWebGateway.maxRequestBytes + 1, 1));
      expect((await large.close()).statusCode, 502);
      expect(calls, 0);
      expect(gateway.navigation(Uri.parse('https://evil.test/')), isNull);
      expect(gateway.navigation(Uri.parse('http://localhost:8767/')), isNull);
      expect(
        gateway
            .navigation(Uri.parse('http://localhost:8766/sources/a.html#L1'))
            .toString(),
        '${gateway.origin}/sources/a.html#L1',
      );
      await gateway.close();
      expect(gateway.allows(gateway.origin), isFalse);
    },
  );

  test('transport errors do not repeat a form submission', () async {
    var calls = 0;
    final gateway = await LocalWebGateway.start(
      Uri.parse('http://localhost:8766/'),
      'preview',
      (_, {onProgress}) async {
        calls++;
        throw const SocketException('private socket details');
      },
    );
    final client = HttpClient();
    addTearDown(() async {
      client.close(force: true);
      await gateway.close();
    });
    final bootstrap = await client.getUrl(gateway.entry)
      ..followRedirects = false;
    final response = await bootstrap.close();
    final cookie = response.cookies.single;
    await response.drain<void>();
    final post = await client.postUrl(gateway.origin.resolve('/save'));
    post.cookies.add(cookie);
    post.write('name=hello');
    final failed = await post.close();
    final message = await utf8.decoder.bind(failed).join();
    expect(calls, 1);
    expect(failed.statusCode, 502);
    expect(message, contains('check its result'));
    expect(message, isNot(contains('private socket')));
  });
}
