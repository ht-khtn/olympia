import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

const SCRYPT_KEY_LENGTH = 32;

function getPepper(): string {
  const pepper = process.env.OLYMPIA_PASSWORD_PEPPER;
  if (!pepper) throw new Error("OLYMPIA_PASSWORD_PEPPER chưa được cấu hình.");
  return pepper;
}

function getEncryptionKey(): Buffer {
  const raw = process.env.OLYMPIA_CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) throw new Error("OLYMPIA_CREDENTIAL_ENCRYPTION_KEY chưa được cấu hình.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("OLYMPIA_CREDENTIAL_ENCRYPTION_KEY không hợp lệ.");
  return key;
}

export function generateRoomPassword(): string {
  return randomBytes(12).toString("base64url");
}

export function hashRoomPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(`${password}\u0000${getPepper()}`, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyRoomPassword(stored: string | null | undefined, password: string): boolean {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, saltText, hashText] = stored.split("$");
  if (!saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = scryptSync(`${password}\u0000${getPepper()}`, Buffer.from(saltText, "base64url"), SCRYPT_KEY_LENGTH);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function encryptCurrentRoomPassword(password: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptCurrentRoomPassword(ciphertext: string | null | undefined): string {
  if (!ciphertext) throw new Error("Không có mật khẩu phòng được mã hóa.");
  const [ivText, tagText, dataText] = ciphertext.split(".");
  if (!ivText || !tagText || !dataText) throw new Error("Dữ liệu mật khẩu phòng không hợp lệ.");
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataText, "base64url")), decipher.final()]).toString("utf8");
}
