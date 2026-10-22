import { parseFeedback, MAX_FEEDBACK_REQUEST_BYTES } from '../shared/feedback.mjs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function feedbackDeviceInfo() {
  if (os.platform() === 'darwin') {
    const run = async (file, args) => {
      try { return (await promisify(execFile)(file, args, { timeout: 3000, maxBuffer: 1024 })).stdout.trim(); }
      catch { return null; }
    };
    const [version, model] = await Promise.all([
      run('/usr/bin/sw_vers', ['-productVersion']), run('/usr/sbin/sysctl', ['-n', 'hw.model']),
    ]);
    return { model, system: version ? `macOS ${version}` : null };
  }
  return { model: null, system: `${os.type()} ${os.release()} (${os.arch()})` };
}

export async function feedbackRequest(action, env = process.env, input = process.stdin, fetcher = fetch) {
  if (action === 'info') return feedbackDeviceInfo();
  if (action !== 'submit') throw new Error('feedback_invalid');
  const origin = new URL(env.RELAY_SERVER_URL);
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('feedback_invalid');
  if (!env.RELAY_DEVICE_TOKEN) throw new Error('feedback_sign_in_required');
  let size = 0;
  const chunks = [];
  for await (const chunk of input) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_FEEDBACK_REQUEST_BYTES) throw new Error('feedback_invalid');
    chunks.push(bytes);
  }
  const body = Buffer.concat(chunks).toString('utf8');
  if (!body || Buffer.byteLength(body) > MAX_FEEDBACK_REQUEST_BYTES || !parseFeedback(JSON.parse(body))) throw new Error('feedback_invalid');
  const response = await fetcher(new URL('/api/feedback', origin), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Origin: origin.origin, Authorization: `Bearer ${env.RELAY_DEVICE_TOKEN}` }, body,
  });
  if (!response.ok) throw new Error('feedback_failed');
  return response.json();
}
