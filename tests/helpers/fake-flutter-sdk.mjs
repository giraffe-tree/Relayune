import { copyFileSync, linkSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function fakeFlutterSdk(root) {
  const dart = join(root, "bin", "cache", "dart-sdk", "bin", "dart.exe");
  const snapshot = join(root, "bin", "cache", "flutter_tools.snapshot");
  const launcher = join(root, "bin", "flutter.bat");
  mkdirSync(dirname(dart), { recursive: true });
  // A real native executable, valid on the current test host, supplies the fake
  // Dart process. Node accepts the synthetic snapshot file as JavaScript.
  try { linkSync(process.execPath, dart); }
  catch { copyFileSync(process.execPath, dart); }
  writeFileSync(snapshot, 'if (process.argv.includes("--fake-failure")) process.exit(1); require("node:fs").writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)));\n');
  writeFileSync(launcher, '@echo off\r\nexit /b 91\r\n');
  return { root, dart, snapshot, launcher };
}
