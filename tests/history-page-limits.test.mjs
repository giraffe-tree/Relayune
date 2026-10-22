import assert from 'node:assert/strict';
import test from 'node:test';
import { MockCodexAdapter } from '../relay/codex-adapters.mjs';
import { ClaudeCodeAdapter } from '../relay/claude-adapter.mjs';
import { ClaudeCoworkAdapter } from '../relay/claude-cowork-adapter.mjs';
import { KimiCodeAdapter } from '../relay/kimi-adapter.mjs';
import { MCodeAdapter } from '../relay/mcode-adapter.mjs';
import { OpenCodeAdapter } from '../relay/opencode-adapter.mjs';
import { paginatePiHistory } from '../relay/pi-history.mjs';
import { ZCodeAdapter, zcodeHistory } from '../relay/zcode-adapter.mjs';

const messages = Array.from({ length: 1123 }, (_, index) => ({
  id: `message-${index}`, role: index % 2 ? 'codex' : 'user',
  content: `中文 message ${index}`, created_at: new Date(1_700_000_000_000 + index).toISOString(),
}));
const sessionId = 'fixture';
const noSpawn = () => { throw new Error('History pagination must not start an agent.'); };

const factories = [
  ['Codex', () => new MockCodexAdapter({ historyMessages: messages })],
  ...[['Claude', ClaudeCodeAdapter], ['Cowork', ClaudeCoworkAdapter]].map(([name, Adapter]) => [name, () => {
    const adapter = new Adapter({ historyReader: async () => ({ messages }), spawnProcess: noSpawn });
    adapter.rememberSession({ sessionId, cwd: '/fixture', transcriptPath: '/fixture/history.jsonl' });
    adapter.loadModels = async () => [];
    adapter.loadPermissionModes = async () => [];
    return adapter;
  }]),
  ...[['Kimi', KimiCodeAdapter], ['MCode', MCodeAdapter], ['OpenCode', OpenCodeAdapter]].map(([name, Adapter]) => [name, () => {
    const adapter = new Adapter({ historyReader: async () => ({ messages }), spawnProcess: noSpawn });
    adapter.rememberSession({ sessionId, cwd: '/fixture' });
    return adapter;
  }]),
  ['Pi', () => ({ readHistory: options => paginatePiHistory(messages, options) })],
  ['ZCode', () => {
    const native = messages.map((message, index) => ({
      info: { messageId: message.id, role: index % 2 ? 'assistant' : 'user', time: { created: message.created_at } },
      parts: [{ type: 'text', text: message.content }],
    }));
    const adapter = new ZCodeAdapter({ spawnProcess: noSpawn });
    adapter.ensureLoaded = async () => {};
    adapter.request = async method => {
      assert.equal(method, 'session/messages');
      return { messages: native };
    };
    // Match only public native message identities; the same paging contract
    // must hold without requiring ZCode to adopt another provider's IDs.
    return { readHistory: options => adapter.readHistory({ ...options, sessionId: 'zcode:fixture' }),
      expected: zcodeHistory(native) };
  }],
];

for (const [provider, create] of factories) test(`${provider} explicit 500 pages retain all history and default 100`, async () => {
  const adapter = create();
  const expected = adapter.expected ?? messages;
  const read = options => adapter.readHistory({ sessionId, includeAgentDetails: false, ...options });
  assert.equal((await read({})).messages.length, 100);
  assert.equal((await read({ limit: 9999 })).messages.length, 500);
  assert.equal((await read({ limit: '500' })).messages.length, 500);
  const collected = [];
  let before = null;
  let pages = 0;
  do {
    const page = await read({ limit: 500, before });
    assert.equal(page.messages.length, pages < 2 ? 500 : 123);
    assert.equal(page.has_more, Boolean(page.next_cursor));
    collected.unshift(...page.messages);
    before = page.next_cursor;
    assert.ok(++pages <= 3, 'history cursor must advance');
  } while (before);
  assert.equal(new Set(collected.map(message => message.id)).size, expected.length);
  assert.deepEqual(collected.map(message => [message.id, message.content]), expected.map(message => [message.id, message.content]));
});
