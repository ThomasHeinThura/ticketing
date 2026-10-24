import { describe, expect, it } from "vitest";
import {
  ARGON2ID_PARAMS,
  apiKeySelector,
  hashApiKeySecretArgon2id,
  isArgon2idHash,
  legacySha256ApiKeyHash,
  parseArgon2idHash,
  VerifiedSecretCache,
  verifyApiKeySecret,
} from "../../../apps/api/src/api-key/secret-hash";

const secret = "tdk_exampleSecretValueThatIsLongEnough0123456789abc";

describe("API key secret hashing (AK-2)", () => {
  it("stores a versioned, salted Argon2id PHC string that verifies", async () => {
    const a = await hashApiKeySecretArgon2id(secret);
    const b = await hashApiKeySecretArgon2id(secret);
    expect(isArgon2idHash(a)).toBe(true);
    expect(a).toMatch(
      new RegExp(
        `^\\$argon2id\\$v=19\\$m=${ARGON2ID_PARAMS.memory},t=${ARGON2ID_PARAMS.passes},p=${ARGON2ID_PARAMS.parallelism}\\$`,
      ),
    );
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret);
    expect(await verifyApiKeySecret(secret, a)).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect((await verifyApiKeySecret(`${secret}x`, a)).valid).toBe(false);
  });

  it("verifies a legacy SHA-256 value and asks for an upgrade", async () => {
    const legacy = legacySha256ApiKeyHash(secret);
    expect(isArgon2idHash(legacy)).toBe(false);
    expect(await verifyApiKeySecret(secret, legacy)).toEqual({
      valid: true,
      needsRehash: true,
    });
    expect((await verifyApiKeySecret("tdk_other", legacy)).valid).toBe(false);
  });

  it("does not accept a hash whose parameters were altered", async () => {
    const current = await hashApiKeySecretArgon2id(secret);
    const parsed = parseArgon2idHash(current);
    if (!parsed) throw new Error("expected a parseable hash");
    const weaker = current.replace(`m=${ARGON2ID_PARAMS.memory}`, "m=8192");
    // The tag was computed with the stronger memory, so the weaker string no longer verifies.
    expect((await verifyApiKeySecret(secret, weaker)).valid).toBe(false);
  });

  it("refuses malformed or unbounded stored values instead of computing them", async () => {
    for (const bad of [
      "$argon2id$v=19$m=1,t=1,p=1$AAAA$AAAA",
      "$argon2id$v=19$m=999999999,t=2,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAA",
      "$argon2id$v=18$m=19456,t=2,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAA",
      "$argon2id$garbage",
    ]) {
      expect(parseArgon2idHash(bad)).toBeNull();
      expect((await verifyApiKeySecret(secret, bad)).valid).toBe(false);
    }
  });

  it("derives a 12 character selector", () => {
    expect(apiKeySelector(secret)).toBe(secret.slice(0, 12));
  });

  it("caches a match only for the same secret and the same stored hash, and expires", () => {
    let now = 1_000;
    const cache = new VerifiedSecretCache(100, 2, () => now);
    cache.remember("s1", "hash1");
    expect(cache.has("s1", "hash1")).toBe(true);
    expect(cache.has("s1", "hash2")).toBe(false);
    expect(cache.has("s2", "hash1")).toBe(false);
    now += 101;
    expect(cache.has("s1", "hash1")).toBe(false);
    cache.remember("a", "1");
    cache.remember("b", "2");
    cache.remember("c", "3");
    expect(cache.has("a", "1")).toBe(false);
    expect(cache.has("c", "3")).toBe(true);
  });
});
