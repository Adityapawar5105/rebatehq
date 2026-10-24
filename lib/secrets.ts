import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const encoded = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Connector secret encryption is not configured.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("CONNECTOR_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

export function encryptSecret(value: string) {
  if (!value || value.length > 20_000) throw new Error("Connector credential is empty or too large.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: process.env.CONNECTOR_ENCRYPTION_KEY_VERSION || "1" };
}

export function decryptSecret(value: { ciphertext: string; nonce: string; authTag: string }): string {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(value.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
