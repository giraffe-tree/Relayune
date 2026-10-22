import type { Db } from 'mongodb';
import { cleanClientVersions, type ClientVersions } from './client-observations';
import { userReference } from './request-log.mjs';
export type MonitoringDirectory = {
  versions?(emails: string[]): Promise<Map<string, ClientVersions>>;
  reference(email: string): string | undefined;
  emails(refs: string[]): Promise<Map<string, string>>;
};
// Only account identifiers are read; no passwords, tokens, or session payloads.
export function createMonitoringDirectory(db: Db, identity: { version: string; key: Buffer } | null): MonitoringDirectory | null {
  if (!identity) return null;
  return {
    async versions(emails) {
      const result = new Map<string, ClientVersions>();
      if (!emails.length) return result;
      const cursor = db.collection<{ _id: string; client_versions?: unknown }>('auth_users').find({ _id: { $in: emails } }, { projection: { _id: 1, client_versions: 1 }, maxTimeMS: 10000 });
      try { for await (const row of cursor) result.set(String(row._id), cleanClientVersions(row.client_versions)); }
      finally { await cursor.close(); }
      return result;
    },
    reference: email => userReference(email, identity),
    async emails(refs) {
      const wanted = new Set(refs); const found = new Map<string, string>();
      if (!wanted.size) return found;
      const cursor = db.collection<{ _id: string }>('auth_users').find({}, { projection: { _id: 1 }, maxTimeMS: 10000, batchSize: 500 });
      try {
        for await (const row of cursor) {
          if (typeof row._id !== 'string') continue;
          const email = row._id.trim().toLowerCase(); const ref = userReference(email, identity);
          if (ref && wanted.has(ref)) { found.set(ref, email); wanted.delete(ref); }
          if (!wanted.size) break;
        }
      } finally { await cursor.close(); }
      return found;
    },
  };
}
