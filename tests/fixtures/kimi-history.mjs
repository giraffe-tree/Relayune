import { historyMessagesFromKimiUpdates, kimiAgentsFromUpdates } from '../../relay/kimi-adapter.mjs';

// ACP transport tests inject historical content; native read-only wire storage
// and pagination are exercised separately in kimi-readonly-history.test.mjs.
export async function fakeKimiHistory({ sessionId, updatedAt }) {
  const updates = [
    { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'historical question' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'historical answer' } },
    { sessionUpdate: 'tool_call', toolCallId: '8:tool-history-agents', title: 'AgentSwarm', kind: 'other', status: 'in_progress', rawInput: { description: '历史并行任务', subagent_type: 'coder', prompt_template: 'Handle {{item}}', items: ['中文名=银杏 | slug=ginkgo', '中文名=红杉 | slug=redwood'] } },
    { sessionUpdate: 'tool_call_update', toolCallId: '8:tool-history-agents', status: 'completed', content: [] },
  ];
  return { messages: historyMessagesFromKimiUpdates(sessionId, updates, updatedAt), agents: kimiAgentsFromUpdates(sessionId, updates, updatedAt) };
}
