import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

// Endpoint artwork is generated once and bundled, so launch never rasterizes
// text, samples SVGs, performs a particle assignment, or needs a network request.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'mobile/assets/opening');
const width = 400, height = 240, resolution = 2;
const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><text x="200" y="131" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-size="42" font-weight="400" letter-spacing="-.8" fill="#F6F8F5">Relayune</text></svg>`;
const icon = (await readFile(path.join(root, 'mobile/assets/brand/relayune-app-icon.svg'), 'utf8'))
  .replace('<rect width="1024" height="1024" fill="#0B1220"/>', '')
  .replace('viewBox="0 0 1024 1024"', 'x="115" y="35" width="170" height="170" viewBox="0 0 1024 1024"');
const moon = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240" viewBox="0 0 400 240">${icon}</svg>`;
async function raster(svg, name) {
  const pipeline = sharp(Buffer.from(svg), { density: 72 * resolution }).ensureAlpha();
  const png = await pipeline.clone().png().toBuffer();
  await writeFile(path.join(output, name), png);
  return pipeline.raw().toBuffer({ resolveWithObject: true });
}
function sample({ data, info }) {
  const points = [];
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      let mass = 0, sumX = 0, sumY = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const alpha = data[((y + dy) * info.width + x + dx) * 4 + 3];
        mass += alpha; sumX += (x + dx + .5) * alpha; sumY += (y + dy + .5) * alpha;
      }
      if (mass > 35) points.push([sumX / mass / resolution, sumY / mass / resolution]);
    }
  }
  return points;
}
const [textRaster, iconRaster] = await Promise.all([
  raster(wordmark, 'morph-wordmark.png'), raster(moon, 'morph-moon.png'),
]);
const source = sample(textRaster), target = sample(iconRaster);
const count = Math.max(source.length, target.length);
const resample = a => Array.from({ length: count }, (_, i) => a[Math.floor(i * a.length / count)]);
// Balanced spatial partitioning assigns nearby portions together. Every point
// survives the whole animation; no random reassignment between frames.
function pair(a, b, axis = 0) {
  if (a.length <= 1) return a.map((p, i) => [p, b[i]]);
  a.sort((p, q) => p[axis] - q[axis] || p[1-axis] - q[1-axis]);
  b.sort((p, q) => p[axis] - q[axis] || p[1-axis] - q[1-axis]);
  const middle = Math.floor(a.length / 2);
  return [...pair(a.slice(0, middle), b.slice(0, middle), 1-axis), ...pair(a.slice(middle), b.slice(middle), 1-axis)];
}
const pairs = pair(resample(source), resample(target));
const bytes = Buffer.alloc(8 + count * 16);
bytes.write('RYM1'); bytes.writeUInt32LE(count, 4);
pairs.forEach(([a, b], i) => [...a, ...b].forEach((v, j) => bytes.writeFloatLE(v, 8 + i * 16 + j * 4)));
await writeFile(path.join(output, 'wordmark-morph.bin'), bytes);
console.log(JSON.stringify({ particles: count, sourceSamples: source.length, targetSamples: target.length, bytes: bytes.length }));

// iOS hands off the exact same wordmark to Flutter, with no font/weight jump.
const launchAssets = path.join(root, 'mobile/ios/Runner/Assets.xcassets/LaunchWordmark.imageset');
await mkdir(launchAssets, { recursive: true });
await copyFile(path.join(output, 'morph-wordmark.png'), path.join(launchAssets, 'wordmark@2x.png'));
