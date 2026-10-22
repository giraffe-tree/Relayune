import 'package:flutter_test/flutter_test.dart';
import 'package:relayune_mobile/src/device/authorization_name.dart';

void main() {
  test(
    'formats an iPhone marketing model without a stable device identifier',
    () {
      expect(
        formatIosAuthorizationName(
          machine: 'iPhone16,1',
          deviceClass: 'iPhone',
          systemVersion: '18.6.1',
        ),
        'Relayune · iPhone 15 Pro · iOS 18.6',
      );
    },
  );

  test('falls back to the Apple device class for an unknown future model', () {
    expect(
      formatIosAuthorizationName(
        machine: 'iPhone99,1',
        deviceClass: 'iPhone',
        systemVersion: '20.0',
      ),
      'Relayune · iPhone · iOS 20.0',
    );
  });

  test('formats Android manufacturer, model and coarse OS version', () {
    expect(
      formatAndroidAuthorizationName(
        manufacturer: 'Google',
        model: 'Pixel 9 Pro',
        systemVersion: '16.0.1',
      ),
      'Relayune · Google Pixel 9 Pro · Android 16.0',
    );
  });

  test('does not duplicate a manufacturer already present in the model', () {
    expect(
      formatAndroidAuthorizationName(
        manufacturer: 'Samsung',
        model: 'Samsung Galaxy S25',
        systemVersion: '15',
      ),
      'Relayune · Samsung Galaxy S25 · Android 15',
    );
  });

  test('bounds custom Android build labels below the server name limit', () {
    final name = formatAndroidAuthorizationName(
      manufacturer: List.filled(80, '📱').join(),
      model: List.filled(40, 'Model').join(),
      systemVersion: '16.0.1',
    );

    expect(name.length, lessThanOrEqualTo(110));
    expect(name, startsWith('Relayune ·'));
  });
}
