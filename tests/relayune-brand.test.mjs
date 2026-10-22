import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { inflateSync } from "node:zlib";

const visibleBrandFiles = [
  "app/layout.tsx",
  "app/page.tsx",
  "app/marketing-home.tsx",
  "app/workbench-page.tsx",
  "desktop/index.html",
  "desktop/src/main.ts",
  "desktop/src-tauri/src/lib.rs",
  "relay/cli.mjs",
  "server/email-auth.ts",
];

test("user-facing applications use the Relayune brand", async () => {
  const sources = await Promise.all(
    visibleBrandFiles.map((file) => readFile(file, "utf8")),
  );
  const combined = sources.join("\n");

  assert.match(combined, /Relayune/);
  assert.doesNotMatch(combined, /Agent Relay/);
});

test("desktop header omits the studio label and animates the Relayune mark", async () => {
  const [desktopMain, desktopStyles] = await Promise.all([
    readFile("desktop/src/main.ts", "utf8"),
    readFile("desktop/src/styles.css", "utf8"),
  ]);

  assert.doesNotMatch(desktopMain, /GIRAFFETREE/);
  assert.match(desktopMain, /relayune-mark-pulse/);
  assert.match(desktopMain, /#0B1220/);
  assert.match(desktopMain, /#F6F8F5/);
  assert.match(desktopMain, /#69E1D2/);
  assert.match(desktopStyles, /@keyframes mark-float/);
  assert.match(desktopStyles, /@keyframes mark-flow/);
  assert.match(desktopStyles, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(desktopMain, /relayune-mark-spark|relayune-mark-stroke/);
});

test("desktop rename keeps compatibility identifiers stable", async () => {
  const [rootPackage, config, info] = await Promise.all([
    readFile("package.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/tauri.conf.json", "utf8").then(JSON.parse),
    readFile("desktop/src-tauri/Info.plist", "utf8"),
  ]);

  assert.equal(config.productName, "Relayune");
  assert.equal(config.version, rootPackage.version);
  assert.equal(config.identifier, "cn.giraffetree.agent-relay");
  assert.match(info, /<string>relayune<\/string>/);
  assert.match(info, /<string>agent-relay<\/string>/);
});

test("Eclipse Relay is the complete production brand system", async () => {
  const productionFiles = [
    "public/favicon.svg",
    "public/brand/relayune/relayune-eclipse-mark.svg",
    "public/brand/relayune/relayune-eclipse-static.svg",
    "public/brand/relayune/relayune-eclipse-template.svg",
    "public/brand/relayune/relayune-eclipse-flow.svg",
    "public/brand/relayune/relayune-eclipse-breathe.svg",
    "public/brand/relayune/relayune-eclipse-wait.svg",
    "public/brand/relayune/relayune-eclipse-confirm.svg",
    "public/brand/relayune/relayune-og.svg",
    "mobile/assets/brand/relayune-app-icon.svg",
  ];
  const sources = await Promise.all(
    productionFiles.map((file) => readFile(file, "utf8")),
  );

  for (const source of sources) {
    assert.match(source, /<svg\b/);
    assert.match(source, /Eclipse Relay|encrypted relay|living channel|pairing confirmed|Relayune/);
    assert.doesNotMatch(source, /abstract R|moon-node|spark|lunar rune/i);
    assert.doesNotMatch(source, /<(?:image|script)\b/i);
    assert.doesNotMatch(source, /(?:href|src)="https?:/i);
  }

  for (const file of [
    "public/brand/relayune/relayune-eclipse-flow.svg",
    "public/brand/relayune/relayune-eclipse-breathe.svg",
    "public/brand/relayune/relayune-eclipse-wait.svg",
    "public/brand/relayune/relayune-eclipse-confirm.svg",
  ]) {
    const source = await readFile(file, "utf8");
    assert.match(source, /@keyframes/);
    assert.match(source, /prefers-reduced-motion: reduce/);
  }

  assert.match(sources[1], /currentColor/);
  assert.match(sources[2], /#0B1220/);
  assert.match(sources[2], /#F6F8F5/);
  assert.doesNotMatch(sources[3], /#69E1D2/i);

  const waitSource = await readFile(
    "public/brand/relayune/relayune-eclipse-wait.svg",
    "utf8",
  );
  assert.match(waitSource, /\.wait-rotor/);
  assert.match(waitSource, /\.wait-channel/);
  assert.match(waitSource, /transform-origin: 256px 256px/);
  assert.match(waitSource, /transform: rotate\(366deg\)/);
  assert.match(waitSource, /cubic-bezier/);
  assert.match(waitSource, /animation-delay: 110ms/);
  assert.match(waitSource, /stroke-width: 76/);
  assert.match(waitSource, /stroke-width: 50/);
  assert.match(waitSource, /translate\(-9px, 5px\)/);
  assert.match(
    waitSource,
    /<circle cx="256" cy="256" r="154" fill="#F6F8F5"\/>/,
  );
  assert.doesNotMatch(
    waitSource,
    /#69E1D2|wait-deform|wait-signal|wait-outbound|wait-inbound|scale\(/,
  );

  for (const icon of [
    "desktop/src-tauri/icons/32x32.png",
    "desktop/src-tauri/icons/128x128.png",
    "desktop/src-tauri/icons/128x128@2x.png",
    "desktop/src-tauri/icons/icon.icns",
    "desktop/src-tauri/icons/trayTemplate.png",
  ]) {
    assert.ok((await stat(icon)).size > 0, `${icon} must be generated`);
  }
});

test("web, desktop, and mobile reference the selected Eclipse sources", async () => {
  const [globals, legal, notFound, layout, desktopIcons, mobileMark] =
    await Promise.all([
      readFile("app/globals.css", "utf8"),
      readFile("app/legal/legal.module.css", "utf8"),
      readFile("app/not-found.tsx", "utf8"),
      readFile("app/layout.tsx", "utf8"),
      readFile("desktop/scripts/generate-icons.mjs", "utf8"),
      readFile("mobile/lib/src/widgets/brand_mark.dart", "utf8"),
    ]);

  assert.match(globals, /relayune-eclipse-flow\.svg/);
  assert.match(globals, /relayune-eclipse-static\.svg/);
  assert.match(globals, /marketing-user-paused \.brand-mark/);
  assert.match(globals, /prefers-reduced-motion: reduce/);
  for (const source of [legal, notFound]) {
    assert.match(source, /relayune-eclipse-static\.svg/);
    assert.doesNotMatch(source, /relayune-rune\.svg/);
  }
  assert.match(layout, /apple-touch-icon\.png/);
  assert.match(desktopIcons, /relayune-eclipse-static\.svg/);
  assert.match(desktopIcons, /relayune-eclipse-template\.svg/);
  assert.match(mobileMark, /_EclipsePainter/);
  assert.match(mobileMark, /0xFF0B1220/);
  assert.match(mobileMark, /0xFFF6F8F5/);
  assert.match(mobileMark, /0xFF69E1D2/);
  assert.match(mobileMark, /disableAnimations/);
  assert.doesNotMatch(mobileMark, /_RunePainter/);

  const adaptiveIcon = await readFile(
    "mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
    "utf8",
  );
  const adaptiveForeground = await readFile(
    "mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml",
    "utf8",
  );
  const adaptiveColors = await readFile(
    "mobile/android/app/src/main/res/values/colors.xml",
    "utf8",
  );
  assert.match(adaptiveIcon, /@color\/ic_launcher_background/);
  assert.match(adaptiveIcon, /@drawable\/ic_launcher_foreground/);
  assert.match(adaptiveForeground, /#F6F8F5/);
  assert.match(adaptiveColors, /#0B1220/);
});

test("generated web and mobile brand bitmaps have the expected dimensions", async () => {
  for (const [file, width, height] of [
    ["public/og.png", 1680, 941],
    ["public/apple-touch-icon.png", 180, 180],
    [
      "mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png",
      1024,
      1024,
    ],
    ["mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48, 48],
    ["mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72, 72],
    ["mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96, 96],
    ["mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144, 144],
    ["mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192, 192],
  ]) {
    const dimensions = pngDimensions(await readFile(file));
    assert.equal(dimensions.width, width, `${file} width`);
    assert.equal(dimensions.height, height, `${file} height`);
  }
});

test("Android launcher icons preserve Eclipse Relay across legacy, adaptive, round, and themed launchers", async () => {
  const [manifest, foreground, monochrome, adaptive, adaptiveRound, themed, themedRound] =
    await Promise.all([
      readFile("mobile/android/app/src/main/AndroidManifest.xml", "utf8"),
      readFile(
        "mobile/android/app/src/main/res/drawable/ic_launcher_foreground.xml",
        "utf8",
      ),
      readFile(
        "mobile/android/app/src/main/res/drawable/ic_launcher_monochrome.xml",
        "utf8",
      ),
      readFile(
        "mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
        "utf8",
      ),
      readFile(
        "mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml",
        "utf8",
      ),
      readFile(
        "mobile/android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml",
        "utf8",
      ),
      readFile(
        "mobile/android/app/src/main/res/mipmap-anydpi-v33/ic_launcher_round.xml",
        "utf8",
      ),
    ]);

  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);

  for (const source of [adaptive, adaptiveRound, themed, themedRound]) {
    assert.match(source, /@color\/ic_launcher_background/);
    assert.match(source, /@drawable\/ic_launcher_foreground/);
  }
  for (const source of [themed, themedRound]) {
    assert.match(source, /<monochrome android:drawable="@drawable\/ic_launcher_monochrome"/);
  }

  for (const source of [foreground, monochrome]) {
    assert.match(source, /android:width="108dp"/);
    assert.match(source, /M54,21\.5A32\.5,32\.5/);
    assert.match(source, /android:fillType="evenOdd"/);
    assert.match(source, /<clip-path/);
    assert.doesNotMatch(source, /strokeColor="@android:color\/transparent"/);
  }
  assert.match(foreground, /#F6F8F5/);
  assert.match(monochrome, /#FFFFFFFF/);
  assert.doesNotMatch(monochrome, /#0B1220|#F6F8F5|#69E1D2/i);

  for (const [density, size] of [
    ["mdpi", 48],
    ["hdpi", 72],
    ["xhdpi", 96],
    ["xxhdpi", 144],
    ["xxxhdpi", 192],
  ]) {
    const legacyFile = `mobile/android/app/src/main/res/mipmap-${density}/ic_launcher.png`;
    const roundFile = `mobile/android/app/src/main/res/mipmap-${density}/ic_launcher_round.png`;
    const legacy = await readFile(legacyFile);
    const round = await readFile(roundFile);
    assert.deepEqual(pngDimensions(legacy), { width: size, height: size });
    assert.deepEqual(pngDimensions(round), { width: size, height: size });
    assertAndroidLegacyIcon(legacy, legacyFile);
    assertTransparentIcon(round, roundFile);
  }
});

test("Android cold start keeps the background without a duplicate launcher mark", async () => {
  const [legacy, modern, day, night] = await Promise.all([
    readFile("mobile/android/app/src/main/res/drawable/launch_background.xml", "utf8"),
    readFile("mobile/android/app/src/main/res/drawable-v21/launch_background.xml", "utf8"),
    readFile("mobile/android/app/src/main/res/values-v31/styles.xml", "utf8"),
    readFile("mobile/android/app/src/main/res/values-night-v31/styles.xml", "utf8"),
  ]);
  for (const source of [legacy, modern]) {
    assert.match(source, /@color\/ic_launcher_background/);
    assert.doesNotMatch(source, /@drawable\/ic_launcher_foreground/);
  }
  for (const source of [day, night]) {
    assert.match(source, /windowSplashScreenBackground[^\n]*@color\/ic_launcher_background/);
    assert.match(source, /windowSplashScreenAnimatedIcon[^\n]*@drawable\/launch_empty_icon/);
    assert.match(source, /windowSplashScreenAnimationDuration[^\n]*0/);
  }
});

test("Relayune icon redesign package includes three self-contained SVG systems", async () => {
  const appIcons = [
    "public/brand/relayune/concepts/01-eclipse-relay.svg",
    "public/brand/relayune/concepts/02-phase-relay.svg",
    "public/brand/relayune/concepts/03-moon-harbor.svg",
  ];
  const marks = [
    "public/brand/relayune/concepts/marks/eclipse-relay-mark.svg",
    "public/brand/relayune/concepts/marks/phase-relay-mark.svg",
    "public/brand/relayune/concepts/marks/moon-harbor-mark.svg",
  ];

  for (const source of await Promise.all(
    appIcons.map((file) => readFile(file, "utf8")),
  )) {
    assert.match(source, /viewBox="0 0 1024 1024"/);
    assert.match(source, /role="img"/);
    assert.match(source, /<title/);
    assert.match(source, /<desc/);
    assert.doesNotMatch(source, /<(?:image|script)\b/i);
    assert.doesNotMatch(source, /(?:href|src)="https?:/i);
  }

  for (const source of await Promise.all(
    marks.map((file) => readFile(file, "utf8")),
  )) {
    assert.match(source, /viewBox="0 0 64 64"/);
    assert.match(source, /currentColor/);
    assert.doesNotMatch(source, /<(?:image|script)\b/i);
    assert.doesNotMatch(source, /(?:href|src)="https?:/i);
  }
});

test("desktop icons preserve transparent masks instead of white squares", async () => {
  for (const icon of [
    "desktop/src-tauri/icons/32x32.png",
    "desktop/src-tauri/icons/128x128.png",
    "desktop/src-tauri/icons/128x128@2x.png",
    "desktop/src-tauri/icons/trayTemplate.png",
  ]) {
    assertTransparentIcon(await readFile(icon), icon);
  }

  const icns = await readFile("desktop/src-tauri/icons/icon.icns");
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  let pngRepresentations = 0;
  let legacyMaskRepresentations = 0;
  for (let offset = 8; offset + 8 <= icns.length; ) {
    const type = icns.subarray(offset, offset + 4).toString("ascii");
    const length = icns.readUInt32BE(offset + 4);
    assert.ok(length >= 8 && offset + length <= icns.length);
    const payload = icns.subarray(offset + 8, offset + length);
    if (payload.subarray(0, 8).equals(PNG_SIGNATURE)) {
      assertTransparentIcon(payload, `icon.icns ${type}`);
      pngRepresentations += 1;
    } else if (type === "s8mk" || type === "l8mk") {
      const size = type === "s8mk" ? 16 : 32;
      assertTransparentAlphaMask(payload, size, `icon.icns ${type}`);
      legacyMaskRepresentations += 1;
    }
    offset += length;
  }
  assert.ok(
    pngRepresentations >= 4,
    "icon.icns must contain transparent PNG representations",
  );
  assert.equal(
    legacyMaskRepresentations,
    2,
    "icon.icns must preserve transparency in both legacy masks",
  );

  const ico = await readFile("desktop/src-tauri/icons/icon.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const icoRepresentations = ico.readUInt16LE(4);
  assert.ok(icoRepresentations >= 4);
  for (let index = 0; index < icoRepresentations; index += 1) {
    const entry = 6 + index * 16;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(length > 0 && offset + length <= ico.length);
    assertTransparentIcon(
      ico.subarray(offset, offset + length),
      `icon.ico representation ${index}`,
    );
  }
});

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function pngDimensions(source) {
  assert.ok(source.subarray(0, 8).equals(PNG_SIGNATURE));
  assert.equal(source.subarray(12, 16).toString("ascii"), "IHDR");
  return { width: source.readUInt32BE(16), height: source.readUInt32BE(20) };
}

function assertTransparentIcon(source, description) {
  const { width, height, rgba } = decodeRgbaPng(source);
  const alphaAt = (x, y) => rgba[(y * width + x) * 4 + 3];
  for (const [x, y] of [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ]) {
    assert.equal(alphaAt(x, y), 0, `${description} must have transparent corners`);
  }
  assert.ok(
    rgba.some((value, index) => index % 4 === 3 && value > 0),
    `${description} must retain a visible glyph`,
  );
}

function assertAndroidLegacyIcon(source, description) {
  const { width, height, rgba } = decodeRgbaPng(source);
  const pixelAt = (x, y) =>
    [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  const navy = [0x0b, 0x12, 0x20, 0xff];
  for (const [x, y] of [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width / 2), 0],
    [Math.floor(width / 2), height - 1],
  ]) {
    assert.deepEqual(
      pixelAt(x, y),
      navy,
      `${description} must use the navy brand background through its edge`,
    );
  }
  assert.ok(
    rgba.some(
      (value, index) =>
        index % 4 === 0 &&
        value >= 0xf0 &&
        rgba[index + 1] >= 0xf0 &&
        rgba[index + 2] >= 0xf0 &&
        rgba[index + 3] === 0xff,
    ),
    `${description} must retain the light Eclipse Relay glyph`,
  );
}

function assertTransparentAlphaMask(source, size, description) {
  assert.equal(source.length, size * size);
  for (const offset of [0, size - 1, size * (size - 1), size * size - 1]) {
    assert.equal(source[offset], 0, `${description} must have transparent corners`);
  }
  assert.ok(source.some((alpha) => alpha > 0), `${description} must remain visible`);
}

function decodeRgbaPng(source) {
  assert.ok(source.subarray(0, 8).equals(PNG_SIGNATURE));
  let width;
  let height;
  const compressed = [];
  for (let offset = 8; offset + 12 <= source.length; ) {
    const length = source.readUInt32BE(offset);
    const type = source.subarray(offset + 4, offset + 8).toString("ascii");
    const data = source.subarray(offset + 8, offset + 8 + length);
    assert.ok(offset + 12 + length <= source.length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "desktop icons must use 8-bit PNG channels");
      assert.equal(data[9], 6, "desktop icons must use RGBA PNG pixels");
      assert.equal(data[12], 0, "interlaced desktop icons are unsupported");
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  assert.ok(width > 0 && height > 0 && compressed.length > 0);

  const bytesPerPixel = 4;
  const rowLength = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(compressed));
  assert.equal(filtered.length, height * (rowLength + 1));
  const rgba = Buffer.alloc(width * height * bytesPerPixel);
  let inputOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[inputOffset];
    inputOffset += 1;
    for (let x = 0; x < rowLength; x += 1) {
      const raw = filtered[inputOffset + x];
      const outputOffset = y * rowLength + x;
      const left = x >= bytesPerPixel ? rgba[outputOffset - bytesPerPixel] : 0;
      const above = y > 0 ? rgba[outputOffset - rowLength] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? rgba[outputOffset - rowLength - bytesPerPixel]
          : 0;
      rgba[outputOffset] = unfilterByte(filter, raw, left, above, upperLeft);
    }
    inputOffset += rowLength;
  }
  return { width, height, rgba };
}

function unfilterByte(filter, raw, left, above, upperLeft) {
  if (filter === 0) return raw;
  if (filter === 1) return (raw + left) & 0xff;
  if (filter === 2) return (raw + above) & 0xff;
  if (filter === 3) return (raw + Math.floor((left + above) / 2)) & 0xff;
  if (filter === 4) return (raw + paeth(left, above, upperLeft)) & 0xff;
  assert.fail(`unsupported PNG filter ${filter}`);
}

function paeth(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}
