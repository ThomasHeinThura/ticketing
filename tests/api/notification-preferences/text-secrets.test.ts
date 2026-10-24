import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  reencryptSecret,
} from "../../../apps/api/src/notification-preferences/secrets";

const currentName = "TASKDESK_ENCRYPTION_KEY";
const previousName = "TASKDESK_ENCRYPTION_KEY_PREVIOUS";
const originalCurrent = process.env[currentName];
const originalPrevious = process.env[previousName];
const oldKey = "11".repeat(32);
const newKey = "22".repeat(32);

afterEach(() => {
  if (originalCurrent === undefined) delete process.env[currentName];
  else process.env[currentName] = originalCurrent;
  if (originalPrevious === undefined) delete process.env[previousName];
  else process.env[previousName] = originalPrevious;
});

/** The pre-P4-fix single-key format, to prove stored v1 values stay readable. */
function legacyEnvelope(plaintext: string, rawKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(rawKey).digest(),
    iv,
  );
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return `enc:v1:${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

describe("GM-12 text secrets survive key rotation", () => {
  it("writes the key-id envelope and reads it under the previous key after rotation", () => {
    process.env[currentName] = oldKey;
    delete process.env[previousName];
    const stored = encryptSecret("whsec_signing") as string;
    expect(stored.startsWith("enc:v2:")).toBe(true);

    process.env[currentName] = newKey;
    process.env[previousName] = oldKey;
    expect(decryptSecret(stored)).toBe("whsec_signing");
  });

  it("reads a legacy enc:v1 value under the previous key", () => {
    const legacy = legacyEnvelope("ntfy-token", oldKey);
    process.env[currentName] = newKey;
    process.env[previousName] = oldKey;
    expect(decryptSecret(legacy)).toBe("ntfy-token");
  });

  it("reencryptSecret moves a value to the current key and it then needs no previous key", () => {
    process.env[currentName] = oldKey;
    delete process.env[previousName];
    const stored = encryptSecret("whsec_signing") as string;

    process.env[currentName] = newKey;
    process.env[previousName] = oldKey;
    const next = reencryptSecret(stored);
    expect(next).not.toBe(stored);

    delete process.env[previousName];
    expect(decryptSecret(next)).toBe("whsec_signing");
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("fails when neither configured key can read the value", () => {
    process.env[currentName] = oldKey;
    delete process.env[previousName];
    const stored = encryptSecret("x-secret") as string;
    process.env[currentName] = newKey;
    delete process.env[previousName];
    expect(() => decryptSecret(stored)).toThrow();
  });
});
