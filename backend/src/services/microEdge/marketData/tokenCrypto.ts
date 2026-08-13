/**
 * Micro-specific AES-256-GCM envelope encryption for OAuth tokens.
 * Key env: MICRO_CTRADER_ + TOKEN_ENCRYPTION_KEY (never commit the value).
 * Does NOT import Core broker/ctrader token crypto.
 *
 * Deployed mode: key REQUIRED (≥32 chars). No ephemeral production key.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { isDeployedMicroRuntime } from "./storageMode";

export type MicroEncryptedBlob = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: string;
};

export const MICRO_TOKEN_KEY_VERSION = "v1";
const MICRO_TOKEN_KEY_ENV = "MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY";

export class MicroTokenCrypto {
  constructor(
    private readonly keyMaterial = process.env[MICRO_TOKEN_KEY_ENV] ?? ""
  ) {}

  /** Soft check for local/test convenience. */
  isConfigured(): boolean {
    if (!isDeployedMicroRuntime()) {
      const env = (process.env.APP_ENV ?? process.env.NODE_ENV ?? "").toLowerCase();
      if (env === "test" || env === "development") return true;
    }
    return this.isConfiguredForDeployed();
  }

  /** Strict deployed check — no ephemeral fallback. */
  isConfiguredForDeployed(): boolean {
    return this.keyMaterial.trim().length >= 32;
  }

  encrypt(plaintext: string): MicroEncryptedBlob {
    if (!plaintext) {
      throw new Error("MICRO_TOKEN_CRYPTO_EMPTY_PLAINTEXT");
    }
    const key = this.deriveKey(true);
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
      keyVersion: MICRO_TOKEN_KEY_VERSION
    };
  }

  decrypt(blob: MicroEncryptedBlob): string {
    if (!blob || blob.keyVersion !== MICRO_TOKEN_KEY_VERSION) {
      throw new Error("MICRO_TOKEN_CRYPTO_UNSUPPORTED_VERSION");
    }
    if (!blob.ciphertext || !blob.iv || !blob.authTag) {
      throw new Error("MICRO_TOKEN_CRYPTO_MALFORMED");
    }
    const key = this.deriveKey(true);
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

  private deriveKey(requireConfigured: boolean): Buffer {
    const material = this.keyMaterial.trim();
    if (material.length >= 32) {
      return createHash("sha256").update(material).digest();
    }
    if (requireConfigured && isDeployedMicroRuntime()) {
      throw Object.assign(new Error("MICRO_ENCRYPTION_KEY_MISSING"), {
        code: "MICRO_ENCRYPTION_KEY_MISSING"
      });
    }
    // Local/test only ephemeral material — never used in deployed runtime.
    return createHash("sha256")
      .update("goldmeta-dev-only-micro-token-key!!!!")
      .digest();
  }
}

export const microTokenCrypto = new MicroTokenCrypto();
