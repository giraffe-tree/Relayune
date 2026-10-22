import { open } from 'node:fs/promises';

// Codex resume otherwise inherits the current global sandbox, even when the
// previous turn used a narrower one. Read only the last native turn context;
// never store or return conversation text, credentials, or older settings.
export async function resumePermissionsFromRollout(path) {
  if (!path) return {};
  const file = await open(path, 'r');
  try {
    let position = (await file.stat()).size;
    let prefix = Buffer.alloc(0);
    while (position > 0) {
      const length = Math.min(position, 1024 * 1024);
      position -= length;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      const joined = Buffer.concat([buffer.subarray(0, bytesRead), prefix]);
      const firstNewline = position > 0 ? joined.indexOf(10) : -1;
      if (position > 0 && firstNewline === -1) { prefix = joined; continue; }
      prefix = position > 0 ? joined.subarray(0, firstNewline) : Buffer.alloc(0);
      const lines = joined.subarray(position > 0 ? firstNewline + 1 : 0).toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('turn_context')) continue;
        let record;
        try { record = JSON.parse(lines[i]); } catch { continue; }
        if (record.type === 'turn_context') return resumePermissionParams(record.payload);
      }
    }
    return {};
  } finally { await file.close(); }
}

export function resumePermissionParams(context) {
  const sandbox = context?.sandbox_policy;
  if (!sandbox) return {};
  if (!['workspace-write', 'read-only', 'danger-full-access'].includes(sandbox.type)) {
    throw new Error('无法安全恢复此会话的沙箱，请在 Codex 中打开后重试。');
  }
  const result = { sandbox: sandbox.type };
  if (context.approval_policy != null) result.approvalPolicy = context.approval_policy;
  if (context.approvals_reviewer != null) result.approvalsReviewer = context.approvals_reviewer;
  if (sandbox.type === 'workspace-write') {
    const config = {};
    // Explicit defaults prevent a newer global config from expanding access.
    for (const key of ['network_access', 'exclude_tmpdir_env_var', 'exclude_slash_tmp']) {
      if (sandbox[key] != null && typeof sandbox[key] !== 'boolean') throw new Error('Invalid persisted sandbox.');
      config[`sandbox_workspace_write.${key}`] = sandbox[key] ?? false;
    }
    if (sandbox.writable_roots != null && (!Array.isArray(sandbox.writable_roots) ||
        sandbox.writable_roots.some(root => typeof root !== 'string'))) throw new Error('Invalid persisted sandbox roots.');
    config['sandbox_workspace_write.writable_roots'] = sandbox.writable_roots ?? [];
    result.config = config;
  }
  return result;
}
