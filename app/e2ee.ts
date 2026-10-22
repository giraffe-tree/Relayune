export type RelayAad = {
  direction: "web_to_relay" | "relay_to_web";
  type: string;
  device_id: string;
  session_id: string | null;
  request_id: string | null;
  event_seq: number | null;
  created_at: string;
  expires_at: string | null;
};

export type SealedEnvelope = {
  v: 2;
  alg: "A256GCM";
  kid: string;
  iv: string;
  aad: string;
  ciphertext: string;
};

export type RelayKey = {
  cryptoKey: CryptoKey;
  kid: string;
};

export type StoredRelayKey = RelayKey & {
  deviceId: string;
  browserId?: string;
  browserToken?: string;
};

const DATABASE_NAME = "codex-relay-e2ee";
const STORE_NAME = "keys";
const ACTIVE_KEY = "active";
const DEVICE_ID_PATTERN = /^dev_[a-f0-9]{32}$/;
const BROWSER_ID_PATTERN = /^web_[a-f0-9]{32}$/;
const BROWSER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function importRelayKey(encoded: string): Promise<RelayKey> {
  const raw = fromBase64Url(encoded.trim());
  if (raw.byteLength !== 32) {
    throw new Error("配对密钥必须是 32 字节的 base64url 字符串。");
  }
  const rawBuffer = toArrayBuffer(raw);
  const digest = await crypto.subtle.digest("SHA-256", rawBuffer);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawBuffer,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return {
    cryptoKey,
    kid: `sha256:${toBase64Url(new Uint8Array(digest))}`,
  };
}

export async function sealJson<T>(
  key: RelayKey,
  value: T,
  aad: RelayAad,
): Promise<SealedEnvelope> {
  validateAad(aad);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aadBytes = encoder.encode(canonicalJson(aad));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aadBytes),
      tagLength: 128,
    },
    key.cryptoKey,
    toArrayBuffer(encoder.encode(JSON.stringify(value))),
  );
  return {
    v: 2,
    alg: "A256GCM",
    kid: key.kid,
    iv: toBase64Url(iv),
    aad: toBase64Url(aadBytes),
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
  };
}

export async function openJson<T>(
  key: RelayKey,
  envelope: SealedEnvelope,
  expectedAad?: RelayAad,
): Promise<T> {
  validateEnvelope(envelope);
  const envelopeAad = decoder.decode(fromBase64Url(envelope.aad));
  const expectedAadJson = canonicalJson(expectedAad);
  if (
    envelopeAad !== expectedAadJson
  ) {
    throw new Error("密文路由信息与当前请求不匹配。");
  }
  if (envelope.kid !== key.kid) {
    throw new Error("密文使用了另一个配对密钥。");
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(fromBase64Url(envelope.iv)),
        additionalData: toArrayBuffer(encoder.encode(expectedAadJson)),
        tagLength: 128,
      },
      key.cryptoKey,
      toArrayBuffer(fromBase64Url(envelope.ciphertext)),
    );
  } catch {
    throw new Error("密文校验失败；内容或路由信息可能已被篡改。");
  }
  try {
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    throw new Error("解密后的消息不是有效 JSON。");
  }
}

export async function loadStoredRelayKey(): Promise<StoredRelayKey | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openKeyDatabase();
  try {
    return await new Promise<StoredRelayKey | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(ACTIVE_KEY);
      request.onsuccess = () => {
        const stored = request.result as Partial<StoredRelayKey> | undefined;
        resolve(isStoredRelayKey(stored) ? stored : null);
      };
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

export async function storeRelayKey(
  key: RelayKey,
  deviceId: string,
  browserToken?: string,
  browserId?: string,
): Promise<void> {
  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    throw new Error("配对设备编号无效。");
  }
  if (
    (browserToken !== undefined || browserId !== undefined) &&
    (!browserToken ||
      !BROWSER_TOKEN_PATTERN.test(browserToken) ||
      !browserId ||
      !BROWSER_ID_PATTERN.test(browserId))
  ) {
    throw new Error("浏览器授权凭据无效。");
  }
  const database = await openKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(
        {
          ...key,
          deviceId,
          ...(browserToken && browserId ? { browserToken, browserId } : {}),
        } satisfies StoredRelayKey,
        ACTIVE_KEY,
      );
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function clearStoredRelayKey(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(ACTIVE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function validateEnvelope(envelope: SealedEnvelope) {
  if (!envelope || envelope.v !== 2 || envelope.alg !== "A256GCM") {
    throw new Error("不支持的端到端加密协议版本。");
  }
  if (!/^sha256:[A-Za-z0-9_-]{43}$/.test(envelope.kid)) {
    throw new Error("密钥标识无效。");
  }
  if (fromBase64Url(envelope.iv).byteLength !== 12) {
    throw new Error("AES-GCM IV 必须是 12 字节。");
  }
  if (fromBase64Url(envelope.ciphertext).byteLength < 17) {
    throw new Error("密文长度无效。");
  }
  fromBase64Url(envelope.aad);
}

function isStoredRelayKey(
  value: Partial<StoredRelayKey> | undefined,
): value is StoredRelayKey {
  return Boolean(
    value &&
      typeof value.cryptoKey === "object" &&
      value.cryptoKey &&
      typeof value.kid === "string" &&
      /^sha256:[A-Za-z0-9_-]{43}$/.test(value.kid) &&
      typeof value.deviceId === "string" &&
      DEVICE_ID_PATTERN.test(value.deviceId) &&
      ((value.browserId === undefined && value.browserToken === undefined) ||
        (typeof value.browserId === "string" &&
          BROWSER_ID_PATTERN.test(value.browserId) &&
          typeof value.browserToken === "string" &&
          BROWSER_TOKEN_PATTERN.test(value.browserToken))),
  );
}

function validateAad(aad: RelayAad) {
  if (
    !aad ||
    !["web_to_relay", "relay_to_web"].includes(aad.direction) ||
    typeof aad.type !== "string" ||
    !aad.type ||
    typeof aad.device_id !== "string" ||
    !aad.device_id ||
    typeof aad.created_at !== "string"
  ) {
    throw new Error("密文 AAD 路由字段无效。");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("base64url 编码无效。");
  }
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const bytes = atob(padded);
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
