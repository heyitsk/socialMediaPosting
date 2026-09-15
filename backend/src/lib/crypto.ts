import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Maps keyVersion -> encryption key, enabling zero-downtime key rotation
// (see websitePlan.md §7). Add KEY_V2 etc. here when rotating.
const KEYS: Record<number, Buffer> = {
  1: Buffer.from(env.TOKEN_ENCRYPTION_KEY_V1, "base64"),
};

function getKey(keyVersion: number): Buffer {
  const key = KEYS[keyVersion];
  if (!key) {
    throw new Error(`No encryption key configured for keyVersion ${keyVersion}`);
  }
  return key;
}

export function encrypt(plaintext: string, keyVersion = 1): string {
  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(keyVersion), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([nonce, ciphertext, authTag]).toString("base64");
}

export function decrypt(encoded: string, keyVersion = 1): string {
  const packed = Buffer.from(encoded, "base64");
  const nonce = packed.subarray(0, NONCE_LENGTH);
  const authTag = packed.subarray(packed.length - AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(NONCE_LENGTH, packed.length - AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKey(keyVersion), nonce);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
