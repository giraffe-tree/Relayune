const P256_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
);
const P256_SCALAR_LENGTH = 32;
const P256_POINT_LENGTH = 65;
const BIGINT_ZERO = BigInt(0);
const BIGINT_EIGHT = BigInt(8);
const BIGINT_BYTE_MASK = BigInt(0xff);
const RFC9382_M =
  "02886e2f97ace46e55ba9dd7242579f2993b64e16ef3dcab95afd497333d8fa12f";
const RFC9382_N =
  "03d8bbd6c639c62937b04d997f38c3770719c629d7014d49a24b4f98baa1292b49";
const CONFIRMATION_LABEL = new TextEncoder().encode("ConfirmationKeys");
const EMPTY = new Uint8Array();

let primitivesPromise: ReturnType<typeof loadPrimitivesUncached> | undefined;

export type Spake2Role = "A" | "B";

export type Spake2P256Output = {
  sessionKey: Uint8Array;
  ownConfirmation: Uint8Array;
  expectedPeerConfirmation: Uint8Array;
  transcript: Uint8Array;
};

export async function createSpake2P256Share(
  role: Spake2Role,
  passwordScalar: Uint8Array,
  ephemeralScalar: Uint8Array,
): Promise<Uint8Array> {
  const { p256 } = await loadPrimitives();
  const w = requireScalar(passwordScalar, "password scalar");
  const ephemeral = requireScalar(ephemeralScalar, "ephemeral scalar");
  const mask = p256.Point.fromHex(role === "A" ? RFC9382_M : RFC9382_N);
  const share = p256.Point.BASE.multiply(ephemeral).add(mask.multiply(w));
  share.assertValidity();
  if (share.is0()) throw new Error("SPAKE2 公开 share 不能是单位元。");
  return share.toBytes(false);
}

export async function finishSpake2P256(input: {
  role: Spake2Role;
  passwordScalar: Uint8Array;
  ephemeralScalar: Uint8Array;
  ownShare: Uint8Array;
  peerShare: Uint8Array;
  identityA: Uint8Array;
  identityB: Uint8Array;
  aad?: Uint8Array;
}): Promise<Spake2P256Output> {
  const { p256, sha256, hkdf, hmac } = await loadPrimitives();
  const w = requireScalar(input.passwordScalar, "password scalar");
  const ephemeral = requireScalar(input.ephemeralScalar, "ephemeral scalar");
  const ownShare = decodePoint(p256, input.ownShare);
  const peerShare = decodePoint(p256, input.peerShare);
  const expectedOwnShare = await createSpake2P256Share(
    input.role,
    input.passwordScalar,
    input.ephemeralScalar,
  );
  if (!constantTimeEqual(expectedOwnShare, input.ownShare)) {
    throw new Error("SPAKE2 本地状态与公开 share 不一致。");
  }

  const peerMask = p256.Point.fromHex(
    input.role === "A" ? RFC9382_N : RFC9382_M,
  );
  const sharedPoint = peerShare.subtract(peerMask.multiply(w)).multiply(ephemeral);
  sharedPoint.assertValidity();
  if (sharedPoint.is0()) throw new Error("SPAKE2 共享点不能是单位元。");

  const pA = input.role === "A" ? ownShare : peerShare;
  const pB = input.role === "B" ? ownShare : peerShare;
  const transcript = concatenate(
    lengthValue(input.identityA),
    lengthValue(input.identityB),
    lengthValue(pA.toBytes(false)),
    lengthValue(pB.toBytes(false)),
    lengthValue(sharedPoint.toBytes(false)),
    lengthValue(input.passwordScalar),
  );
  const transcriptHash = sha256(transcript);
  const sessionKey = transcriptHash.slice(0, 16);
  const authenticationKey = transcriptHash.slice(16, 32);
  const confirmationKeys = hkdf(
    sha256,
    authenticationKey,
    EMPTY,
    concatenate(CONFIRMATION_LABEL, input.aad ?? EMPTY),
    32,
  );
  const confirmationA = hmac(
    sha256,
    confirmationKeys.slice(0, 16),
    transcript,
  );
  const confirmationB = hmac(
    sha256,
    confirmationKeys.slice(16, 32),
    transcript,
  );
  try {
    return {
      sessionKey,
      ownConfirmation: input.role === "A" ? confirmationA : confirmationB,
      expectedPeerConfirmation:
        input.role === "A" ? confirmationB : confirmationA,
      transcript,
    };
  } finally {
    authenticationKey.fill(0);
    confirmationKeys.fill(0);
    transcriptHash.fill(0);
    expectedOwnShare.fill(0);
  }
}

export async function deriveScryptP256Scalar(
  password: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const { scryptAsync } = await loadPrimitives();
  const stretched = await scryptAsync(password, salt, {
    N: 1 << 15,
    r: 8,
    p: 1,
    dkLen: 40,
    maxmem: 64 * 1024 * 1024,
  });
  try {
    const scalar = bytesToBigInt(stretched) % P256_ORDER;
    if (scalar === BIGINT_ZERO) throw new Error("SPAKE2 口令标量不能为零。");
    return bigIntToBytes(scalar, P256_SCALAR_LENGTH);
  } finally {
    stretched.fill(0);
  }
}

export async function deriveSpake2ApplicationKey(
  sessionKey: Uint8Array,
  info: Uint8Array,
  length = 32,
): Promise<Uint8Array> {
  if (sessionKey.byteLength !== 16) {
    throw new Error("SPAKE2 会话密钥长度无效。");
  }
  const { sha256, hkdf } = await loadPrimitives();
  return hkdf(sha256, sessionKey, EMPTY, info, length);
}

export function randomP256Scalar(): Uint8Array {
  for (let attempts = 0; attempts < 128; attempts += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(P256_SCALAR_LENGTH));
    const scalar = bytesToBigInt(bytes);
    if (scalar > BIGINT_ZERO && scalar < P256_ORDER) return bytes;
    bytes.fill(0);
  }
  throw new Error("无法生成有效的 P-256 随机标量。");
}

function loadPrimitives() {
  primitivesPromise ??= loadPrimitivesUncached();
  return primitivesPromise;
}

async function loadPrimitivesUncached() {
  const [{ p256 }, { sha256 }, { hkdf }, { hmac }, { scryptAsync }] =
    await Promise.all([
      import("@noble/curves/nist.js"),
      import("@noble/hashes/sha2.js"),
      import("@noble/hashes/hkdf.js"),
      import("@noble/hashes/hmac.js"),
      import("@noble/hashes/scrypt.js"),
    ]);
  return { p256, sha256, hkdf, hmac, scryptAsync };
}

function decodePoint(
  p256: Awaited<ReturnType<typeof loadPrimitives>>["p256"],
  encoded: Uint8Array,
) {
  if (encoded.byteLength !== P256_POINT_LENGTH || encoded[0] !== 0x04) {
    throw new Error("SPAKE2 P-256 share 必须使用 65 字节 SEC1 非压缩编码。");
  }
  try {
    const point = p256.Point.fromBytes(encoded);
    point.assertValidity();
    if (point.is0()) throw new Error("identity point");
    return point;
  } catch {
    throw new Error("SPAKE2 P-256 share 不是有效曲线点。");
  }
}

function requireScalar(bytes: Uint8Array, label: string): bigint {
  if (bytes.byteLength !== P256_SCALAR_LENGTH) {
    throw new Error(`SPAKE2 ${label} 必须是 32 字节。`);
  }
  const scalar = bytesToBigInt(bytes);
  if (scalar <= BIGINT_ZERO || scalar >= P256_ORDER) {
    throw new Error(`SPAKE2 ${label} 超出 P-256 标量范围。`);
  }
  return scalar;
}

function lengthValue(value: Uint8Array): Uint8Array {
  const length = new Uint8Array(8);
  let remaining = BigInt(value.byteLength);
  for (let index = 0; index < length.byteLength; index += 1) {
    length[index] = Number(remaining & BIGINT_BYTE_MASK);
    remaining >>= BIGINT_EIGHT;
  }
  return concatenate(length, value);
}

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = BIGINT_ZERO;
  for (const byte of bytes) {
    result = (result << BIGINT_EIGHT) | BigInt(byte);
  }
  return result;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    result[index] = Number(remaining & BIGINT_BYTE_MASK);
    remaining >>= BIGINT_EIGHT;
  }
  if (remaining !== BIGINT_ZERO) throw new Error("整数无法编码到指定长度。");
  return result;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left[index % left.byteLength] ?? 0) ^
      (right[index % right.byteLength] ?? 0);
  }
  return difference === 0;
}
