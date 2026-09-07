import { describe, expect, it } from "vitest";
import {
  MINIMUM_AUTH_SECRET_LENGTH,
  resolveAuthSecret,
} from "../../../apps/api/src/utils/require-auth-secret";

/**
 * Negative guard for issue #6, CRITICAL.
 *
 * kaneo passed `process.env.TASKDESK_AUTH_SECRET || ""` to better-auth. The
 * empty string is falsy, so better-auth fell through to the published constant
 * "better-auth-secret-12345678901234567890", and only refused it when
 * NODE_ENV === "production". TaskDesk is self-hosted-first and NODE_ENV is
 * routinely unset there, so an instance would boot and sign every session
 * cookie with a value anyone can read on npm — forge a cookie, become any user.
 *
 * These tests exist so that reintroducing any tolerance for an absent or short
 * secret fails the suite rather than shipping.
 */
describe("resolveAuthSecret", () => {
  it("refuses an absent secret", () => {
    const result = resolveAuthSecret(undefined);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(
      "TASKDESK_AUTH_SECRET is not set",
    );
  });

  it("refuses an empty secret, so it can never fall through to a library default", () => {
    const result = resolveAuthSecret("");

    expect(result.ok).toBe(false);
  });

  it("refuses a secret shorter than the minimum", () => {
    const result = resolveAuthSecret(
      "a".repeat(MINIMUM_AUTH_SECRET_LENGTH - 1),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toContain(
      "less than 32 characters",
    );
  });

  it("never returns better-auth's published default secret", () => {
    const published = "better-auth-secret-12345678901234567890";
    const result = resolveAuthSecret(undefined);

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(published);
  });

  it("accepts a secret at or above the minimum length", () => {
    const secret = "a".repeat(MINIMUM_AUTH_SECRET_LENGTH);
    const result = resolveAuthSecret(secret);

    expect(result).toEqual({ ok: true, secret });
  });
});
