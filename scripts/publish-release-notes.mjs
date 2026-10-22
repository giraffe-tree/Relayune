import { readFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient, ServerApiVersion } from "mongodb";

const allowedPlatforms = new Set([
  "web",
  "server",
  "android",
  "ios",
  "macos",
  "windows",
]);
const allowedCopyLocales = new Set([
  "en",
  "zh",
  "hi",
  "es",
  "ar",
  "fr",
  "bn",
  "pt",
  "id",
  "ur",
]);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const filename = args.find((arg) => !arg.startsWith("--"));
  if (!filename) {
    throw new Error(
      "Usage: npm run release-notes:publish -- release-notes/<version>.json [--dry-run]",
    );
  }

  const manifest = validateManifest(
    JSON.parse(await readFile(path.resolve(filename), "utf8")),
  );
  if (dryRun) {
    writeResult({ ok: true, dry_run: true, version: manifest._id });
    return;
  }

  const mongoHost = process.env.MONGO_HOST?.trim() || "127.0.0.1";
  if (!/^(127\.0\.0\.1|localhost)$/.test(mongoHost)) {
    throw new Error("MONGO_HOST must remain loopback-only.");
  }
  const mongoPort = Number(process.env.MONGO_PORT || "27017");
  const mongoDatabase = required("MONGO_DATABASE");
  const mongoUsername = required("MONGO_USER");
  const mongoPassword = await secret("MONGO_PASSWORD", "MONGO_PASSWORD_FILE");
  if (!Number.isInteger(mongoPort) || mongoPort < 1 || mongoPort > 65_535) {
    throw new Error("MONGO_PORT is invalid.");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(mongoDatabase)) {
    throw new Error("MONGO_DATABASE is invalid.");
  }

  const client = new MongoClient(`mongodb://${mongoHost}:${mongoPort}`, {
    auth: { username: mongoUsername, password: mongoPassword },
    authSource: mongoDatabase,
    directConnection: true,
    connectTimeoutMS: 5_000,
    serverSelectionTimeoutMS: 5_000,
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  try {
    await client.connect();
    const collection = client.db(mongoDatabase).collection("relay_release_notes");
    await collection.createIndex(
      { published_at: -1 },
      { name: "relay_release_notes_published_idx" },
    );
    const result = await collection.replaceOne(
      { _id: manifest._id },
      manifest,
      { upsert: true },
    );
    writeResult({
      ok: true,
      dry_run: false,
      version: manifest._id,
      changed: result.modifiedCount > 0 || result.upsertedCount > 0,
    });
  } finally {
    await client.close();
  }
}

function validateManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Release manifest must be an object.");
  }
  const keys = Object.keys(value).sort();
  const allowedKeys = ["copy", "platforms", "publishedAt", "version"];
  if (keys.join("|") !== allowedKeys.sort().join("|")) {
    throw new Error(`Release manifest keys must be: ${allowedKeys.join(", ")}.`);
  }
  const version = text(value.version, "version", 64);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Release version must use semantic versioning.");
  }
  const publishedAt = new Date(value.publishedAt);
  if (
    typeof value.publishedAt !== "string" ||
    Number.isNaN(publishedAt.getTime()) ||
    publishedAt.toISOString() !== value.publishedAt
  ) {
    throw new Error("publishedAt must be an exact ISO-8601 UTC timestamp.");
  }
  if (!Array.isArray(value.platforms) || value.platforms.length === 0) {
    throw new Error("At least one release platform is required.");
  }
  const platforms = [...new Set(value.platforms.map((platform) =>
    text(platform, "platform", 24).toLowerCase(),
  ))];
  if (
    platforms.length > 6 ||
    platforms.some((platform) => !allowedPlatforms.has(platform))
  ) {
    throw new Error("Release platforms contain an unsupported value.");
  }
  if (!value.copy || typeof value.copy !== "object" || Array.isArray(value.copy)) {
    throw new Error("Release manifest requires localized copy.");
  }
  const copyKeys = Object.keys(value.copy).sort();
  if (
    !copyKeys.includes("en") ||
    !copyKeys.includes("zh") ||
    copyKeys.some((locale) => !allowedCopyLocales.has(locale))
  ) {
    throw new Error(
      "Release manifest copy must contain zh and en and may contain only supported locales.",
    );
  }

  return {
    _id: version,
    published_at: publishedAt,
    platforms,
    copy: Object.fromEntries(
      copyKeys.map((locale) => [
        locale,
        localizedCopy(value.copy[locale], locale),
      ]),
    ),
  };
}

function localizedCopy(value, locale) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${locale} copy must be an object.`);
  }
  if (Object.keys(value).sort().join("|") !== "items|title") {
    throw new Error(`${locale} copy must contain exactly title and items.`);
  }
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > 24) {
    throw new Error(`${locale} copy must contain 1 to 24 items.`);
  }
  return {
    title: text(value.title, `${locale} title`, 160),
    items: value.items.map((item) => text(item, `${locale} item`, 600)),
  };
}

function text(value, label, maxLength) {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value.trim().replace(/\s+/g, " ");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function secret(name, filenameName) {
  const direct = process.env[name]?.trim();
  if (direct) return direct;
  const filename = process.env[filenameName]?.trim();
  if (!filename) throw new Error(`${name} or ${filenameName} is required.`);
  const value = (await readFile(filename, "utf8")).trim();
  if (!value) throw new Error(`${filenameName} is empty.`);
  return value;
}

function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "unknown_error" })}\n`,
  );
  process.exitCode = 1;
});
