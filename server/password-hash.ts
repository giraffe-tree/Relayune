import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

type PasswordDocument = { [key: string]: unknown };
export async function passwordRecord(password: string) {
  const passwordSalt = randomBytes(16).toString("base64url");
  return { password_algorithm: "scrypt-v1", password_salt: passwordSalt,
    password_hash: (await derivePassword(password, passwordSalt)).toString("base64url"), password_set_at: new Date() };
}
export function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
}
export async function verifyPassword(password: string, document: PasswordDocument | null) {
  const hasPassword = document?.password_algorithm === "scrypt-v1" &&
    typeof document.password_salt === "string" && typeof document.password_hash === "string";
  const salt = hasPassword ? document!.password_salt as string : "AAAAAAAAAAAAAAAAAAAAAA";
  const expected = hasPassword ? Buffer.from(document!.password_hash as string, "base64url") : Buffer.alloc(32);
  const actual = await derivePassword(password, salt);
  return expected.length === actual.length && timingSafeEqual(expected, actual) && hasPassword;
}
