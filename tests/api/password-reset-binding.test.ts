import { describe, expect, it } from "vitest";
import {
  hashResetIdentifier,
  signResetToken,
  verifyResetToken,
} from "../../apps/api/src/auth/password-reset";

describe("password reset portal binding", () => {
  it("stores a digest without the bearer", async () => {
    const raw = "random-bearer";
    const digest = await hashResetIdentifier(`reset-password:${raw}`);
    expect(digest).toMatch(/^reset-password-sha256:[a-f0-9]{64}$/);
    expect(digest).not.toContain(raw);
    expect(await hashResetIdentifier(`reset-password:${raw}`)).toBe(digest);
  });
  it("accepts only the issuing portal and rejects tampering", () => {
    const signed = signResetToken("a-valid-token", "agent", "test-secret");
    expect(verifyResetToken(signed, "agent", "test-secret")).toBe(
      "a-valid-token",
    );
    expect(verifyResetToken(signed, "customer", "test-secret")).toBeNull();
    expect(
      verifyResetToken(`other${signed}`, "agent", "test-secret"),
    ).toBeNull();
    expect(verifyResetToken("bad", "agent", "test-secret")).toBeNull();
  });
});
