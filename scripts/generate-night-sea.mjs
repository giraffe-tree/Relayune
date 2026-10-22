// Original procedural artwork. No photographs, downloaded images, fonts or AI
// outputs are used. Keep this source with its generated images for provenance.
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let seed = 0x52454c41;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}
const waves = [];
for (let row = 0; row < 145; row++) {
  const depth = row / 144;
  const y = 589 + 433 * depth ** 1.75;
  const amplitude = 0.4 + 4.5 * depth;
  const phase = random() * Math.PI * 2;
  const points = [];
  for (let x = -10; x <= 1546; x += 8) {
    const dy = Math.sin(x * (0.018 + depth * 0.018) + phase) * amplitude
      + Math.sin(x * 0.076 + phase * 2) * amplitude * 0.25;
    points.push(`${x},${(y + dy).toFixed(2)}`);
  }
  waves.push(`<polyline points="${points.join(" ")}" fill="none" stroke="#7ca6b8" stroke-width="${(0.35 + depth * 0.8).toFixed(2)}" opacity="${(0.06 + random() * 0.12).toFixed(3)}"/>`);
}
const sea = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024">
<defs>
  <linearGradient id="sky" x2="0" y2="1"><stop stop-color="#040d1c"/><stop offset=".7" stop-color="#10263e"/><stop offset="1" stop-color="#304a5c"/></linearGradient>
  <linearGradient id="sea" x2="0" y2="1"><stop stop-color="#19384c"/><stop offset="1" stop-color="#030b17"/></linearGradient>
  <radialGradient id="glow"><stop stop-color="#a0bbc7" stop-opacity=".44"/><stop offset="1" stop-color="#7096ad" stop-opacity="0"/></radialGradient>
  <radialGradient id="edge"><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></radialGradient>
</defs>
<rect width="1536" height="589" fill="url(#sky)"/>
<ellipse cx="768" cy="590" rx="740" ry="300" fill="url(#glow)"/>
<rect y="589" width="1536" height="435" fill="url(#sea)"/>
<ellipse cx="768" cy="605" rx="440" ry="140" fill="url(#glow)"/>
${waves.join("\n")}
<rect width="1536" height="1024" fill="url(#edge)"/>
</svg>`;
const seaBytes = await sharp(Buffer.from(sea)).webp({ quality: 90, effort: 6 }).toBuffer();
for (const file of ["desktop/src/assets/night-sea.webp", "mobile/assets/opening/night-sea.webp"]) {
  await writeFile(resolve(root, file), seaBytes);
}

// Replace the unrecorded marketing texture with original vector geometry too.
const lines = Array.from({ length: 80 }, (_, i) => {
  const y = i * 18;
  return `<path d="M-40 ${y} Q450 ${y - 170} 940 ${y + 45} T1900 ${y - 70}" fill="none" stroke="#69e1d2" opacity="${(0.015 + random() * 0.035).toFixed(3)}"/>`;
}).join("");
const texture = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1100"><rect width="1800" height="1100" fill="#0b1220"/>${lines}</svg>`;
await sharp(Buffer.from(texture)).png().toFile(resolve(root, "docs/marketing/hackathon-card/assets/relayune-signal-background.png"));
console.log("Generated two identical night-sea backgrounds and the marketing texture from original SVG geometry.");
