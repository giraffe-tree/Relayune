const COLLECTION = "relay_release_notes";
const MAX_ITEMS = 24;
const MAX_RELEASES = 50;
export const RELEASE_NOTE_LOCALES = Object.freeze([
  "en",
  "zh-CN",
  "hi",
  "es",
  "ar",
  "fr",
  "bn",
  "pt",
  "id",
  "ur",
]);

export class ReleaseNotesApi {
  constructor(db) {
    this.releases = db.collection(COLLECTION);
  }

  async initialize() {
    await this.releases.createIndex(
      { published_at: -1 },
      { name: "relay_release_notes_published_idx" },
    );
  }

  async handle(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/release-notes") return null;

    if (request.method !== "GET" && request.method !== "HEAD") {
      return Response.json(
        { error: { code: "method_not_allowed", message: "Method not allowed." } },
        { status: 405, headers: { Allow: "GET, HEAD" } },
      );
    }

    const locale = selectLocale(url.searchParams.get("locale"), request.headers);
    const rows = await this.releases
      .find(
        { published_at: { $lte: new Date() } },
        {
          projection: {
            _id: 1,
            published_at: 1,
            platforms: 1,
            copy: 1,
          },
        },
      )
      .sort({ published_at: -1, _id: -1 })
      .limit(MAX_RELEASES)
      .toArray();
    const releases = rows
      .map((row) => normalizeRelease(row, locale))
      .filter(Boolean);
    const headers = {
      "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      "Content-Language": locale,
      Vary: "Accept-Language",
      "X-Content-Type-Options": "nosniff",
    };

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return Response.json({ locale, releases }, { headers });
  }
}

export function selectLocale(requested, headers) {
  const explicit = normalizeLocale(requested);
  if (explicit) return explicit;
  const preferences = (headers.get("accept-language") || "")
    .split(",")
    .map((entry, index) => {
      const [tag = "", ...parameters] = entry.trim().split(";");
      return { tag, quality: acceptLanguageQuality(parameters), index };
    })
    .filter((entry) => entry.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);
  for (const preference of preferences) {
    const locale = normalizeLocale(preference.tag);
    if (locale) return locale;
  }
  return "en";
}

function acceptLanguageQuality(parameters) {
  const qualityParameter = parameters
    .map((parameter) => parameter.trim())
    .find((parameter) => /^q=/i.test(parameter));
  if (qualityParameter === undefined) return 1;
  const match = qualityParameter.match(
    /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i,
  );
  return match ? Number(match[1]) : 0;
}

function normalizeLocale(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized || normalized === "*") return null;
  if (
    normalized === "zh" ||
    normalized === "zh-cn" ||
    normalized === "zh-hans" ||
    normalized.startsWith("zh-hans-")
  ) {
    return "zh-CN";
  }
  if (normalized.startsWith("zh-")) return null;
  const language = normalized.split("-", 1)[0];
  return RELEASE_NOTE_LOCALES.find((locale) => locale.toLowerCase() === language) || null;
}

function normalizeRelease(row, locale) {
  if (!row || typeof row !== "object") return null;
  const version = cleanText(row._id, 64);
  const publishedAt = dateString(row.published_at);
  const copyKey = locale === "zh-CN" ? "zh" : locale;
  const selectedCopy = [
    { key: copyKey, locale },
    { key: "en", locale: "en" },
    { key: "zh", locale: "zh-CN" },
  ].find((candidate) => row.copy?.[candidate.key]);
  const localized = selectedCopy ? row.copy[selectedCopy.key] : null;
  const title = cleanText(localized?.title, 160);
  const items = Array.isArray(localized?.items)
    ? localized.items
        .map((item) => cleanText(item, 600))
        .filter(Boolean)
        .slice(0, MAX_ITEMS)
    : [];
  if (!version || !publishedAt || !title || items.length === 0) return null;

  const platforms = Array.isArray(row.platforms)
    ? row.platforms
        .map((platform) => cleanText(platform, 24).toLowerCase())
        .filter((platform) => /^(web|server|android|ios|macos|windows)$/.test(platform))
        .slice(0, 6)
    : [];
  return {
    version,
    publishedAt,
    platforms: [...new Set(platforms)],
    locale: selectedCopy.locale,
    title,
    items,
  };
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function dateString(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
