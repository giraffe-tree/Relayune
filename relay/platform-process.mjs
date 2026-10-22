export function agentSpawnOptions(
  command,
  options,
  platform = process.platform,
) {
  if (platform !== "win32") return options;
  return {
    ...options,
    windowsHide: true,
    // npm-installed agent CLIs are commonly .cmd shims on Windows. Native
    // executables stay direct children; shims are resolved by cmd.exe.
    shell: !/\.(?:com|exe)$/i.test(command.trim()),
  };
}
