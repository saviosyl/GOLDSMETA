/**
 * Micro-specific AES-256-GCM envelope encryption for OAuth tokens.
 * Key env: MICRO_CTRADER_ + TOKEN_ENCRYPTION_KEY (never commit the value).
 * Does NOT import Core broker/ctrader token crypto.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

export type MicroEncryptedBlob = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
};

const KEY_VERSION = "v1";
const MICRO_TOKEN_KEY_ENV = "MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY";

export class MicroTokenCrypto {
  constructor(
    private readonly keyMaterial = process.env[MICRO_TOKEN_KEY_ENV] ?? ""
  ) {}

  isConfigured(): boolean {
    const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
    if (env === "test" || env === "development") return true;
    return this.keyMaterial.length >= 32;
  }

  encrypt(plaintext: string): MicroEncryptedBlob {
    if (!plaintext) {
      throw new Error("MICRO_TOKEN_CRYPTO_EMPTY_PLAINTEXT");
    }
    const key = this.deriveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: tag.toString("base64"),
      keyVersion: KEY_VERSION
    };
  }

  decrypt(blob: MicroEncryptedBlob): string {
    if (!blob || blob.keyVersion !== KEY_VERSION) {
      throw new Error("MICRO_TOKEN_CRYPTO_UNSUPPORTED_VERSION");
    }
    if (!blob.ciphertext || !blob.iv || !blob.authTag) {
      throw new Error("MICRO_TOKEN_CRYPTO_MALFORMED");
    }
    const key = this.deriveKey();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(blob.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(blob.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  }

  private deriveKey(): Buffer {
    const material =
      this.keyMaterial.length >= 32
        ? this.keyMaterial
        : "goldmeta-dev-only-micro-token-key!!!!";
    return createHash("sha256").update(material).digest();
  }
}

export const microTokenCrypto = new MicroTokenCrypto();
