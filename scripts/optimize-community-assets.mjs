import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(
  root,
  "docs",
  "marketing",
  "community-assets",
  "source",
);
const outputDirectory = path.join(root, "public", "community", "assets");

const groupQrSource = path.join(
  sourceDirectory,
  "wechat-group-qr-2026-09-10.png",
);
const groupQrOutput = path.join(
  outputDirectory,
  "wechat-group-qr-2026-09-10.png",
);
const workbenchSource = path.join(
  sourceDirectory,
  "relayune-mobile-workbench.png",
);
const workbenchOutput = path.join(
  outputDirectory,
  "relayune-mobile-workbench-v1.webp",
);

await mkdir(outputDirectory, { recursive: true });

const qrMetadata = await sharp(groupQrSource).metadata();
if (qrMetadata.width !== 904 || qrMetadata.height !== 904) {
  throw new Error("The current WeChat group QR source must remain 904x904.");
}

const workbenchMetadata = await sharp(workbenchSource).metadata();
if (workbenchMetadata.width !== 912 || workbenchMetadata.height !== 1944) {
  throw new Error("The current workbench source must remain 912x1944.");
}

await Promise.all([
  sharp(groupQrSource)
    .grayscale()
    .threshold(160)
    .png({
      adaptiveFiltering: true,
      bitdepth: 1,
      colours: 2,
      compressionLevel: 9,
      dither: 0,
      effort: 10,
      palette: true,
    })
    .toFile(groupQrOutput),
  sharp(workbenchSource)
    // The page previously hid these 110 pixels with a CSS transform. Cropping
    // them before encoding avoids downloading pixels the user never sees.
    .extract({ left: 0, top: 110, width: 912, height: 1834 })
    .webp({ effort: 6, quality: 84, smartSubsample: true })
    .toFile(workbenchOutput),
]);

const [qrFile, workbenchFile] = await Promise.all([
  stat(groupQrOutput),
  stat(workbenchOutput),
]);
if (qrFile.size > 24 * 1024) {
  throw new Error(`Optimized group QR exceeds 24 KiB: ${qrFile.size} bytes.`);
}
if (workbenchFile.size > 96 * 1024) {
  throw new Error(
    `Optimized workbench screenshot exceeds 96 KiB: ${workbenchFile.size} bytes.`,
  );
}

console.log(
  `Optimized community assets: QR ${qrFile.size} bytes, workbench ${workbenchFile.size} bytes.`,
);
