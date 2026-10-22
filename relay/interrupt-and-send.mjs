// Serialize replacement/stop controls per session. A cancel request is not a
// terminal acknowledgement: never submit the new input until the old turn ends.
export function serializeSessionControl(adapter, sessionId, operation) {
  adapter.sessionControls ??= new Map();
  const previous = adapter.sessionControls.get(sessionId) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  adapter.sessionControls.set(sessionId, current);
  return current.finally(() => {
    if (adapter.sessionControls.get(sessionId) === current) adapter.sessionControls.delete(sessionId);
  });
}

export async function stopBeforeSending(adapter, options, submit) {
  return serializeSessionControl(adapter, options.sessionId, async () => {
    const deadline = Date.now() + (adapter.controlTimeoutMs ?? 10_000);
    const wait = async () => {
      if (adapter.closed || Date.now() >= deadline) throw new Error('Stop could not be confirmed; new message was not sent.');
      await new Promise(resolve => setTimeout(resolve, 25));
    };
    while (adapter.startingSessions?.has(options.sessionId)) await wait();
    const old = adapter.activeTurns.get(options.sessionId);
    if (old) {
      await adapter.interruptTurnUnlocked({ sessionId: options.sessionId });
      while (adapter.activeTurns.get(options.sessionId) === old) await wait();
    }
    if (adapter.closed) throw new Error('Agent connection is closed; new message was not sent.');
    return submit();
  });
}
