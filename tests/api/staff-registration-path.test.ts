import { describe, expect, it } from "vitest";
import { allowsStaffInvitationByEmail } from "../../apps/api/src/auth/staff-registration-path";

describe("staff invitation email matching", () => {
  it.each(["/callback/google", "/callback/github", "/oauth2/callback/custom"])(
    "requires a verified address for %s",
    (path) => {
      expect(allowsStaffInvitationByEmail(path, false)).toBe(false);
      expect(allowsStaffInvitationByEmail(path, true)).toBe(true);
    },
  );
  it.each(["/sign-in/email-otp", "/magic-link/verify"])(
    "matches an invitation after local verification for %s",
    (path) => {
      expect(allowsStaffInvitationByEmail(path, true)).toBe(true);
    },
  );
  it("requires a link for password signup", () => {
    expect(allowsStaffInvitationByEmail("/sign-up/email", true)).toBe(false);
  });
});
