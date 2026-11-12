import { describe, expect, it } from "vitest";
import { inviteWorkspaceMemberBody } from "../../../apps/api/src/workspace/schema";

describe("staff invitation body", () => {
  it("requires a role unless resend is true", () => {
    const email = "person@example.com";
    expect(inviteWorkspaceMemberBody.safeParse({ email }).success).toBe(false);
    expect(
      inviteWorkspaceMemberBody.safeParse({ email, resend: false }).success,
    ).toBe(false);
    expect(
      inviteWorkspaceMemberBody.safeParse({ email, role: "member" }).success,
    ).toBe(true);
    expect(
      inviteWorkspaceMemberBody.safeParse({ email, resend: true }).success,
    ).toBe(true);
    expect(
      inviteWorkspaceMemberBody.safeParse({
        email,
        resend: true,
        role: "admin",
      }).success,
    ).toBe(true);
  });
});
