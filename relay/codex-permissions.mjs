export function pickPermissions(value) {
  const sandboxPolicy = value?.sandboxPolicy ?? value?.sandbox;
  if (!value?.approvalPolicy || !value?.approvalsReviewer || !sandboxPolicy?.type) return null;
  return { approvalPolicy: value.approvalPolicy, approvalsReviewer: value.approvalsReviewer, sandboxPolicy };
}

export const CODEX_PERMISSION_MODES = ['default', 'auto', 'manual', 'full'];
export function permissionMode(settings) {
  if (!settings) return 'unknown';
  const {approvalPolicy: policy, approvalsReviewer: reviewer, sandboxPolicy: sandbox} = settings;
  if (sandbox.type === 'dangerFullAccess' && policy === 'never') return 'full';
  if (sandbox.type !== 'workspaceWrite') return 'custom';
  if (policy === 'on-request' && ['auto_review', 'guardian_subagent'].includes(reviewer)) return 'auto';
  if (policy === 'on-request' && reviewer === 'user') return 'default';
  if (policy === 'untrusted' && reviewer === 'user') return 'manual';
  return 'custom';
}
export function permissionSettings(mode, current, cwd) {
  if (!CODEX_PERMISSION_MODES.includes(mode)) throw new Error('Unsupported Codex permission mode.');
  return {
    approvalPolicy: mode === 'full' ? 'never' : mode === 'manual' ? 'untrusted' : 'on-request',
    approvalsReviewer: mode === 'auto' ? 'auto_review' : 'user',
    sandboxPolicy: mode === 'full' ? {type: 'dangerFullAccess'} : {
      type: 'workspaceWrite',
      writableRoots: [...new Set([cwd, ...(current?.sandboxPolicy?.type === 'workspaceWrite' ? current.sandboxPolicy.writableRoots : [])].filter(Boolean))],
      networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false,
    },
  };
}
export function permissionConfig(settings) {
  const actual = pickPermissions(settings);
  const sandboxLabel = {workspaceWrite: '工作区及已授权目录可写', readOnly: '只读', dangerFullAccess: '不受沙箱限制', externalSandbox: '由外部环境限制'}[actual?.sandboxPolicy.type] ?? '自定义执行范围';
  const approvalLabel = {never: '不请求审批', untrusted: '不受信任命令需审批', 'on-request': '按需审批'}[actual?.approvalPolicy] ?? '自定义审批规则';
  return {
    id: 'permissions', type: 'select', name: '权限',
    currentValue: permissionMode(actual),
    description: actual
      ? `电脑端后续消息权限：${sandboxLabel} · ${approvalLabel}${actual.sandboxPolicy.networkAccess === true ? ' · 允许联网' : actual.sandboxPolicy.networkAccess === false ? ' · 联网受限' : ''}`
      : '尚未确认电脑端权限。请在 Codex Desktop 中打开此会话；连接恢复后会自动重试读取。',
    // Do not guess or offer changes before obtaining authoritative state.
    options: actual ? [
      {value: 'default', name: '默认权限', description: '工作区内自动执行，需要额外权限时询问。'},
      {value: 'auto', name: '自动审批', description: '需要审批的操作由 Auto-review 评估，可批准或拒绝。'},
      {value: 'manual', name: '手动审批', description: '不受信任的命令交给你审批；安全读取仍可自动执行。'},
      {value: 'full', name: '完全访问', description: '取消沙箱限制并关闭审批提示，只作用于当前会话。'},
    ] : [],
  };
}
