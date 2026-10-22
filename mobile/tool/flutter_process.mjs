import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

function environmentValue(environment, name) {
  return Object.entries(environment).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

// Windows .bat files cannot be spawned directly without a shell. Use the
// initialized SDK's native Dart executable and its already-built tool snapshot;
// never interpolate caller-provided Flutter arguments into a command string.
export function flutterInvocation(args, { platform = process.platform, environment = process.env } = {}) {
  if (platform !== "win32") return { command: "flutter", args, environment };
  let sdk = environmentValue(environment, "FLUTTER_ROOT");
  if (sdk) {
    if (!isAbsolute(sdk)) throw new Error("FLUTTER_ROOT must be an absolute Flutter SDK directory.");
  } else {
    for (const entry of String(environmentValue(environment, "PATH") || "").split(";")) {
      const directory = entry.replace(/^"|"$/g, "");
      if (!directory || !isAbsolute(directory)) continue;
      const launcher = join(directory, "flutter.bat");
      if (existsSync(launcher) && statSync(launcher).isFile()) {
        sdk = resolve(dirname(realpathSync(launcher)), "..");
        break;
      }
    }
  }
  const initialize = "Initialize your Flutter SDK by running flutter.bat --version in your terminal, then retry; set FLUTTER_ROOT to the SDK directory if it is not on PATH.";
  if (!sdk || !existsSync(sdk) || !statSync(sdk).isDirectory()) throw new Error(initialize);
  const root = realpathSync(sdk);
  const dart = join(root, "bin", "cache", "dart-sdk", "bin", "dart.exe");
  const snapshot = join(root, "bin", "cache", "flutter_tools.snapshot");
  const launcher = join(root, "bin", "flutter.bat");
  if (![dart, snapshot, launcher].every((file) => existsSync(file) && statSync(file).isFile())) {
    throw new Error(`Flutter SDK native tool or initialized snapshot is missing. ${initialize}`);
  }
  // Avoid duplicate environment keys differing only in case on Windows.
  const childEnvironment = Object.fromEntries(Object.entries(environment).filter(([key]) => key.toLowerCase() !== "flutter_root"));
  childEnvironment.FLUTTER_ROOT = root;
  return { command: dart, args: [snapshot, ...args], environment: childEnvironment };
}
