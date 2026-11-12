import { describe, expect, it } from "vitest";
import {
  signResetToken,
  verifyResetToken,
} from "../../apps/api/src/auth/password-reset";

describe("password reset portal binding", () => {
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
