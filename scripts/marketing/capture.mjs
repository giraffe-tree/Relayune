import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const task = JSON.parse(await readFile(resolve(root, "scripts/marketing/font-size-task.json"), "utf8"));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}
run(process.execPath, ["scripts/marketing/capture-web.mjs"]);
run(process.execPath, ["mobile/tool/flutter.mjs", "test", "../scripts/marketing/capture-phone_test.dart", "--reporter", "expanded"]);
const output = resolve(root, "public/marketing/task-replay");
await mkdir(output, { recursive: true });
for (const stage of task.stages) {
  await sharp(resolve(root, `work/marketing-capture/phone-${stage.id}.png`))
    .webp({ quality: 90 }).toFile(resolve(output, `phone-${stage.id}.webp`));
}
const project = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
await writeFile(resolve(root, "scripts/marketing/capture-manifest.json"), JSON.stringify({
  uiVersion: project.version, fixtureKind: task.fixtureKind,
  capture: "Production React and Flutter components rendered offline with synthetic messages and timestamps; not a real task record",
  screens: task.stages.flatMap(stage => ["web", "phone"].map(device => `${device}-${stage.id}.webp`)),
}, null, 2) + "\n");
console.log("Eight compressed production UI captures ready.");
