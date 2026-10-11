import { describe, expect, it, vi } from "vitest";
import {
  exchangeEntraCode,
  loadEntraDiscovery,
  loadEntraJwks,
} from "../../../apps/api/src/identity/oidc-provider.js";

const tenant = "12345678-1234-1234-1234-123456789012";
const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
const discovery = {
  issuer,
  authorization_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
  token_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
  jwks_uri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Entra OIDC provider transport", () => {
  it("loads a tenant-specific discovery document without redirects", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(discovery));
    expect(await loadEntraDiscovery(tenant, fetchImpl)).toEqual({
      issuer,
      authorizationEndpoint: discovery.authorization_endpoint,
      tokenEndpoint: discovery.token_endpoint,
      jwksUri: discovery.jwks_uri,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${issuer}/.well-known/openid-configuration`,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each([
    { ...discovery, issuer: "https://login.microsoftonline.com/common/v2.0" },
    { ...discovery, token_endpoint: "http://127.0.0.1/token" },
    { ...discovery, jwks_uri: "https://evil.example/keys" },
  ])("rejects noncanonical or unsafe discovery metadata", async (body) => {
    await expect(
      loadEntraDiscovery(tenant, vi.fn().mockResolvedValue(response(body))),
    ).rejects.toThrow("Identity provider configuration is invalid");
  });

  it("exchanges the authorization code without exposing upstream bodies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ id_token: "jwt" }));
    await expect(
      exchangeEntraCode({
        tokenEndpoint: discovery.token_endpoint,
        clientId: "client",
        clientSecret: "private",
        code: "authorization-code",
        codeVerifier: "verifier",
        redirectUri: "https://agent.example/api/auth/identity/callback/id",
        fetchImpl,
      }),
    ).resolves.toEqual({ idToken: "jwt" });
    expect(fetchImpl).toHaveBeenCalledWith(
      discovery.token_endpoint,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("rejects oversized and failed JWKS responses safely", async () => {
    await expect(
      loadEntraJwks(
        discovery.jwks_uri,
        vi.fn().mockResolvedValue(new Response("x".repeat(140_000))),
      ),
    ).rejects.toThrow("Identity provider response is invalid");
    await expect(
      loadEntraJwks(
        discovery.jwks_uri,
        vi
          .fn()
          .mockResolvedValue(response({ error: "private upstream body" }, 500)),
      ),
    ).rejects.toThrow("Identity provider request failed");
  });
});
