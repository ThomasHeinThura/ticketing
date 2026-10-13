import { afterEach, describe, expect, it } from "vitest";
import {
  decryptIdentityClientSecret,
  encryptIdentityClientSecret,
} from "../../../apps/api/src/identity/client-secret";

const currentName = "TASKDESK_ENCRYPTION_KEY";
const previousName = "TASKDESK_ENCRYPTION_KEY_PREVIOUS";
const originalCurrent = process.env[currentName];
const originalPrevious = process.env[previousName];
const firstKey = "11".repeat(32);
const secondKey = "22".repeat(32);

afterEach(() => {
  if (originalCurrent === undefined) delete process.env[currentName];
  else process.env[currentName] = originalCurrent;
  if (originalPrevious === undefined) delete process.env[previousName];
  else process.env[previousName] = originalPrevious;
});

describe("identity client-secret envelope", () => {
  it("encrypts with a fresh IV and decrypts only for the bound row", () => {
    process.env[currentName] = firstKey;
    delete process.env[previousName];
    const first = encryptIdentityClientSecret(
      "connection-a",
      "credential-value",
    );
    const second = encryptIdentityClientSecret(
      "connection-a",
      "credential-value",
    );

    expect(first.equals(second)).toBe(false);
    expect(first.includes(Buffer.from("credential-value"))).toBe(false);
    expect(decryptIdentityClientSecret("connection-a", first)).toBe(
      "credential-value",
    );
    expect(() => decryptIdentityClientSecret("connection-b", first)).toThrow(
      "Identity client secret is unavailable",
    );
  });

  it("reads the previous key during a configured rotation window", () => {
    process.env[currentName] = firstKey;
    delete process.env[previousName];
    const envelope = encryptIdentityClientSecret("connection-a", "secret");

    process.env[previousName] = firstKey;
    process.env[currentName] = secondKey;
    expect(decryptIdentityClientSecret("connection-a", envelope)).toBe(
      "secret",
    );
  });

  it("rejects unavailable, malformed and tampered envelopes without exposing input", () => {
    process.env[currentName] = firstKey;
    delete process.env[previousName];
    const envelope = encryptIdentityClientSecret("connection-a", "secret");
    const tampered = Buffer.from(envelope);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;

    expect(() =>
      decryptIdentityClientSecret("connection-a", Buffer.alloc(3)),
    ).toThrow("Identity client secret is unavailable");
    expect(() => decryptIdentityClientSecret("connection-a", tampered)).toThrow(
      "Identity client secret is unavailable",
    );
    process.env[currentName] = secondKey;
    expect(() => decryptIdentityClientSecret("connection-a", envelope)).toThrow(
      "Identity client secret is unavailable",
    );
  });

  it("requires a configured valid current key and bounded nonempty secret", () => {
    delete process.env[currentName];
    expect(() => encryptIdentityClientSecret("connection-a", "secret")).toThrow(
      "TASKDESK_ENCRYPTION_KEY is required",
    );
    process.env[currentName] = "not-a-key";
    expect(() => encryptIdentityClientSecret("connection-a", "secret")).toThrow(
      "Configured encryption key is invalid",
    );
    process.env[currentName] = firstKey;
    expect(() => encryptIdentityClientSecret("connection-a", "")).toThrow(
      "Identity client secret is invalid",
    );
  });
});
