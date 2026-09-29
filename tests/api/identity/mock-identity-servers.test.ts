import { createVerify } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { startMockOidcIssuer } from "../../api-integration/identity/helpers/mock-oidc-issuer";
import { startMockScimServer } from "../../api-integration/identity/helpers/mock-scim-server";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

function keep<T extends { close(): Promise<void> }>(server: T): T {
  closers.push(() => server.close());
  return server;
}

describe("local identity protocol test servers", () => {
  it("serves discovery and JWKS, and signs a verifiable ID token", async () => {
    const issuer = keep(await startMockOidcIssuer({ tenantId: "tenant-test" }));
    const discovery = await fetch(
      `${issuer.issuer}/.well-known/openid-configuration`,
    );
    const metadata = (await discovery.json()) as {
      issuer: string;
      jwks_uri: string;
      tenant_id: string;
    };
    expect(metadata.issuer).toBe(issuer.issuer);
    expect(metadata.jwks_uri).toBe(issuer.jwksUri);
    expect(metadata.tenant_id).toBe("tenant-test");

    const keyResponse = await fetch(issuer.jwksUri);
    const jwks = (await keyResponse.json()) as {
      keys: Array<{ kid: string; n: string; e: string }>;
    };
    expect(jwks.keys).toHaveLength(1);
    const token = issuer.signIdToken(
      { aud: "taskdesk-test", sub: "subject-1" },
      1_800_000_000,
    );
    const [header, payload, signature] = token.split(".");
    expect(header).toBeDefined();
    expect(payload).toBeDefined();
    expect(signature).toBeDefined();
    const key = jwks.keys[0];
    expect(key).toBeDefined();
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    verifier.end();
    const publicKey = {
      key: { kty: "RSA", n: key?.n, e: key?.e },
      format: "jwk" as const,
    };
    expect(
      verifier.verify(publicKey, Buffer.from(signature ?? "", "base64url")),
    ).toBe(true);
    expect(
      JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")),
    ).toMatchObject({
      iss: issuer.issuer,
      aud: "taskdesk-test",
      sub: "subject-1",
      iat: 1_800_000_000,
      exp: 1_800_000_300,
    });
  });

  it("serves discovery derived from a trailing-slash issuer and the root issuer", async () => {
    for (const issuerPath of ["/tenant/custom/", "/"]) {
      const issuer = keep(await startMockOidcIssuer({ issuerPath }));
      const discovery = await fetch(
        `${issuer.issuer}/.well-known/openid-configuration`,
      );
      expect(discovery.status).toBe(200);
      const metadata = (await discovery.json()) as { issuer: string };
      expect(metadata.issuer).toBe(issuer.issuer);
    }
  });

  it("captures SCIM requests and allows each response to be configured", async () => {
    const scim = keep(
      await startMockScimServer({
        respond: (request) => ({
          status: request.method === "POST" ? 201 : 204,
          body:
            request.method === "POST"
              ? { id: "scim-user-1", schemas: [] }
              : undefined,
        }),
      }),
    );
    const created = await fetch(`${scim.baseUrl}/scim/v2/Users`, {
      method: "POST",
      headers: {
        authorization: "Bearer local-test-token",
        "content-type": "application/scim+json",
      },
      body: JSON.stringify({ userName: "ada@example.test" }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ id: "scim-user-1", schemas: [] });
    const deleted = await fetch(`${scim.baseUrl}/scim/v2/Users/scim-user-1`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(scim.requests).toHaveLength(2);
    expect(scim.requests[0]).toMatchObject({
      method: "POST",
      path: "/scim/v2/Users",
      body: JSON.stringify({ userName: "ada@example.test" }),
    });
    expect(scim.requests[0]?.headers.authorization).toBe(
      "Bearer local-test-token",
    );
    expect(scim.requests[1]).toMatchObject({
      method: "DELETE",
      path: "/scim/v2/Users/scim-user-1",
    });
  });
});
