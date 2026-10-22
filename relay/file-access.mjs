// Inspect only operating-system errors, never message content from a session.
// RPC transports may preserve only the error message, so recognize explicit
// POSIX signatures as well as structured codes. Do not log the source error.
export function isFileAccessError(error, seen = new Set()) {
  if (!error || typeof error !== "object" || seen.has(error)) return false;
  seen.add(error);
  if (["EACCES", "EPERM"].includes(error.code)) return true;
  if (/\b(?:EACCES|EPERM)\b|permission denied(?:\s*\(os error (?:1|13)\))?|operation not permitted(?:\s*\(os error 1\))?/i.test(error.message ?? "")) return true;
  if (isFileAccessError(error.cause, seen)) return true;
  return Array.isArray(error.errors) && error.errors.some(item => isFileAccessError(item, seen));
}

export function rethrowFileAccessError(error) {
  if (isFileAccessError(error)) throw error;
}
