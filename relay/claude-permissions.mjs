import { mkdtempSync, openSync, closeSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { agentSpawnOptions } from './platform-process.mjs';

const MODES = [
  ['manual', '手动审批', '需要权限的操作由你确认。'],
  ['acceptEdits', '自动批准编辑', '自动批准文件编辑；其他操作仍可能询问。'],
  ['auto', '智能自动审批', '由 Claude 安全分类器判断；取决于账号、模型和管理员策略，选择时校验。'],
  ['plan', '计划模式', '分析和制定方案，限制写入操作。'],
  ['dontAsk', '高级：仅执行已授权操作', '未获授权的操作直接拒绝，并非全部同意。'],
  ['bypassPermissions', '高级：跳过权限检查（高风险）', '大幅放开工具执行权限，仅用于隔离环境；仍保留需要用户回答的问题。'],
];

export function permissionOptions(modes) {
  return [
    { value: 'inherit', name: '沿用本机配置', description: '不覆盖 Claude 本机设置；仅清除 Relayune 当前会话的审批模式选择。' },
    ...MODES.flatMap(([mode, name, description]) => {
      const value = mode === 'manual' && !modes.includes('manual') ? 'default' : mode;
      return modes.includes(value) ? [{ value, name, description }] : [];
    }),
  ];
}

export function samePermissionMode(left, right) {
  const normalize = value => value === 'manual' ? 'default' : value;
  return normalize(left) === normalize(right);
}

// Neither probe sends a user message, executes tools, or saves a conversation.
// Never expose initialization/account payloads or raw stderr to the caller.
function probe({ command, args = [], cwd, claudeHome, spawnProcess = spawn }, flags, initialize) {
  return new Promise((resolve, reject) => {
    // Some native Claude builds exit before flushing long --help output to a
    // pipe (truncated at 8 KB). A private file descriptor preserves the full help.
    const directory = initialize ? null : mkdtempSync(join(tmpdir(), 'relayune-claude-help-'));
    const helpFile = directory ? join(directory, 'help.txt') : null;
    const helpFd = helpFile ? openSync(helpFile, 'w', 0o600) : null;
    const cleanupHelp = () => { if (directory) rmSync(directory, { recursive: true, force: true }); };
    let child;
    try {
      child = spawnProcess(command, [...args, ...flags], agentSpawnOptions(command, {
        cwd, env: { ...process.env, ...(claudeHome ? { CLAUDE_CONFIG_DIR: claudeHome } : {}) },
        stdio: ['pipe', helpFd ?? 'pipe', 'pipe'],
      }));
    } catch {
      if (helpFd !== null) closeSync(helpFd);
      cleanupHelp();
      reject(new Error('无法启动 Claude 审批模式校验；原设置未更改。'));
      return;
    }
    // Wait for the child to release its inherited descriptor before deletion
    // (Windows also requires this when a timed-out help process is killed).
    child.once('close', () => { try { cleanupHelp(); } catch {} });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (helpFd !== null) {
        try { if (!error) value = readFileSync(helpFile, 'utf8').slice(-64000); }
        catch { error = true; }
        closeSync(helpFd);
      }
      reader?.close();
      child.stdin.end();
      child.kill('SIGTERM');
      const killer = setTimeout(() => child.kill('SIGKILL'), 2000);
      killer.unref?.();
      child.once('exit', () => clearTimeout(killer));
      if (error) reject(new Error('无法确认 Claude 审批模式是否可用。请检查本机 CLI、账号、模型或管理员策略；原设置未更改。'));
      else resolve(value);
    };
    const timer = setTimeout(() => finish(true), 15000);
    const reader = initialize ? createInterface({ input: child.stdout, crlfDelay: Infinity }) : null;
    child.stderr.resume();
    child.once('error', () => finish(true));
    child.stdin.on('error', () => finish(true));
    child.once('exit', code => initialize ? finish(true) : finish(code !== 0));
    if (!initialize) {
      child.stdin.end();
      return;
    }
    reader.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.type !== 'control_response' || message.response?.request_id !== 'relayune_permissions') return;
      const actual = message.response?.response?.current_permission_mode;
      finish(message.response.subtype !== 'success' || typeof actual !== 'string', actual);
    });
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'relayune_permissions', request: { subtype: 'initialize' } })}\n`);
  });
}

export async function readClaudePermissionModes(options) {
  const help = await probe(options, ['--help'], false);
  const section = help.match(/--permission-mode\s+<[^>]+>([\s\S]*?)(?=\n\s+--|$)/)?.[1] ?? '';
  return [...new Set([...section.matchAll(/"(manual|default|acceptEdits|auto|plan|dontAsk|bypassPermissions)"/g)].map(match => match[1]))];
}

export async function verifyClaudePermissionMode(options) {
  const actual = await probe(options, [
    '--print', '--input-format', 'stream-json', '--output-format', 'stream-json',
    '--verbose', '--no-session-persistence',
    ...(options.model ? ['--model', options.model] : []),
    '--permission-mode', options.mode,
  ], true);
  if (!samePermissionMode(actual, options.mode)) {
    throw new Error('Claude 未采用所选审批模式，可能受账号、模型或管理员策略限制；原设置未更改。');
  }
  return actual;
}
