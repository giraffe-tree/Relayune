import { spawn } from 'node:child_process';
import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { agentSpawnOptions } from './platform-process.mjs';

const endpoints = new Set(['https://api.kimi.com/coding/v1', 'https://api.kimi.ai/coding/v1']);
const numeric = value => typeof value === 'number' || (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) ? Number(value) : NaN;

export function normalizeKimiQuota(payload, now = new Date()) {
  const windows = new Map();
  const add = (id, detail) => {
    if (!detail || typeof detail !== 'object') return;
    const limit = numeric(detail.limit);
    const remaining = numeric(detail.remaining);
    const reported = numeric(detail.used);
    const used = Number.isFinite(reported) ? reported : limit - remaining;
    const reset = typeof detail.resetTime === 'string' ? Date.parse(detail.resetTime) : NaN;
    windows.set(id, { id,
      used_percent: Number.isFinite(limit) && limit > 0 && Number.isFinite(used) && used >= 0 ? Math.min(100, used / limit * 100) : null,
      resets_at: Number.isFinite(reset) ? new Date(reset).toISOString() : null,
      as_of: now.toISOString(),
    });
  };
  // Kimi's official parser identifies the top-level usage summary as weekly.
  add('seven_day', payload?.usage);
  for (const item of Array.isArray(payload?.limits) ? payload.limits : []) {
    const duration = numeric(item?.window?.duration);
    const unit = item?.window?.timeUnit;
    const minutes = duration * ({TIME_UNIT_MINUTE:1,TIME_UNIT_HOUR:60,TIME_UNIT_DAY:1440,TIME_UNIT_WEEK:10080}[unit] ?? NaN);
    if (minutes === 300) add('five_hour', item.detail);
    // Keep the plan's weekly summary authoritative when both are returned.
    if (minutes === 10080 && !windows.has('seven_day')) add('seven_day', item.detail);
  }
  return [...windows.values()];
}

export function readKimiProviderConfig({ kimiBin, kimiHome, workspace, spawnProcess = spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(kimiBin, ['provider', 'list', '--json'], agentSpawnOptions(kimiBin, {
      cwd: workspace, env: {...process.env, KIMI_CODE_HOME:kimiHome}, stdio:['ignore','pipe','pipe'],
    }));
    let output = '';
    const fail = () => { clearTimeout(timer); child.kill(); reject(new Error('Kimi quota configuration unavailable.')); };
    const timer = setTimeout(fail, 4000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (Buffer.byteLength(output) > 512 * 1024) fail();
    });
    // Config output can contain provider credentials. Never log either stream.
    child.stderr.resume();
    child.once('error', fail);
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('Kimi quota configuration unavailable.')); return; }
      try { resolve(JSON.parse(output)); } catch { reject(new Error('Kimi quota configuration unavailable.')); }
    });
  });
}

export async function readKimiQuota({ kimiBin, kimiHome, workspace, configReader = readKimiProviderConfig, fetchImpl = fetch, env = process.env }) {
  try {
    // The CLI can create a default config; only query an existing installation.
    if (!(await stat(join(kimiHome, 'config.toml'))).isFile()) return [];
    const config = await configReader({kimiBin,kimiHome,workspace});
    const provider = config?.providers?.['managed:kimi-code'];
    const base = provider?.baseUrl?.replace(/\/+$/, '');
    if (!endpoints.has(base)) return [];
    const override = env.KIMI_CODE_BASE_URL?.replace(/\/+$/, '');
    if (override && override !== base) return [];
    let token = provider.apiKey;
    if (provider.oauth) {
      if (provider.oauth.storage !== 'file') return [];
      const name = provider.oauth.key?.replace(/^oauth\//, '');
      if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return [];
      const file = await open(join(kimiHome, 'credentials', `${name}.json`), constants.O_RDONLY | constants.O_NOFOLLOW);
      let credential;
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 65536) return [];
        credential = JSON.parse(await file.readFile('utf8'));
      } finally { await file.close(); }
      if (typeof credential.expires_at === 'number' && credential.expires_at > 0 && credential.expires_at <= Date.now() / 1000) return [];
      token = credential.access_token;
    }
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) return [];
    const response = await fetchImpl(`${base}/usages`, {
      headers: {Authorization:`Bearer ${token}`,Accept:'application/json'},
      redirect:'error', signal:AbortSignal.timeout(5000),
    });
    if (!response.ok) return [];
    // Only normalized quota fields leave this local reader; no raw account data.
    return normalizeKimiQuota(await response.json());
  } catch {
    // Expired auth, old CLI and unsupported providers remain unknown, not 0%.
    return [];
  }
}
