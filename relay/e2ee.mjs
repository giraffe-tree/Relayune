import {
  createHash,
  randomBytes,
  timingSafeEqual,
  webcrypto,
} from "node:crypto";

const { subtle } = webcrypto;

const ENVELOPE_VERSION = 2;
const ENVELOPE_ALGORITHM = "A256GCM";
const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BITS = 128;
const GCM_TAG_BYTES = GCM_TAG_BITS / 8;
const ENVELOPE_FIELDS = [
  "aad",
  "alg",
  "ciphertext",
  "iv",
  "kid",
  "v",
];
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const KEY_ID_PATTERN = /^sha256:[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function generateE2eeKey() {
  return randomBytes(AES_KEY_BYTES).toString("base64url");
}

export async function importE2eeKey(
  base64url,
  usage = ["encrypt", "decrypt"],
) {
  const rawKey = decodeBase64Url(base64url, "E2EE key");
  assertByteLength(rawKey, AES_KEY_BYTES, "E2EE key");

  return subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM", length: AES_KEY_BYTES * 8 },
    true,
    normalizeKeyUsages(usage),
  );
}

export async function keyIdForKey(keyOrRaw) {
  const rawKey = await exportOrDecodeKey(keyOrRaw);
  const digest = createHash("sha256").update(rawKey).digest("base64url");
  return `sha256:${digest}`;
}

export async function sealJson(keyOrRaw, plaintext, aad) {
  const aadBytes = encodeCanonicalAad(aad);
  const plaintextBytes = encodePlaintext(plaintext);
  const { key, kid } = await resolveKey(keyOrRaw, "encrypt");
  const iv = randomBytes(GCM_IV_BYTES);
  const ciphertext = Buffer.from(
    await subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: aadBytes,
        tagLength: GCM_TAG_BITS,
      },
      key,
      plaintextBytes,
    ),
  );

  return {
    v: ENVELOPE_VERSION,
    alg: ENVELOPE_ALGORITHM,
    kid,
    iv: iv.toString("base64url"),
    aad: Buffer.from(aadBytes).toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export async function openJson(keyOrRaw, envelope, expectedAad) {
  const parsedEnvelope = validateEnvelope(envelope);
  const expectedAadBytes = encodeCanonicalAad(expectedAad);
  const envelopeAadBytes = decodeBase64Url(parsedEnvelope.aad, "Envelope AAD");

  if (!equalBytes(envelopeAadBytes, expectedAadBytes)) {
    throw new Error("E2EE envelope AAD does not match the expected AAD.");
  }

  const { key, kid } = await resolveKey(keyOrRaw, "decrypt");
  if (!equalStrings(parsedEnvelope.kid, kid)) {
    throw new Error("E2EE envelope key id does not match the supplied key.");
  }

  const iv = decodeBase64Url(parsedEnvelope.iv, "Envelope IV");
  const ciphertext = decodeBase64Url(
    parsedEnvelope.ciphertext,
    "Envelope ciphertext",
  );

  let plaintextBytes;
  try {
    plaintextBytes = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: expectedAadBytes,
        tagLength: GCM_TAG_BITS,
      },
      key,
      ciphertext,
    );
  } catch {
    throw new Error("E2EE envelope authentication failed.");
  }

  let serialized;
  try {
    serialized = decoder.decode(plaintextBytes);
  } catch {
    throw new Error("E2EE plaintext is not valid UTF-8.");
  }

  try {
    return JSON.parse(serialized);
  } catch {
    throw new Error("E2EE plaintext is not valid JSON.");
  }
}

async function resolveKey(keyOrRaw, requiredUsage) {
  if (isCryptoKey(keyOrRaw)) {
    validateCryptoKey(keyOrRaw, requiredUsage);
    return {
      key: keyOrRaw,
      kid: await keyIdForKey(keyOrRaw),
    };
  }

  const rawKey = normalizeRawKey(keyOrRaw);
  return {
    key: await subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: AES_KEY_BYTES * 8 },
      true,
      [requiredUsage],
    ),
    kid: await keyIdForKey(rawKey),
  };
}

async function exportOrDecodeKey(keyOrRaw) {
  if (isCryptoKey(keyOrRaw)) {
    validateCryptoKey(keyOrRaw);
    if (!keyOrRaw.extractable) {
      throw new Error(
        "E2EE CryptoKey must be extractable to derive its stable key id.",
      );
    }
    return Buffer.from(await subtle.exportKey("raw", keyOrRaw));
  }
  return normalizeRawKey(keyOrRaw);
}

function normalizeRawKey(keyOrRaw) {
  let rawKey;
  if (typeof keyOrRaw === "string") {
    rawKey = decodeBase64Url(keyOrRaw, "E2EE key");
  } else if (keyOrRaw instanceof ArrayBuffer) {
    rawKey = Buffer.from(keyOrRaw);
  } else if (ArrayBuffer.isView(keyOrRaw)) {
    rawKey = Buffer.from(
      keyOrRaw.buffer,
      keyOrRaw.byteOffset,
      keyOrRaw.byteLength,
    );
  } else {
    throw new TypeError(
      "E2EE key must be a base64url string, byte array, ArrayBuffer, or CryptoKey.",
    );
  }

  assertByteLength(rawKey, AES_KEY_BYTES, "E2EE key");
  return rawKey;
}

function normalizeKeyUsages(usage) {
  const usages =
    typeof usage === "string"
      ? [usage]
      : Array.isArray(usage)
        ? [...usage]
        : null;

  if (
    !usages ||
    usages.length === 0 ||
    usages.some((candidate) => !["encrypt", "decrypt"].includes(candidate)) ||
    new Set(usages).size !== usages.length
  ) {
    throw new TypeError(
      'E2EE key usage must be "encrypt", "decrypt", or a unique non-empty array of those values.',
    );
  }
  return usages;
}

function validateCryptoKey(key, requiredUsage = null) {
  if (
    key.type !== "secret" ||
    key.algorithm?.name !== "AES-GCM" ||
    key.algorithm?.length !== AES_KEY_BYTES * 8
  ) {
    throw new TypeError("E2EE CryptoKey must be a 256-bit AES-GCM secret key.");
  }
  if (requiredUsage && !key.usages.includes(requiredUsage)) {
    throw new TypeError(
      `E2EE CryptoKey does not permit the required ${requiredUsage} operation.`,
    );
  }
}

function validateEnvelope(envelope) {
  if (!isPlainObject(envelope)) {
    throw new TypeError("E2EE envelope must be a plain object.");
  }

  const fields = Object.keys(envelope).sort();
  if (
    fields.length !== ENVELOPE_FIELDS.length ||
    fields.some((field, index) => field !== ENVELOPE_FIELDS[index])
  ) {
    throw new Error("E2EE envelope has missing or unsupported fields.");
  }
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`Unsupported E2EE envelope version: ${String(envelope.v)}.`);
  }
  if (envelope.alg !== ENVELOPE_ALGORITHM) {
    throw new Error(`Unsupported E2EE envelope algorithm: ${String(envelope.alg)}.`);
  }
  if (typeof envelope.kid !== "string" || !KEY_ID_PATTERN.test(envelope.kid)) {
    throw new Error("E2EE envelope has an invalid key id.");
  }
  if (typeof envelope.iv !== "string") {
    throw new Error("E2EE envelope has an invalid IV.");
  }
  const iv = decodeBase64Url(envelope.iv, "Envelope IV");
  assertByteLength(iv, GCM_IV_BYTES, "Envelope IV");

  if (typeof envelope.aad !== "string") {
    throw new Error("E2EE envelope has invalid AAD.");
  }
  decodeBase64Url(envelope.aad, "Envelope AAD");

  if (typeof envelope.ciphertext !== "string") {
    throw new Error("E2EE envelope has invalid ciphertext.");
  }
  const ciphertext = decodeBase64Url(
    envelope.ciphertext,
    "Envelope ciphertext",
  );
  if (ciphertext.byteLength < GCM_TAG_BYTES) {
    throw new Error("E2EE envelope ciphertext is shorter than its GCM tag.");
  }

  return envelope;
}

function encodeCanonicalAad(aad) {
  if (aad === undefined) {
    throw new TypeError("E2EE AAD must be an explicit JSON value.");
  }
  return encoder.encode(canonicalJson(aad, new Set()));
}

function canonicalJson(value, ancestors) {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("E2EE AAD cannot contain a non-finite number.");
      }
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`E2EE AAD contains unsupported ${typeof value} data.`);
  }

  if (ancestors.has(value)) {
    throw new TypeError("E2EE AAD cannot contain a cyclic reference.");
  }
  ancestors.add(value);

  let serialized;
  if (Array.isArray(value)) {
    if (Object.keys(value).some((key) => !/^(0|[1-9]\d*)$/.test(key))) {
      throw new TypeError("E2EE AAD arrays cannot contain named properties.");
    }
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError("E2EE AAD arrays cannot contain holes.");
      }
      items.push(canonicalJson(value[index], ancestors));
    }
    serialized = `[${items.join(",")}]`;
  } else {
    if (!isPlainObject(value)) {
      throw new TypeError(
        "E2EE AAD objects must have Object.prototype or a null prototype.",
      );
    }
    serialized = `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key], ancestors)}`,
      )
      .join(",")}}`;
  }

  ancestors.delete(value);
  return serialized;
}

function encodePlaintext(plaintext) {
  let serialized;
  try {
    serialized = JSON.stringify(plaintext);
  } catch {
    throw new TypeError("E2EE plaintext must be JSON-serializable.");
  }
  if (serialized === undefined) {
    throw new TypeError("E2EE plaintext must be an explicit JSON value.");
  }
  return encoder.encode(serialized);
}

function decodeBase64Url(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new Error(`${label} must be unpadded base64url.`);
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error(`${label} is not canonical base64url.`);
  }
  return decoded;
}

function assertByteLength(value, expected, label) {
  if (value.byteLength !== expected) {
    throw new Error(`${label} must be exactly ${expected} bytes.`);
  }
}

function isCryptoKey(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.constructor?.name === "CryptoKey" &&
    Array.isArray(value.usages)
  );
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function equalBytes(left, right) {
  return (
    left.byteLength === right.byteLength &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

function equalStrings(left, right) {
  return equalBytes(encoder.encode(left), encoder.encode(right));
}
