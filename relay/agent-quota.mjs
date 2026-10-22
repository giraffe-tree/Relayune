// Only normalized quota metadata crosses the encrypted catalog boundary.
const finite = value => typeof value === "number" && Number.isFinite(value);
const percent = value => finite(value) && value >= 0 ? Math.min(100, value) : null;
function resetTime(value) {
  if (!finite(value) || value <= 0 || value > 8640000000000) return null;
  return new Date(value * 1000).toISOString();
}

export function normalizeCodexQuota(result, now = new Date()) {
  const bucket = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  // Never present a model-specific bucket as the general Codex allowance.
  if (!bucket || (bucket.limitId && bucket.limitId !== "codex")) return [];
  const windows = new Map();
  for (const window of [bucket.primary, bucket.secondary]) {
    const id = window?.windowDurationMins === 300 ? "five_hour" :
      window?.windowDurationMins === 10080 ? "seven_day" : null;
    if (!id) continue;
    windows.set(id, { id, used_percent: percent(window.usedPercent),
      resets_at: resetTime(window.resetsAt), as_of: now.toISOString() });
  }
  return [...windows.values()];
}

export function mergeClaudeQuota(previous, info, now = new Date()) {
  const id = info?.rateLimitType ?? info?.rate_limit_type;
  if (!["five_hour", "seven_day"].includes(id)) return previous;
  const utilization = info.utilization;
  const window = {
    id,
    used_percent: finite(utilization) ? percent(utilization * 100) : null,
    resets_at: resetTime(info.resetsAt ?? info.resets_at),
    as_of: now.toISOString(),
    status: ["allowed", "allowed_warning", "rejected"].includes(info.status) ? info.status : null,
  };
  // An event may omit utilization. Do not invent 0% or keep an old percentage.
  return [...previous.filter(item => item.id !== id), window];
}
