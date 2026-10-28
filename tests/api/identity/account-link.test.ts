import { describe, expect, it } from "vitest";
import {
  accountLinkIntentIdentifier,
  accountLinkOidcContextSchema,
} from "../../../apps/api/src/identity/account-link-contract.js";
import { parseOidcFlow } from "../../../apps/api/src/identity/oidc-login.js";

const link = {
  purpose: "account_link",
  intentId: "i".repeat(43),
  sourceConnectionId: "connection-a",
  sourceConfigVersion: 3,
  targetConfigVersion: 8,
  sessionId: "session-a",
  userId: "user-a",
  personId: "person-a",
} as const;

const baseFlow = {
  connectionId: "connection-b",
  portal: "agent",
  nonce: "nonce",
  codeVerifier: "verifier",
  redirectUri:
    "https://ticketing.localhost/api/auth/identity/connection-b/callback",
  organisationId: null,
};

describe("IP-18 OIDC link flow state", () => {
  it("accepts explicit link-purpose state with a closed, typed binding", () => {
    const parsed = parseOidcFlow(
      JSON.stringify({
        ...baseFlow,
        purpose: "account_link",
        accountLink: link,
      }),
    );
    expect(parsed).toMatchObject({
      purpose: "account_link",
      connectionId: "connection-b",
      accountLink: link,
    });
    expect(accountLinkOidcContextSchema.safeParse(link).success).toBe(true);
  });

  it("keeps legacy and explicitly tagged login state on the login branch", () => {
    expect(parseOidcFlow(JSON.stringify(baseFlow))?.purpose).toBe("login");
    expect(
      parseOidcFlow(JSON.stringify({ ...baseFlow, purpose: "login" }))?.purpose,
    ).toBe("login");
  });

  it("never interprets malformed or unknown-purpose link state as login", () => {
    expect(
      parseOidcFlow(
        JSON.stringify({
          ...baseFlow,
          purpose: "account_link",
          accountLink: { ...link, sessionId: undefined },
        }),
      ),
    ).toBeNull();
    expect(
      parseOidcFlow(JSON.stringify({ ...baseFlow, purpose: "unknown" })),
    ).toBeNull();
    expect(
      parseOidcFlow(
        JSON.stringify({ ...baseFlow, purpose: "login", accountLink: link }),
      ),
    ).toBeNull();
  });

  it("stores only a digest of the opaque confirmation intent id", () => {
    const identifier = accountLinkIntentIdentifier(link.intentId);
    expect(identifier).toMatch(/^identity-link-intent:[0-9a-f]{64}$/u);
    expect(identifier).not.toContain(link.intentId);
  });
});
