import 'dart:io';
import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/network/instance_endpoint.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = null;
  late Directory tmp;
  late HttpServer server;
  late String pem, origin;
  late String ecPem;
  var arrivals = 0;
  Completer<void>? stalledHandshake;
  setUpAll(() async {
    tmp = await Directory.systemTemp.createTemp('relayune-tls-test-');
    Future<void> openssl(List<String> args) async {
      final result = await Process.run('openssl', args);
      if (result.exitCode != 0) {
        throw StateError('Isolated TLS fixture generation failed');
      }
    }

    await openssl([
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      '${tmp.path}/ca-key.pem',
      '-out',
      '${tmp.path}/ca.pem',
      '-days',
      '1',
      '-subj',
      '/CN=Relayune synthetic CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
    await openssl([
      'req',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      '${tmp.path}/key.pem',
      '-out',
      '${tmp.path}/leaf.csr',
      '-subj',
      '/CN=Relayune synthetic server',
    ]);
    await File('${tmp.path}/extensions').writeAsString(
      'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n',
    );
    await openssl([
      'x509',
      '-req',
      '-in',
      '${tmp.path}/leaf.csr',
      '-CA',
      '${tmp.path}/ca.pem',
      '-CAkey',
      '${tmp.path}/ca-key.pem',
      '-CAcreateserial',
      '-out',
      '${tmp.path}/leaf.pem',
      '-days',
      '1',
      '-extfile',
      '${tmp.path}/extensions',
    ]);
    pem = await File('${tmp.path}/ca.pem').readAsString();
    await openssl([
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      '${tmp.path}/ec-ca-key.pem',
      '-out',
      '${tmp.path}/ec-ca.pem',
      '-days',
      '1',
      '-subj',
      '/CN=Relayune synthetic EC CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-addext',
      'keyUsage=critical,keyCertSign,cRLSign',
    ]);
    ecPem = await File('${tmp.path}/ec-ca.pem').readAsString();
    final context = SecurityContext()
      ..useCertificateChain('${tmp.path}/leaf.pem')
      ..usePrivateKey('${tmp.path}/key.pem');
    server = await HttpServer.bindSecure(
      InternetAddress.loopbackIPv4,
      0,
      context,
    );
    origin = 'https://127.0.0.1:${server.port}';
    server.listen((request) async {
      if (request.uri.path == '/hang') {
        stalledHandshake?.complete();
        return;
      }
      if (request.uri.path == '/socket') {
        final socket = await WebSocketTransformer.upgrade(request);
        socket.listen(socket.add);
        return;
      }
      if (request.uri.path == '/arrived') {
        arrivals++;
        request.response.statusCode = 400;
      } else if (request.uri.path == '/api/stream' ||
          request.uri.path == '/api/auth/email-status') {
        request.response.statusCode = 307;
        request.response.headers.set('location', '$origin/arrived');
      } else {
        request.response.write(
          '{"schema_version":1,"auth_mode":"username","setup_required":false}',
        );
      }
      await request.response.close();
    });
  });
  tearDownAll(() async {
    await server.close(force: true);
    await tmp.delete(recursive: true);
  });
  test(
    'scoped public CA enables valid TLS without changing global trust',
    () async {
      expect(certificateFingerprint(pem), matches(RegExp(r'^[A-F0-9]{64}$')));
      final api = RelayApi(origin: origin, certificatePem: pem);
      expect((await api.discoverInstance()).usernameMode, isTrue);
      api.close();
      final untrusted = RelayApi(origin: origin, certificatePem: '');
      await expectLater(untrusted.discoverInstance(), throwsA(anything));
      untrusted.close();
    },
  );
  test(
    'CA import preserves hostname checking and rejects bundles/private keys',
    () async {
      final wrong = RelayApi(
        origin: 'https://localhost:${server.port}',
        certificatePem: pem,
      );
      await expectLater(wrong.discoverInstance(), throwsA(anything));
      wrong.close();
      expect(() => certificateFingerprint('$pem\n$pem'), throwsFormatException);
      expect(
        () => certificateFingerprint(
          '-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----',
        ),
        throwsFormatException,
      );
    },
  );
  test('installer EC CA imports while malformed public certificates fail', () {
    expect(certificateFingerprint(ecPem), matches(RegExp(r'^[A-F0-9]{64}$')));
    instanceIoClient(ecPem).close(force: true);
    const malformed =
        '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----';
    expect(() => certificateFingerprint(malformed), throwsA(isA<TlsException>()));
    expect(() => instanceIoClient(malformed), throwsA(isA<TlsException>()));
  });
  test('HTTP and WSS never follow credential-bearing redirects', () async {
    arrivals = 0;
    final api = RelayApi(origin: origin, certificatePem: pem)
      ..sessionToken = 'synthetic-session'
      ..browserToken = 'synthetic-browser';
    await expectLater(
      api.emailStatus('test@example.invalid'),
      throwsA(isA<RelayApiException>()),
    );
    await expectLater(
      api.connectSocket('wss://127.0.0.1:${server.port}/api/stream', {
        'Cookie': 'synthetic',
      }),
      throwsA(anything),
    );
    expect(arrivals, 0);
    api.close();
  });
  test('closing an old API cancels its in-flight WSS handshake', () async {
    stalledHandshake = Completer<void>();
    final api = RelayApi(origin: origin, certificatePem: pem);
    final connection = api.connectSocket(
      'wss://127.0.0.1:${server.port}/hang',
      {},
    );
    final refused = expectLater(connection, throwsA(anything));
    await stalledHandshake!.future.timeout(const Duration(seconds: 5));
    api.close();
    await refused.timeout(const Duration(seconds: 2));
    stalledHandshake = null;
  });
  test(
    'WSS shares selected CA and rejects another origin before connecting',
    () async {
      final socket = await connectInstanceSocket(
        origin,
        pem,
        'wss://127.0.0.1:${server.port}/socket',
        {},
      );
      socket.add('synthetic');
      expect(await socket.first, 'synthetic');
      await socket.close();
      await expectLater(
        connectInstanceSocket(origin, pem, 'wss://example.invalid/socket', {}),
        throwsFormatException,
      );
    },
  );
}
