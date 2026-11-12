import { describe, expect, it } from "vitest";
import { proofMethodAcceptable } from "../../../apps/api/src/auth/step-up-spend";

describe("registration second factor", () => {
  it("does not accept password or SSO proofs for the registration switch", () => {
    expect(
      proofMethodAcceptable(
        "password",
        { required: false, enabled: false },
        true,
      ),
    ).toBe(false);
    expect(
      proofMethodAcceptable(
        "sso_prompt_login",
        { required: false, enabled: false },
        true,
      ),
    ).toBe(false);
    expect(
      proofMethodAcceptable("totp", { required: false, enabled: true }, true),
    ).toBe(true);
    expect(
      proofMethodAcceptable(
        "backup_code",
        { required: false, enabled: true },
        true,
      ),
    ).toBe(true);
    expect(
      proofMethodAcceptable("totp", { required: false, enabled: false }, true),
    ).toBe(false);
  });
  it("retains normal PA-15 password behavior for other saves", () => {
    expect(
      proofMethodAcceptable("password", { required: false, enabled: false }),
    ).toBe(true);
  });
});
