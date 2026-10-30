/**
 * 备份包的加密外壳。
 *
 * 导出时如果设了口令，就把整个 ZIP 用 scrypt + AES-256-GCM 包一层，
 * 因为 ZIP 里带 **明文 API Key**（否则换机器解不开）。
 *
 * 文件格式：Magic(7) | salt(16) | iv(12) | tag(16) | ciphertext
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const MAGIC = Buffer.from("IAENC1\n", "utf8");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export function isEncryptedArchive(bytes: Buffer): boolean {
  return bytes.length > MAGIC.length && bytes.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptArchive(zipBytes: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase.normalize("NFKC"), salt, KEY_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(zipBytes), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

/** 口令不对或文件被改过都会抛错——GCM 的 tag 校验会失败。 */
export function decryptArchive(bytes: Buffer, passphrase: string): Buffer {
  if (!isEncryptedArchive(bytes)) throw new Error("不是加密备份");
  let offset = MAGIC.length;
  const salt = bytes.subarray(offset, (offset += SALT_BYTES));
  const iv = bytes.subarray(offset, (offset += IV_BYTES));
  const tag = bytes.subarray(offset, (offset += TAG_BYTES));
  const ciphertext = bytes.subarray(offset);

  const key = scryptSync(passphrase.normalize("NFKC"), salt, KEY_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error("口令不正确，或备份文件已损坏");
  }
}
