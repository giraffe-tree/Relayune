import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { installFatalDiagnostics, fatalCategory } from '../relay/fatal-diagnostics.mjs';

test('fatal monitor emits only fixed categories and never raw errors', () => {
  const target = new EventEmitter(); const lines = [];
  const dispose = installFatalDiagnostics(target, line => lines.push(line));
  target.emit('uncaughtExceptionMonitor', { message: 'CANARY token path conversation', cause: { code: 'ECONNRESET' } }, 'unhandledRejection');
  assert.deepEqual(lines, ['relayune:fatal:unhandled_rejection\n', 'relayune:fatal:network\n']);
  dispose(); assert.equal(target.listenerCount('uncaughtExceptionMonitor'), 0);
  assert.equal(fatalCategory({ get code() { throw Error('CANARY'); } }), 'unknown');
});

test('monitor preserves process termination on actual unhandled rejection', () => {
  const moduleUrl = new URL('../relay/fatal-diagnostics.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {installFatalDiagnostics} from ${JSON.stringify(moduleUrl)}; installFatalDiagnostics(); Promise.reject(Object.assign(new Error('synthetic'), {code:'ENOSPC'}));`], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /relayune:fatal:unhandled_rejection/);
  assert.match(result.stderr, /relayune:fatal:disk_full/);
});
