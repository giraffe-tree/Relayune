import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestMethod, routeTemplate } from '../shared/request-log.mjs';
import routes from '../shared/request-log-routes.json' with { type: 'json' };

test('all known log labels survive a second collector normalization', () => {
  assert.equal(new Set(routes.map(r => r.template)).size, routes.length);
  for (const route of routes) {
    assert.ok(route.pattern.startsWith('^/'));
    assert.ok(route.pattern.endsWith('$'));
    assert.equal(routeTemplate(route.template), route.template);
    const sample = route.template.replace(':device_id', 'dev_sample').replace(':request_id',
      route.template.startsWith('/api/desktop-login') ? 'dlogin_sample' : 'req_sample')
      .replace(':pairing_id', 'pair_sample').replace(':browser_id', 'web_abcd');
    assert.equal(routeTemplate(sample), route.template);
  }
});

test('dynamic routes and query secrets never appear in logged labels', () => {
  for (const [url, expected] of [
    ['/api/relay/devices/dev_private/ios-push', '/api/relay/devices/:device_id/ios-push'],
    ['/api/relay/pairings/pair_private/cancel', '/api/relay/pairings/:pairing_id/cancel'],
    ['/api/responses/secret?token=private', '/api/responses/:request_id'],
    ['/api/desktop-login/dlogin_private/approval', '/api/desktop-login/:request_id/approval'],
    ['/api/auth/verify?token=private', '/api/auth/verify'],
    ['/api/browser/pairings/pair_private/respond', '/api/browser/pairings/:pairing_id/respond'],
    ['/api/relay/devices/dev_private/events', '/api/relay/devices/:device_id/events'],
  ]) assert.equal(routeTemplate(url), expected);
});

test('unknown or hostile paths/methods collapse into fixed labels', () => {
  for (const value of [null, {}, undefined, '/private-email@example.com', '/api/auth/token-private',
    'https://example.com/api/events', '/api/relay/devices/private/unknown', '/'.repeat(5000)]) {
    assert.equal(routeTemplate(value), 'unmatched');
  }
  for (const method of [null, 'private-token', 'get', {}, 'GET\nsecret']) {
    assert.equal(requestMethod(method), 'UNKNOWN');
  }
  assert.equal(requestMethod('GET'), 'GET');
});

test('every literal API path in handlers has a safe route entry', () => {
  const files = ['email-auth.ts', 'pairing-api.ts',
    'relay-api.ts', 'feedback-api.ts'];
  for (const file of files) {
    const source = readFileSync(new URL('../server/' + file, import.meta.url), 'utf8');
    for (const [, path] of source.matchAll(/["'](\/api\/[a-z-]+(?:\/[a-z-]+)*)["']/g)) {
      // Prefixes used for route dispatch are not callable endpoints.
      if (['/api/relay'].includes(path)) continue;
      assert.notEqual(routeTemplate(path), 'unmatched', path);
    }
  }
});
