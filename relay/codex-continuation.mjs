// Match the native task-resume policy without treating account limits or an
// arbitrary error message as permission to retry. Callers must also prove idle.
const TRANSIENT_KINDS = new Set(['serverOverloaded', 'internalServerError']);
const TRANSIENT_DETAILS = ['httpConnectionFailed', 'responseStreamConnectionFailed',
  'responseStreamDisconnected', 'responseTooManyFailedAttempts'];
const TEMPORARY_MODEL = /\bmodel\s+is\s+temporarily\s+unavailable\b|^stream\s+disconnected\s+before\s+completion:\s*we['’]re\s+currently\s+processing\s+too\s+many\s+requests\b/i;
const ACCOUNT_LIMIT = /\b(?:usage|quota|rate[\s_-]+limit(?:s|ed|ing)?|billing|credits?)\b/i;

export function canContinueCodexTurn(turn) {
  if (turn?.status === 'interrupted') return true;
  if (turn?.status !== 'failed' || !turn.error || typeof turn.error !== 'object') return false;
  const info = turn.error.codexErrorInfo;
  if (TRANSIENT_KINDS.has(info)) return true;
  if (info && typeof info === 'object' && !Array.isArray(info))
    return TRANSIENT_DETAILS.some(key => Object.hasOwn(info, key));
  const message = turn.error.message;
  return info === 'other' && typeof message === 'string' &&
    TEMPORARY_MODEL.test(message) && !ACCOUNT_LIMIT.test(message);
}
