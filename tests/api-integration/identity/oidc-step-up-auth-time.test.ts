import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isFreshSignedAuthTime,
  readSignedAuthTime,
} from "../../../apps/api/src/auth/step-up-sso";
import { validateEntraIdToken } from "../../../apps/api/src/identity/oidc-token";
import {
  type MockOidcIssuer,
  startMockOidcIssuer,
} from "./helpers/mock-oidc-issuer";

const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const CLIENT_ID = "taskdesk-step-up-test-client";
const NONCE = "step-up-test-nonce";

describe("signed Entra step-up auth_time", () => {
  let issuer: MockOidcIssuer;
  let jwks: unknown;

  beforeAll(async () => {
    issuer = await startMockOidcIssuer({ tenantId: TENANT_ID });
    const response = await fetch(issuer.jwksUri);
    jwks = await response.json();
  });

  afterAll(async () => {
    await issuer.close();
  });

  function verify(claims: Record<string, unknown>) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = issuer.signIdToken(
      {
        aud: CLIENT_ID,
        tid: TENANT_ID,
        oid: "linked-external-subject",
        nonce: NONCE,
        ...claims,
      },
      nowSeconds,
    );
    return validateEntraIdToken(token, jwks, {
      issuer: issuer.issuer,
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      nonce: NONCE,
      nowSeconds,
    });
  }

  it("accepts fresh signed auth_time and rejects missing, stale, and future values", () => {
    const now = Date.now();
    const fresh = verify({ auth_time: Math.floor((now - 60_000) / 1000) });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const authTime = readSignedAuthTime(fresh.claims);
    expect(authTime).not.toBeNull();
    expect(
      isFreshSignedAuthTime({
        authTime: authTime as Date,
        challengeCreatedAt: new Date(now - 2 * 60_000),
        callbackReceivedAt: new Date(now),
      }),
    ).toBe(true);

    const missing = verify({});
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(readSignedAuthTime(missing.claims)).toBeNull();

    const stale = verify({ auth_time: Math.floor((now - 6 * 60_000) / 1000) });
    expect(stale.ok).toBe(true);
    if (stale.ok) {
      const staleAuthTime = readSignedAuthTime(stale.claims);
      expect(staleAuthTime).not.toBeNull();
      expect(
        isFreshSignedAuthTime({
          authTime: staleAuthTime as Date,
          challengeCreatedAt: new Date(now - 2 * 60_000),
          callbackReceivedAt: new Date(now),
        }),
      ).toBe(false);
    }

    const future = verify({ auth_time: Math.floor((now + 2 * 60_000) / 1000) });
    expect(future.ok).toBe(true);
    if (future.ok) {
      const futureAuthTime = readSignedAuthTime(future.claims);
      expect(futureAuthTime).not.toBeNull();
      expect(
        isFreshSignedAuthTime({
          authTime: futureAuthTime as Date,
          challengeCreatedAt: new Date(now - 2 * 60_000),
          callbackReceivedAt: new Date(now),
        }),
      ).toBe(false);
    }
  });

  it("rejects a modified signature even when auth_time is otherwise fresh", () => {
    const token = issuer.signIdToken({
      aud: CLIENT_ID,
      tid: TENANT_ID,
      oid: "linked-external-subject",
      nonce: NONCE,
      auth_time: Math.floor(Date.now() / 1000),
    });
    const parts = token.split(".");
    const altered = `${parts[0]}.${parts[1]}.${Buffer.alloc(256).toString("base64url")}`;
    const result = validateEntraIdToken(altered, jwks, {
      issuer: issuer.issuer,
      tenantId: TENANT_ID,
      clientId: CLIENT_ID,
      nonce: NONCE,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });
});
