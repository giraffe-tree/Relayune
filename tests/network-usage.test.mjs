import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { createNetworkUsage } from '../server/network-usage.mjs';

test('HTTP counts actual UTF8 chunk bytes once, preserves response and suppresses HEAD body', async () => {
  const records = [];
  const usage = createNetworkUsage({ intervalMs: 0, write: record => records.push(record) });
  const server = createServer(async (req, res) => {
    usage.observeHttp(req, res);
    for await (const chunk of req) usage.receiveHttp(req, chunk);
    res.write('中文');
    res.end(Buffer.from('output'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/responses/SECRET?token=SECRET`;
    assert.equal(await (await fetch(url, { method: 'POST', body: '你好' })).text(), '中文output');
    assert.equal(await (await fetch(url, { method: 'HEAD' })).text(), '');
    usage.flush();
    const post = records.find(x => x.request_method === 'POST');
    assert.equal(post.rx_payload_bytes, 6);
    assert.equal(post.tx_payload_bytes, 12);
    assert.equal(post.units, 1);
    assert.equal(post.aborted, 0);
    assert.equal(records.find(x => x.request_method === 'HEAD').tx_payload_bytes, 0);
    assert.doesNotMatch(JSON.stringify(records), /SECRET|中文|你好|output/);
    assert.equal(post.request_uri, '/api/responses/:request_id');
    const count = records.length;
    usage.flush();
    assert.equal(records.length, count);
  } finally { usage.close(); await new Promise(resolve => server.close(resolve)); }
});

test('early close is counted once and backpressure does not discard accepted bytes', () => {
  const records = [];
  const usage = createNetworkUsage({ intervalMs: 0, write: x => records.push(x) });
  const response = Object.assign(new EventEmitter(), { statusCode: 200, writableFinished: false,
    write: () => false, end: () => response });
  usage.observeHttp({ method: 'GET', url: '/api/events' }, response);
  assert.equal(response.write(Buffer.alloc(25)), false);
  response.emit('close'); response.emit('finish');
  usage.flush();
  assert.equal(records[0].tx_payload_bytes, 25);
  assert.equal(records[0].units, 1);
  assert.equal(records[0].aborted, 1);
});

test('websocket aggregates before disconnect, bounds dimensions, and logging errors stay isolated', () => {
  const records = [];
  const usage = createNetworkUsage({ intervalMs: 0, write: x => records.push(x) });
  usage.websocket('tx', 'invalidate', 140);
  usage.websocket('tx', 'invalidate', 150);
  usage.websocket('rx', 'SECRET', 100);
  usage.websocket('tx', 'ping', 0);
  usage.flush();
  assert.equal(records.find(x => x.message_kind === 'invalidate').tx_payload_bytes, 290);
  assert.equal(records.find(x => x.message_kind === 'invalidate').units, 2);
  assert.equal(records.find(x => x.message_kind === 'ping').units, 1);
  assert.doesNotMatch(JSON.stringify(records), /SECRET/);
  const broken = createNetworkUsage({ intervalMs: 0, write: () => { throw Error('sink failed'); } });
  broken.websocket('tx', 'ready', 50);
  assert.doesNotThrow(() => broken.close());
});
