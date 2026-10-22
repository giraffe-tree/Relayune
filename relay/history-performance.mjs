import {constants} from 'node:fs';
import {mkdir, open, rename} from 'node:fs/promises';
import {dirname} from 'node:path';

const FIELDS = ['desktop_received_at_ms', 'history_started_at_ms', 'history_ready_at_ms',
  'history_read_ms', 'command_wait_ms', 'encrypted_at_ms', 'queued_at_ms', 'queue_entries',
  'response_wire_bytes', 'message_count', 'upload_started_at_ms', 'upload_completed_at_ms',
  'queue_wait_ms', 'upload_ms'];

// The desktop shell intentionally discards arbitrary stdout. Keep only numeric
// history diagnostics in a private, bounded local file beside the Relay state.
// This retention policy applies to diagnostics, never the mobile message log.
export function createHistoryPerformanceRecorder(path, {maxBytes = 2 * 1024 * 1024} = {}) {
  let pending = Promise.resolve();
  const record = sample => {
    if (!/^history_[a-f0-9]{32}$/.test(sample.trace_id ?? '') ||
        !['queued', 'uploaded'].includes(sample.stage)) return;
    const safe = {trace_id: sample.trace_id, stage: sample.stage};
    for (const name of FIELDS) if (Number.isFinite(sample[name])) safe[name] = sample[name];
    const line = `Relayune history performance ${JSON.stringify(safe)}\n`;
    if (!path) return;
    pending = pending.then(async () => {
      await mkdir(dirname(path), {recursive: true, mode: 0o700});
      const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW;
      let handle = await open(path, flags, 0o600);
      try {
        if ((await handle.stat()).size + Buffer.byteLength(line) > maxBytes) {
          await handle.close();
          handle = null;
          await rename(path, `${path}.previous`);
          handle = await open(path, flags, 0o600);
        }
        await handle.chmod(0o600);
        await handle.writeFile(line);
      } finally { await handle?.close(); }
    }).catch(() => {}); // Optional diagnostics cannot stall history delivery.
  };
  record.flush = () => pending;
  return record;
}
