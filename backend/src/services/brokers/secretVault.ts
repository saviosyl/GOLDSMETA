import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { env } from "../../config/env";

/**
 * Encrypts broker credentials for backend-only storage.
 * Plaintext secrets must never be written to logs, iOS, source, or GitHub.
 */
export class BrokerSecretVault {
  constructor(private readonly keyMaterial = process.env.BROKER_SECRETS_ENCRYPTION_KEY ?? "") {}

  isConfigured(): boolean {
    if (env.APP_ENV === "test" || env.APP_ENV === "development") {
      return true;
    }
    return this.keyMaterial.length >= 32;
  }

  encrypt(plaintext: string): string {
    const key = this.deriveKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split(":");
    if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
      throw new Error("Invalid encrypted secret payload");
    }
    const key = this.deriveKey();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final()
    ]).toString("utf8");
  }

  private deriveKey(): Buffer {
    const material =
      this.keyMaterial.length >= 32
        ? this.keyMaterial
        : "goldmeta-dev-only-broker-secret-key!!";
    return createHash("sha256").update(material).digest();
  }
}

export const brokerSecretVault = new BrokerSecretVault();
