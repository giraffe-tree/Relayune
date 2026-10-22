const PACKAGE_TARGETS = new Map([
  ["aarch64-apple-darwin", "node22-macos-arm64"],
  ["x86_64-apple-darwin", "node22-macos-x64"],
  ["aarch64-pc-windows-msvc", "node22-win-arm64"],
  ["x86_64-pc-windows-msvc", "node22-win-x64"],
]);

export function packageTarget(tuple) {
  return PACKAGE_TARGETS.get(tuple) ?? null;
}

export function targetTuples(tuple) {
  if (tuple === "universal-apple-darwin") {
    return ["aarch64-apple-darwin", "x86_64-apple-darwin"];
  }
  if (PACKAGE_TARGETS.has(tuple)) return [tuple];
  throw new Error(`Unsupported Relayune desktop target ${tuple}.`);
}

export function sidecarFileName(tuple) {
  const extension = tuple.includes("-windows-") ? ".exe" : "";
  return `relayune-core-${tuple}${extension}`;
}

export function smokeTestFileName(tuple) {
  return tuple.includes("-windows-") ? "relayune-core.exe" : "relayune-core";
}
