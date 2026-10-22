// Private parent-to-sidecar stdin only. Never echo input or key material.
export async function handleLocalControl(relay, line, write) {
  if (line === "relayune:retry_file_access") {
    await relay.retryFileAccess();
    return;
  }
  if (typeof line !== "string" || line.length > 1024) return;
  let command;
  try { command = JSON.parse(line); } catch { return; }
  if (command?.type !== "relayune:browser_key" ||
      !/^[0-9]+-[0-9]+$/.test(command.request_id ?? "")) return;
  let status = "error";
  try {
    await relay.updateBrowserKey(command.browser_id, command.key);
    status = "ok";
  } catch { /* Only a fixed, non-secret acknowledgement crosses stdout. */ }
  write(`relayune:browser_key:${command.request_id}:${status}\n`);
}
