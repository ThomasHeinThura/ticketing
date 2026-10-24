import { describe, expect, it } from "vitest";
import {
  buildAcceptLink,
  CUSTOMER_INVITATION_LIMITS,
  credentialMatches,
  customerInvitationStatus,
  hashCredential,
  isAssignableCustomerRole,
  isWellFormedCustomerInvitation,
  newCredential,
  normaliseInviteeEmail,
} from "../../apps/api/src/customer-invitation/logic";

describe("accept credential (CP-23)", () => {
  it("is 256 bits, URL-safe, unique and stored only as a SHA-256 hash", () => {
    const a = newCredential();
    const b = newCredential();
    expect(a.credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.credential).not.toBe(b.credential);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.credential);
    expect(hashCredential(a.credential)).toBe(a.hash);
  });

  it("matches only the credential that produced the stored hash", () => {
    const a = newCredential();
    expect(credentialMatches(a.hash, a.credential)).toBe(true);
    expect(credentialMatches(a.hash, `${a.credential}x`)).toBe(false);
    expect(credentialMatches(a.hash, newCredential().credential)).toBe(false);
    expect(credentialMatches(null, a.credential)).toBe(false);
    expect(credentialMatches("", a.credential)).toBe(false);
  });

  it("puts the credential in the link fragment, never the path or query", () => {
    const link = buildAcceptLink(
      "https://portal.example.test/",
      "inv 1",
      "tok",
    );
    expect(link).toBe("https://portal.example.test/invite/inv%201#t=tok");
    const url = new URL(link);
    expect(url.pathname).not.toContain("tok");
    expect(url.search).toBe("");
    expect(url.hash).toBe("#t=tok");
  });
});

describe("status (CP-22)", () => {
  const now = new Date("2026-10-24T10:00:00Z");
  const future = new Date("2026-10-26T10:00:00Z");
  const past = new Date("2026-10-23T10:00:00Z");
  it("derives expired from the clock and maps canceled to revoked", () => {
    expect(
      customerInvitationStatus({ status: "pending", expiresAt: future, now }),
    ).toBe("pending");
    expect(
      customerInvitationStatus({ status: "pending", expiresAt: past, now }),
    ).toBe("expired");
    expect(
      customerInvitationStatus({ status: "pending", expiresAt: now, now }),
    ).toBe("expired");
    expect(
      customerInvitationStatus({ status: "accepted", expiresAt: past, now }),
    ).toBe("accepted");
    expect(
      customerInvitationStatus({ status: "canceled", expiresAt: future, now }),
    ).toBe("revoked");
  });

  it("has a lifetime no longer than the staff flow and a resend cooldown", () => {
    expect(CUSTOMER_INVITATION_LIMITS.lifetimeMs).toBe(48 * 3_600_000);
    expect(CUSTOMER_INVITATION_LIMITS.resendCooldownMs).toBeGreaterThan(0);
  });
});

describe("role rule (CP-13, CP-21)", () => {
  it("assigns only the literal customer role", () => {
    expect(isAssignableCustomerRole("customer")).toBe(true);
    for (const role of [
      "admin",
      "owner",
      "member",
      "instance:admin",
      "Customer",
      "",
      null,
      undefined,
      1,
      ["customer"],
    ])
      expect(isAssignableCustomerRole(role)).toBe(false);
  });

  it("re-validates a stored row at accept", () => {
    const ok = {
      scope: "customer",
      role: "customer",
      organisationId: "o",
      teamId: null,
    };
    expect(isWellFormedCustomerInvitation(ok)).toBe(true);
    expect(isWellFormedCustomerInvitation({ ...ok, scope: "staff" })).toBe(
      false,
    );
    expect(isWellFormedCustomerInvitation({ ...ok, role: "admin" })).toBe(
      false,
    );
    expect(isWellFormedCustomerInvitation({ ...ok, role: null })).toBe(false);
    expect(
      isWellFormedCustomerInvitation({ ...ok, organisationId: null }),
    ).toBe(false);
    expect(isWellFormedCustomerInvitation({ ...ok, teamId: "t" })).toBe(false);
  });

  it("normalises the address", () => {
    expect(normaliseInviteeEmail("  A.B@Example.TEST ")).toBe(
      "a.b@example.test",
    );
  });
});
