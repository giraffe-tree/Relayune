import type { Db } from 'mongodb';
export type ClientObservation = { version: string; seen_at: number };
export type ClientVersions = Partial<Record<'macos' | 'ios' | 'android' | 'web' | 'windows', ClientObservation>>;
const platforms = new Set(['macos', 'ios', 'android', 'web', 'windows']);
export function validVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}
// Public, self-reported software metadata, never an authentication signal.
export function createClientObserver(db: Db, now = Date.now) {
  const recent = new Map<string, { version: string; time: number }>();
  return async (email: string, headers: Record<string, unknown> = {}) => {
    const platform = headers['x-relay-client-platform'];
    const version = headers['x-relay-client-version'];
    if (typeof platform !== 'string' || !platforms.has(platform) || !validVersion(version)) return;
    const time = now(); const key = `${email}:${platform}`; const previous = recent.get(key);
    if (previous?.version === version && time - previous.time < 60000) return;
    if (recent.size >= 10000) recent.delete(recent.keys().next().value!);
    recent.set(key, { version, time });
    try {
      await db.collection<{ _id: string }>('auth_users').updateOne({ _id: email }, { $set: { [`client_versions.${platform}`]: { version, seen_at: time } } }, { maxTimeMS: 5000 });
    } catch { recent.delete(key); }
  };
}
export function cleanClientVersions(value: unknown): ClientVersions {
  const result: ClientVersions = {};
  if (!value || typeof value !== 'object') return result;
  for (const [platform, sample] of Object.entries(value)) {
    if (!platforms.has(platform) || !sample || !validVersion(sample.version) || !Number.isSafeInteger(sample.seen_at) || sample.seen_at <= 0) continue;
    result[platform as keyof ClientVersions] = { version: sample.version, seen_at: sample.seen_at };
  }
  return result;
}
