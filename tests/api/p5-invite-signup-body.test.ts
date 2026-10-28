import { describe, expect, it } from "vitest";
import { readInviteSignUpBody } from "../../apps/api/src/customer-invitation/signup";

const CREDENTIAL = "A".repeat(43);

describe("invitation sign-up body (CP-12)", () => {
  it("reads a well-formed id and credential from the body only", () => {
    expect(
      readInviteSignUpBody({
        invitationId: "abc_123-X",
        invitationCredential: CREDENTIAL,
        email: "a@example.test",
      }),
    ).toEqual({ invitationId: "abc_123-X", credential: CREDENTIAL });
  });

  it("rejects anything missing, non-string or malformed", () => {
    for (const body of [
      null,
      undefined,
      "x",
      {},
      { invitationId: "abc" },
      { invitationCredential: CREDENTIAL },
      { invitationId: "abc", invitationCredential: "short" },
      { invitationId: "abc", invitationCredential: `${CREDENTIAL}!` },
      { invitationId: "a b", invitationCredential: CREDENTIAL },
      { invitationId: "", invitationCredential: CREDENTIAL },
      { invitationId: ["abc"], invitationCredential: CREDENTIAL },
      { invitationId: "abc", invitationCredential: 42 },
      { invitationId: "a".repeat(129), invitationCredential: CREDENTIAL },
    ])
      expect(readInviteSignUpBody(body)).toBeNull();
  });
});
