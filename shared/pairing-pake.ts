import {
  createSpake2P256Share,
  deriveScryptP256Scalar,
  deriveSpake2ApplicationKey,
  finishSpake2P256,
  randomP256Scalar,
} from "./spake2-p256";

export const PAIRING_PROTOCOL = "SPAKE2-P256-SHA256-HKDF-HMAC";
export const PAIRING_ID_PATTERN = /^pair_[A-Za-z0-9_-]{43}$/;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const SHARE_LENGTH = 65;
const encoder = new TextEncoder();
const PAKE_AAD = encoder.encode(PAIRING_PROTOCOL);
const CONTENT_KEY_INFO = encoder.encode("relayune/a256gcm-content-key/v2");

export type PairingPublicState = {
  pairing_id: string;
  protocol: typeof PAIRING_PROTOCOL;
  mode: "initial" | "browser";
  initiator_share: string;
  responder_share: string | null;
  responder_confirm: string | null;
  desktop_confirm: string | null;
  device_id: string | null;
  browser_id: string | null;
  status: "waiting" | "responded" | "paired";
  expires_at: string;
};

export type PairingInitiator = {
  pairingId: string;
  code: string;
  initiatorShare: string;
  ephemeralSecret: Uint8Array;
};

export type PairingResponderResult = {
  responderShare: string;
  responderConfirm: string;
  expectedDesktopConfirm: string;
  contentKey: string;
};

export type PairingInitiatorResult = {
  desktopConfirm: string;
  contentKey: string;
};

export async function createPairingInitiator(): Promise<PairingInitiator> {
  const pairingId = `pair_${toBase64Url(
    crypto.getRandomValues(new Uint8Array(32)),
  )}`;
  const code = generateShortCode();
  const ephemeralSecret = randomP256Scalar();
  const passwordScalar = await pairingPasswordScalar(pairingId, code);
  try {
    const share = await createSpake2P256Share(
      "A",
      passwordScalar,
      ephemeralSecret,
    );
    return {
      pairingId,
      code: formatPairingCode(code),
      initiatorShare: toBase64Url(share),
      ephemeralSecret,
    };
  } catch (error) {
    ephemeralSecret.fill(0);
    throw error;
  } finally {
    passwordScalar.fill(0);
  }
}

export async function respondToPairing(
  pairingId: string,
  code: string,
  initiatorShare: string,
): Promise<PairingResponderResult> {
  requirePairingId(pairingId);
  const initiatorBytes = fromBase64Url(initiatorShare, SHARE_LENGTH);
  const passwordScalar = await pairingPasswordScalar(pairingId, code);
  const ephemeralSecret = randomP256Scalar();
  let sessionKey: Uint8Array | null = null;
  try {
    const responderBytes = await createSpake2P256Share(
      "B",
      passwordScalar,
      ephemeralSecret,
    );
    const output = await finishSpake2P256({
      role: "B",
      passwordScalar,
      ephemeralScalar: ephemeralSecret,
      ownShare: responderBytes,
      peerShare: initiatorBytes,
      ...pairingIdentities(pairingId),
      aad: PAKE_AAD,
    });
    sessionKey = output.sessionKey;
    const contentKey = await deriveSpake2ApplicationKey(
      sessionKey,
      CONTENT_KEY_INFO,
    );
    try {
      return {
        responderShare: toBase64Url(responderBytes),
        responderConfirm: toBase64Url(output.ownConfirmation),
        expectedDesktopConfirm: toBase64Url(
          output.expectedPeerConfirmation,
        ),
        contentKey: toBase64Url(contentKey),
      };
    } finally {
      contentKey.fill(0);
      output.ownConfirmation.fill(0);
      output.expectedPeerConfirmation.fill(0);
      output.transcript.fill(0);
      responderBytes.fill(0);
    }
  } finally {
    initiatorBytes.fill(0);
    passwordScalar.fill(0);
    ephemeralSecret.fill(0);
    sessionKey?.fill(0);
  }
}

export async function finishPairingInitiator(
  state: PairingInitiator,
  responderShare: string,
  responderConfirm: string,
): Promise<PairingInitiatorResult> {
  requirePairingId(state.pairingId);
  const initiatorBytes = fromBase64Url(state.initiatorShare, SHARE_LENGTH);
  const responderBytes = fromBase64Url(responderShare, SHARE_LENGTH);
  const passwordScalar = await pairingPasswordScalar(
    state.pairingId,
    state.code,
  );
  let sessionKey: Uint8Array | null = null;
  try {
    const output = await finishSpake2P256({
      role: "A",
      passwordScalar,
      ephemeralScalar: state.ephemeralSecret,
      ownShare: initiatorBytes,
      peerShare: responderBytes,
      ...pairingIdentities(state.pairingId),
      aad: PAKE_AAD,
    });
    sessionKey = output.sessionKey;
    if (
      !constantTimeEqual(
        toBase64Url(output.expectedPeerConfirmation),
        responderConfirm,
      )
    ) {
      throw new Error("连接码不正确，或安全握手被中途修改。");
    }
    const contentKey = await deriveSpake2ApplicationKey(
      sessionKey,
      CONTENT_KEY_INFO,
    );
    try {
      return {
        desktopConfirm: toBase64Url(output.ownConfirmation),
        contentKey: toBase64Url(contentKey),
      };
    } finally {
      contentKey.fill(0);
      output.ownConfirmation.fill(0);
      output.expectedPeerConfirmation.fill(0);
      output.transcript.fill(0);
    }
  } finally {
    initiatorBytes.fill(0);
    responderBytes.fill(0);
    passwordScalar.fill(0);
    state.ephemeralSecret.fill(0);
    sessionKey?.fill(0);
  }
}

export function verifyDesktopConfirmation(
  expected: string,
  received: string | null,
) {
  if (!received || !constantTimeEqual(expected, received)) {
    throw new Error("电脑未通过加密确认，请重新连接。");
  }
}

export function normalizePairingCode(value: string): string {
  const normalized = value.toUpperCase().replace(/[\s-]/g, "");
  if (
    normalized.length !== CODE_LENGTH ||
    [...normalized].some((character) => !CODE_ALPHABET.includes(character))
  ) {
    throw new Error("请输入桌面端显示的 8 位连接码。");
  }
  return normalized;
}

export function formatPairingCode(value: string): string {
  const normalized = normalizePairingCode(value);
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

export function pairingCodeInput(value: string): string {
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, CODE_LENGTH);
  return normalized.length > 4
    ? `${normalized.slice(0, 4)}-${normalized.slice(4)}`
    : normalized;
}

export function randomRelayToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pairingPasswordScalar(pairingId: string, code: string) {
  requirePairingId(pairingId);
  const normalizedCode = normalizePairingCode(code);
  return deriveScryptP256Scalar(
    encoder.encode(normalizedCode),
    encoder.encode(`relayune/spake2-p256/scrypt/v1\u0000${pairingId}`),
  );
}

function pairingIdentities(pairingId: string) {
  return {
    identityA: encoder.encode(`relayune/desktop\u0000${pairingId}`),
    identityB: encoder.encode(`relayune/client\u0000${pairingId}`),
  };
}

function generateShortCode(): string {
  let result = "";
  while (result.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    for (const byte of bytes) {
      if (byte >= CODE_ALPHABET.length * 8) continue;
      result += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (result.length === CODE_LENGTH) break;
    }
  }
  return result;
}

function requirePairingId(value: string) {
  if (!PAIRING_ID_PATTERN.test(value)) {
    throw new Error("安全连接会话无效，请在桌面端重新开始。");
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (leftBytes[index % leftBytes.length] ?? 0) ^
      (rightBytes[index % rightBytes.length] ?? 0);
  }
  return difference === 0;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string, expectedLength: number): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("安全握手消息格式无效。");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) =>
    character.charCodeAt(0),
  );
  if (bytes.byteLength !== expectedLength) {
    throw new Error("安全握手消息长度无效。");
  }
  return bytes;
}
