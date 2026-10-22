// Observe fatal errors without swallowing them or changing Node's exit behavior.
export function fatalCategory(error) {
  try {
    const code = error?.code ?? error?.cause?.code;
    if (['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(code)) return 'network';
    if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || error?.name === 'TimeoutError') return 'timeout';
    if (['EACCES', 'EPERM'].includes(code)) return 'permission_denied';
    if (code === 'ENOSPC') return 'disk_full';
    if (['ENOMEM', 'ERR_MEMORY_ALLOCATION_FAILED'].includes(code)) return 'out_of_memory';
  } catch { /* Never let diagnostics obscure the original failure. */ }
  return 'unknown';
}

export function installFatalDiagnostics(target = process, write = line => process.stderr.write(line)) {
  const monitor = (error, origin) => {
    try {
      write(`relayune:fatal:${origin === 'unhandledRejection' ? 'unhandled_rejection' : 'uncaught_exception'}\n`);
      write(`relayune:fatal:${fatalCategory(error)}\n`);
    } catch { /* A closed diagnostic pipe must not change fatal cleanup. */ }
  };
  target.on('uncaughtExceptionMonitor', monitor);
  return () => target.off('uncaughtExceptionMonitor', monitor);
}
