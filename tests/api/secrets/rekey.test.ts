import { afterEach, describe, expect, it } from "vitest";
import {
  currentEncryptionKeyId,
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
  envelopeKeyId,
  previousEncryptionKeyConfigured,
} from "../../../apps/api/src/identity/client-secret";
import { rekeyEnvelope } from "../../../apps/api/src/secrets/rekey";

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

describe("GM-12..GM-14 secrets re-encryption", () => {
  it("rewrites an envelope written under the previous key under the current key", () => {
    process.env[currentName] = oldKey;
    delete process.env[previousName];
    const legacy = encryptIdentityClientSecret("row-1", "plugin-credential");
    const oldId = envelopeKeyId(legacy);

    process.env[currentName] = newKey;
    process.env[previousName] = oldKey;
    const next = rekeyEnvelope("row-1", legacy);

    expect(envelopeKeyId(next)).toBe(currentEncryptionKeyId());
    expect(envelopeKeyId(next)).not.toBe(oldId);
    expect(decryptIdentityClientSecret("row-1", next)).toBe(
      "plugin-credential",
    );
  });

  it("keeps each envelope bound to its own row", () => {
    process.env[currentName] = oldKey;
    delete process.env[previousName];
    const legacy = encryptIdentityClientSecret("row-1", "value");
    process.env[currentName] = newKey;
    process.env[previousName] = oldKey;
    expect(() => rekeyEnvelope("row-2", legacy)).toThrow();
    const next = rekeyEnvelope("row-1", legacy);
    expect(() => decryptIdentityClientSecret("row-2", next)).toThrow();
  });

  it("cannot rekey once the previous key is removed", () => {
    process.env[currentName] = oldKey;
    delete process.env[previousName];
    const legacy = encryptIdentityClientSecret("row-1", "value");
    process.env[currentName] = newKey;
    delete process.env[previousName];
    expect(previousEncryptionKeyConfigured()).toBe(false);
    expect(() => rekeyEnvelope("row-1", legacy)).toThrow();
  });

  it("reports key ids without exposing key material, and null for a malformed envelope", () => {
    process.env[currentName] = newKey;
    const id = currentEncryptionKeyId();
    expect(id).toMatch(/^[a-f0-9]{16}$/);
    expect(id).not.toContain(newKey.slice(0, 8));
    expect(envelopeKeyId(Buffer.from("short"))).toBeNull();
    expect(envelopeKeyId(encryptIdentityClientSecret("row", "x"))).toBe(id);
  });
});
