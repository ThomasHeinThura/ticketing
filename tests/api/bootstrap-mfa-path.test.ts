import { describe, expect, it } from "vitest";
import {
  isBootstrapAllowedAuthPath,
  isBootstrapSignupPath,
} from "../../apps/api/src/auth/bootstrap-mfa-path";

describe("auth bootstrap MFA", () => {
  it("allows only local email/password signup to create the first administrator", () => {
    expect(isBootstrapSignupPath("/sign-up/email")).toBe(true);
    expect(isBootstrapSignupPath("/sign-in/email-otp")).toBe(false);
    expect(isBootstrapSignupPath("/sign-in/social")).toBe(false);
    expect(isBootstrapSignupPath("/callback/custom")).toBe(false);
  });

  it("allows only session, authentication recovery, and factor endpoints while pending", () => {
    expect(isBootstrapAllowedAuthPath("/get-session")).toBe(true);
    expect(isBootstrapAllowedAuthPath("/sign-in/email")).toBe(true);
    expect(isBootstrapAllowedAuthPath("/two-factor/verify-totp")).toBe(true);
    expect(isBootstrapAllowedAuthPath("/email-otp/reset-password")).toBe(true);
    expect(isBootstrapAllowedAuthPath("/update-user")).toBe(false);
    expect(isBootstrapAllowedAuthPath("/two-factor/disable")).toBe(false);
  });
});
