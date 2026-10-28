import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startMockOidcBrowserProvider } from "../../api-integration/identity/helpers/mock-oidc-browser-provider.mjs";

const tenantId = "12345678-1234-1234-1234-123456789012";
const clientId = "sso-browser-test-client";
const clientSecret = "sso-browser-test-secret";
const callbackA =
  "https://ticketing.localhost:1444/api/auth/identity/sso-browser-primary/callback";
const callbackB =
  "https://ticketing.localhost:1444/api/auth/identity/sso-browser-link-target/callback";
const defaultSubject = "sso-browser-subject";
const targetSubject = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate local test port");
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function startProvider(
  additionalRedirectUris?: string[],
  subjectByRedirectUri?: Record<string, string>,
) {
  const provider = await startMockOidcBrowserProvider({
    tenantId,
    clientId,
    clientSecret,
    subject: defaultSubject,
    redirectUri: callbackA,
    additionalRedirectUris,
    subjectByRedirectUri,
    controlKey: "sso-browser-control-key",
    port: await availablePort(),
  });
  servers.push(provider);
  return provider;
}

function authorizationUrl(origin: string, redirectUri: string) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL("/authorize", origin);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile",
    state: randomBytes(24).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url, verifier };
}

async function issueCode(origin: string, redirectUri: string) {
  const authorization = authorizationUrl(origin, redirectUri);
  const page = await fetch(authorization.url, { redirect: "manual" });
  if (!page.ok) throw new Error(`Authorization request failed: ${page.status}`);
  const html = await page.text();
  const transaction = html.match(/name="transaction" value="([^"]+)"/u)?.[1];
  if (!transaction) throw new Error("Authorization transaction was missing");
  const callback = await fetch(new URL("/authorize/continue", origin), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ transaction }),
    redirect: "manual",
  });
  const location = callback.headers.get("location");
  if (callback.status !== 303 || !location)
    throw new Error(`Authorization continuation failed: ${callback.status}`);
  return {
    code: new URL(location).searchParams.get("code") ?? "",
    verifier: authorization.verifier,
  };
}

async function redeem(
  origin: string,
  input: { code: string; verifier: string; redirectUri: string },
) {
  return fetch(new URL("/token", origin), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.verifier,
    }),
  });
}

async function tokenClaims(response: Response) {
  const body = (await response.json()) as { id_token: string };
  const payload = body.id_token.split(".")[1];
  if (!payload) throw new Error("ID token payload was missing");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    oid: string;
    sub: string;
  };
}

describe("mock browser OIDC provider redirect allowlist", () => {
  it("keeps the default limited to the primary callback", async () => {
    const provider = await startProvider();
    const alternate = authorizationUrl(provider.origin, callbackB);
    const response = await fetch(alternate.url);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_authorization_request",
    });
  });

  it("accepts explicit callbacks but binds codes to their original URI and PKCE", async () => {
    const provider = await startProvider([callbackB], {
      [callbackB]: targetSubject,
    });

    const codeForA = await issueCode(provider.origin, callbackA);
    expect(
      (
        await redeem(provider.origin, {
          code: codeForA.code,
          verifier: codeForA.verifier,
          redirectUri: callbackB,
        })
      ).status,
    ).toBe(400);

    const originalCallbackCode = await issueCode(provider.origin, callbackA);
    const originalCallbackToken = await redeem(provider.origin, {
      ...originalCallbackCode,
      redirectUri: callbackA,
    });
    expect(originalCallbackToken.status).toBe(200);
    expect(await tokenClaims(originalCallbackToken)).toMatchObject({
      oid: defaultSubject,
      sub: defaultSubject,
    });

    const wrongVerifierCode = await issueCode(provider.origin, callbackB);
    expect(
      (
        await redeem(provider.origin, {
          code: wrongVerifierCode.code,
          verifier: randomBytes(32).toString("base64url"),
          redirectUri: callbackB,
        })
      ).status,
    ).toBe(400);

    const redeemable = await issueCode(provider.origin, callbackB);
    const token = await redeem(provider.origin, {
      ...redeemable,
      redirectUri: callbackB,
    });
    expect(token.status).toBe(200);
    expect(await tokenClaims(token)).toMatchObject({
      oid: targetSubject,
      sub: targetSubject,
    });
    expect(
      (
        await redeem(provider.origin, {
          ...redeemable,
          redirectUri: callbackB,
        })
      ).status,
    ).toBe(400);
  });

  it("refuses unsafe additional callback configuration", async () => {
    for (const uri of [
      "https://example.test/api/auth/identity/foreign/callback",
      "http://ticketing.localhost:1444/api/auth/identity/foreign/callback",
      "https://ticketing.localhost:1444/api/auth/identity/foreign/callback?next=/",
      "https://ticketing.localhost:1444/api/auth/identity/*/callback",
    ]) {
      await expect(startProvider([uri])).rejects.toThrow(
        "SSO browser fixture callback is invalid",
      );
    }
    await expect(
      startProvider([], { [callbackB]: targetSubject }),
    ).rejects.toThrow("SSO browser fixture subject mapping is invalid");
    await expect(
      startProvider([callbackB], { [callbackB]: "not-a-guid" }),
    ).rejects.toThrow("SSO browser fixture subject mapping is invalid");
  });
});
