// Public preparation media: generated only from the SVG below, never from screenshots.
// These are labelled placeholders, not screenshots or proof of a tested product journey.
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [
  { "path": "mobile/assets/notifications/task-completion-ios.png", "width": 1206, "height": 2622, "format": "png" },
  {
    "path": "public/marketing/task-replay/phone-done.webp",
    "width": 1170,
    "height": 2532,
    "format": "webp"
  },
  {
    "path": "public/marketing/task-replay/phone-implement.webp",
    "width": 1170,
    "height": 2532,
    "format": "webp"
  },
  {
    "path": "public/marketing/task-replay/phone-request.webp",
    "width": 1170,
    "height": 2532,
    "format": "webp"
  },
  {
    "path": "public/marketing/task-replay/phone-verify.webp",
    "width": 1170,
    "height": 2532,
    "format": "webp"
  },
  {
    "path": "public/marketing/task-replay/web-done.webp",
    "width": 2560,
    "height": 1416,
    "format": "webp"
  },
  {
    "path": "public/marketing/task-replay/web-implement.webp",
    "width": 2560,
    "height": 1416,
    "format": "webp"
  },
  {
    "path": "public/marketing/task-replay/web-request.webp",
    "width": 2560,
    "height": 1416,
    "format": "webp"
  },
  {
    "path": "public/marketing/task-replay/web-verify.webp",
    "width": 2560,
    "height": 1416,
    "format": "webp"
  },
  {
    "path": "public/marketing/product-screens/actual-desktop-done.png",
    "width": 3840,
    "height": 2160,
    "format": "png"
  },
  {
    "path": "public/marketing/product-screens/actual-phone-done.png",
    "width": 860,
    "height": 1864,
    "format": "png"
  },
  {
    "path": "public/community/assets/relayune-mobile-workbench-v1.webp",
    "width": 912,
    "height": 1834,
    "format": "webp"
  },
  {
    "path": "public/community/assets/wechat-group-45df35c52465d7f2.png",
    "width": 1203,
    "height": 1682,
    "format": "png"
  },
  {
    "path": "public/community/assets/wechat-group-d0e56e76985d54f2.png",
    "width": 720,
    "height": 1094,
    "format": "png"
  },
  {
    "path": "public/community/assets/wechat-group-qr-2026-09-10.png",
    "width": 904,
    "height": 904,
    "format": "png"
  },
  {
    "path": "docs/marketing/community-assets/source/relayune-mobile-workbench.png",
    "width": 912,
    "height": 1944,
    "format": "png"
  },
  {
    "path": "docs/marketing/community-assets/source/wechat-group-qr-2026-09-10.png",
    "width": 904,
    "height": 904,
    "format": "png"
  }
];

for (const asset of assets) {
  const tall = asset.height > asset.width;
  const label = asset.path.includes("wechat-group") ? "NO GROUP QR INCLUDED" : "SYNTHETIC PLACEHOLDER";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}" viewBox="0 0 800 ${tall ? 1200 : 500}">
    <rect width="800" height="${tall ? 1200 : 500}" fill="#f4f1e9"/>
    <g font-family="sans-serif" text-anchor="middle" fill="#252923">
      <text x="400" y="${tall ? 450 : 170}" font-size="52">Relayune</text>
      <text x="400" y="${tall ? 520 : 230}" font-size="22">${label}</text>
      <text x="400" y="${tall ? 570 : 280}" font-size="17">Public source preparation</text>
      <text x="400" y="${tall ? 615 : 325}" font-size="15">No private session data</text>
    </g>
  </svg>`;
  const output = resolve(root, asset.path);
  await mkdir(dirname(output), { recursive: true });
  const raster = sharp(Buffer.from(svg));
  if (asset.format === "webp") await raster.webp({ quality: 82, effort: 6 }).toFile(output);
  else await raster.png({ palette: true, colours: 8, compressionLevel: 9 }).toFile(output);
}
console.log(`Created ${assets.length} labelled public-preparation placeholder assets.`);
