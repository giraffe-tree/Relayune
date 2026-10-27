import assert from 'node:assert/strict';
import test from 'node:test';
import { canContinueCodexTurn } from '../relay/codex-continuation.mjs';

test('interrupted is resumable; unfinished and successful turns are not', () => {
  assert.equal(canContinueCodexTurn({ status: 'interrupted' }), true);
  for (const turn of [undefined, {}, { status: 'completed' }, { status: 'inProgress' },
    { status: 'failed' }, { status: 'failed', error: { message: 'network error' } }])
    assert.equal(canContinueCodexTurn(turn), false);
});

for (const codexErrorInfo of ['serverOverloaded', 'internalServerError',
  { httpConnectionFailed: { httpStatusCode: null } },
  { responseStreamConnectionFailed: {} }, { responseStreamDisconnected: {} },
  { responseTooManyFailedAttempts: {} }]) {
  test(`native transient classification permits continuation: ${JSON.stringify(codexErrorInfo)}`, () => {
    assert.equal(canContinueCodexTurn({ status: 'failed', error: { codexErrorInfo, message: 'temporary error' } }), true);
  });
}

for (const message of ['The model is temporarily unavailable. Please retry.',
  "stream disconnected before completion: we're currently processing too many requests",
  'stream disconnected before completion: we’re currently processing too many requests. Try again.']) {
  test(`native other-classification permits only the recognized temporary condition: ${message}`, () => {
    assert.equal(canContinueCodexTurn({ status: 'failed', error: { codexErrorInfo: 'other', message } }), true);
    assert.equal(canContinueCodexTurn({ status: 'failed', error: { message } }), false);
    assert.equal(canContinueCodexTurn({ status: 'failed', error: { codexErrorInfo: 'usageLimitExceeded', message } }), false);
  });
}

for (const qualifier of ['usage', 'quota', 'rate limit', 'rate-limits', 'rate_limit', 'billing', 'credit', 'credits']) {
  test(`account limit is not a transient other error: ${qualifier}`, () => {
    assert.equal(canContinueCodexTurn({ status: 'failed', error: {
      codexErrorInfo: 'other', message: `Model is temporarily unavailable due to ${qualifier}.`,
    } }), false);
  });
}

test('unrecognized failure kinds and messages cannot enable a generic retry', () => {
  for (const error of [{ codexErrorInfo: 'other', message: 'Network failed' },
    { codexErrorInfo: 'other', message: 'usage limit exceeded' },
    { codexErrorInfo: { httpStatusCode: 429 }, message: 'Server overloaded' },
    { codexErrorInfo: 'server_overloaded', message: 'Server overloaded' },
    { codexErrorInfo: ['httpConnectionFailed'], message: 'Network failed' }]) {
    assert.equal(canContinueCodexTurn({ status: 'failed', error }), false);
  }
});
