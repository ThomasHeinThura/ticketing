import { describe, expect, it } from "vitest";
import {
  customerInvitationContinuationCookieName,
  readCustomerInvitationContinuationContext,
} from "../../../apps/api/src/customer-invitation/continuation-context";

const nonce = "a".repeat(43);

describe("customer invitation continuation request context", () => {
  it("selects the exact per-invitation HttpOnly cookie using the public ID hint", () => {
    const headers = new Headers({
      cookie: `__Host-tdk_customer_invite_inv1=${nonce}; __Host-tdk_customer_invite_inv2=${"b".repeat(43)}`,
      "x-taskdesk-invitation-id": "inv1",
    });

    expect(readCustomerInvitationContinuationContext({ headers })).toEqual({
      invitationId: "inv1",
      nonce,
    });
  });

  it("uses only the fixed invite callback path when the provider returns", () => {
    const headers = new Headers({
      cookie: `__Host-tdk_customer_invite_inv1=${nonce}`,
    });

    expect(
      readCustomerInvitationContinuationContext({
        headers,
        callbackURL:
          "https://portal.example.test/invite/inv1?next=https://evil.test",
      }),
    ).toEqual({ invitationId: "inv1", nonce });
    expect(
      readCustomerInvitationContinuationContext({
        headers,
        callbackURL: "https://portal.example.test/catalogue?invitationId=inv1",
      }),
    ).toBeNull();
  });

  it("rejects malformed IDs and cookie values without falling back to another invite", () => {
    const headers = new Headers({
      cookie: `__Host-tdk_customer_invite_inv2=${nonce}`,
      "x-taskdesk-invitation-id": "inv1",
    });
    expect(
      readCustomerInvitationContinuationContext({
        headers,
        invitationId: "inv/1",
      }),
    ).toBeNull();
    expect(() => customerInvitationContinuationCookieName("inv/1")).toThrow();
    expect(
      readCustomerInvitationContinuationContext({
        headers: new Headers({
          cookie: "__Host-tdk_customer_invite_inv1=not-a-nonce",
          "x-taskdesk-invitation-id": "inv1",
        }),
      }),
    ).toBeNull();
  });
});
