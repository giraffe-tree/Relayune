import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:relayune_mobile/l10n/relayune_localizations.dart';
import 'package:relayune_mobile/src/network/relay_api.dart';
import 'package:relayune_mobile/src/state/app_controller.dart';
import 'package:relayune_mobile/src/ui/instance_settings_page.dart';

void main() {
  for (final teardownPopsPage in [true, false]) {
    testWidgets(
      'switch preserves login root when teardown ${teardownPopsPage ? 'already pops' : 'keeps'} picker',
      (tester) async {
        tester.view.physicalSize = const Size(1200, 2000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final navigator = GlobalKey<NavigatorState>();
        final controller = AppController();
        addTearDown(controller.dispose);
        var switched = false;
        controller.changeInstance = (origin, certificatePem) async {
          switched = true;
          if (teardownPopsPage) {
            navigator.currentState!.popUntil((route) => route.isFirst);
          }
        };
        await tester.pumpWidget(
          MaterialApp(
            navigatorKey: navigator,
            locale: const Locale('en'),
            supportedLocales: relayuneSupportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            home: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => InstanceSettingsPage(
                        controller: controller,
                        probeFactory: (origin, certificatePem) => RelayApi(
                          origin: origin,
                          certificatePem: certificatePem,
                          client: MockClient((request) async {
                            expect(request.url.path, '/api/instance');
                            expect(request.headers['Cookie'], isNull);
                            expect(
                              request.headers['X-Relay-Browser-Token'],
                              isNull,
                            );
                            return http.Response(
                              '{"schema_version":1,"auth_mode":"username","setup_required":false}',
                              200,
                            );
                          }),
                        ),
                      ),
                    ),
                  ),
                  child: const Text('Login root'),
                ),
              ),
            ),
          ),
        );
        await tester.tap(find.text('Login root'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Check connection and switch'));
        await tester.tap(find.text('Check connection and switch'));
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        expect(find.text('Connect to this server?'), findsOneWidget);
        await tester.tap(find.text('Confirm'));
        await tester.pumpAndSettle();
        expect(switched, isTrue);
        expect(find.text('Login root'), findsOneWidget);
        expect(find.byType(InstanceSettingsPage), findsNothing);
        expect(navigator.currentState!.canPop(), isFalse);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
