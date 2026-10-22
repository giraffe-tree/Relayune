import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(scriptDirectory, "..");
const mobileIconSource = resolve(
  repositoryDirectory,
  "mobile/assets/brand/relayune-app-icon.svg",
);

await Promise.all([
  renderSvg(
    resolve(repositoryDirectory, "public/brand/relayune/relayune-og.svg"),
    resolve(repositoryDirectory, "public/og.png"),
    1680,
    941,
  ),
  renderSvg(
    mobileIconSource,
    resolve(repositoryDirectory, "public/apple-touch-icon.png"),
    180,
    180,
  ),
  ...iosIcons().map(({ name, size }) =>
    renderSvg(
      mobileIconSource,
      resolve(
        repositoryDirectory,
        "mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset",
        name,
      ),
      size,
      size,
    ),
  ),
  ...androidIcons().flatMap(({ density, size }) => [
    renderSvg(
      mobileIconSource,
      resolve(
        repositoryDirectory,
        `mobile/android/app/src/main/res/mipmap-${density}/ic_launcher.png`,
      ),
      size,
      size,
    ),
    renderRoundIcon(density, size),
  ]),
]);

console.log(
  "Generated Relayune OG, Apple touch, iOS AppIcon, and Android launcher assets.",
);

async function renderSvg(source, output, width, height) {
  const svg = await readFile(source);
  await mkdir(dirname(output), { recursive: true });
  await sharp(svg, { density: 384 })
    .resize(width, height, { fit: "fill" })
    .png()
    .toFile(output);
}

function iosIcons() {
  return [
    { name: "Icon-App-20x20@1x.png", size: 20 },
    { name: "Icon-App-20x20@2x.png", size: 40 },
    { name: "Icon-App-20x20@3x.png", size: 60 },
    { name: "Icon-App-29x29@1x.png", size: 29 },
    { name: "Icon-App-29x29@2x.png", size: 58 },
    { name: "Icon-App-29x29@3x.png", size: 87 },
    { name: "Icon-App-40x40@1x.png", size: 40 },
    { name: "Icon-App-40x40@2x.png", size: 80 },
    { name: "Icon-App-40x40@3x.png", size: 120 },
    { name: "Icon-App-60x60@2x.png", size: 120 },
    { name: "Icon-App-60x60@3x.png", size: 180 },
    { name: "Icon-App-76x76@1x.png", size: 76 },
    { name: "Icon-App-76x76@2x.png", size: 152 },
    { name: "Icon-App-83.5x83.5@2x.png", size: 167 },
    { name: "Icon-App-1024x1024@1x.png", size: 1024 },
  ];
}

function androidIcons() {
  return [
    { density: "mdpi", size: 48 },
    { density: "hdpi", size: 72 },
    { density: "xhdpi", size: 96 },
    { density: "xxhdpi", size: 144 },
    { density: "xxxhdpi", size: 192 },
  ];
}

async function renderRoundIcon(density, size) {
  const source = await readFile(mobileIconSource);
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`);
  await sharp(source, { density: 384 })
    .resize(size, size)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toFile(resolve(repositoryDirectory, `mobile/android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`));
}
