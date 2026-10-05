import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateEntraIdToken } from "../../../apps/api/src/identity/oidc-token.js";

const expectation = {
  issuer: "https://login.microsoftonline.com/tenant/v2.0",
  tenantId: "tenant",
  clientId: "client",
  nonce: "expected-nonce",
  nowSeconds: 1_800_000_000,
};

function signedToken(overrides: Record<string, unknown> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const header = { alg: "RS256", kid: "key-1", typ: "JWT" };
  const claims = {
    iss: expectation.issuer,
    aud: expectation.clientId,
    tid: expectation.tenantId,
    nonce: expectation.nonce,
    exp: expectation.nowSeconds + 300,
    nbf: expectation.nowSeconds - 10,
    ...overrides,
  };
  const first = Buffer.from(JSON.stringify(header)).toString("base64url");
  const second = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `${first}.${second}`;
  const token = `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
  const jwk = publicKey.export({ format: "jwk" });
  return {
    token,
    jwks: { keys: [{ ...jwk, kid: "key-1", use: "sig", alg: "RS256" }] },
  };
}

describe("Entra ID-token validation", () => {
  it("verifies signature and binds issuer, tenant, audience, nonce and time", () => {
    const fixture = signedToken();
    expect(
      validateEntraIdToken(fixture.token, fixture.jwks, expectation),
    ).toMatchObject({ ok: true });
  });

  it.each([
    [{ iss: "https://evil.example" }, "issuer_mismatch"],
    [{ aud: "another-client" }, "audience_mismatch"],
    [{ tid: "another-tenant" }, "tenant_mismatch"],
    [{ nonce: "another-nonce" }, "nonce_mismatch"],
    [{ exp: expectation.nowSeconds - 61 }, "expired"],
    [{ nbf: expectation.nowSeconds + 61 }, "not_yet_valid"],
  ] as const)("refuses invalid claims %#", (claims, reason) => {
    const fixture = signedToken(claims);
    expect(
      validateEntraIdToken(fixture.token, fixture.jwks, expectation),
    ).toEqual({ ok: false, reason });
  });

  it("refuses a bad signature, unsupported algorithm, and unknown key", () => {
    const valid = signedToken();
    const corrupted = `${valid.token.slice(0, -2)}aa`;
    expect(validateEntraIdToken(corrupted, valid.jwks, expectation)).toEqual({
      ok: false,
      reason: "invalid_signature",
    });
    const wrongKey = { keys: [] };
    expect(validateEntraIdToken(valid.token, wrongKey, expectation)).toEqual({
      ok: false,
      reason: "unknown_signing_key",
    });
  });

  it("rejects malformed and oversized input without echoing token material", () => {
    expect(validateEntraIdToken("not-a-jwt", {}, expectation)).toEqual({
      ok: false,
      reason: "malformed_token",
    });
    expect(validateEntraIdToken("x".repeat(33_000), {}, expectation)).toEqual({
      ok: false,
      reason: "malformed_token",
    });
  });
});
