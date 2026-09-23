import { describe, expect, it } from "vitest";
import { computeScramSha256Verifier } from "../../../apps/api/src/database/scram-sha-256";

/**
 * Issue #296, S2 (independent Opus 5.5 review of PR #308, BLOCKING): the format-level
 * properties of the verifier. `db-application-role.test.ts` (integration) proves the
 * end-to-end claim -- that Postgres accepts it and the plaintext password authenticates.
 */
describe("computeScramSha256Verifier", () => {
  const SCRAM_FORMAT =
    /^SCRAM-SHA-256\$\d+:[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*:[A-Za-z0-9+/]+=*$/;

  it("produces the SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey> format", () => {
    const verifier = computeScramSha256Verifier("a-test-password");
    expect(verifier).toMatch(SCRAM_FORMAT);
  });

  it("defaults to 4096 iterations", () => {
    const verifier = computeScramSha256Verifier("a-test-password");
    expect(verifier.startsWith("SCRAM-SHA-256$4096:")).toBe(true);
  });

  it("never contains the plaintext password", () => {
    const password = "S3cretLeakMarkerForFormatTest";
    const verifier = computeScramSha256Verifier(password);
    expect(verifier).not.toContain(password);
  });

  it("produces a different verifier every call, for the same password (fresh salt)", () => {
    const a = computeScramSha256Verifier("same-password");
    const b = computeScramSha256Verifier("same-password");
    expect(a).not.toBe(b);
  });

  it("respects a custom iteration count", () => {
    const verifier = computeScramSha256Verifier("a-test-password", 10_000);
    expect(verifier.startsWith("SCRAM-SHA-256$10000:")).toBe(true);
  });
});
