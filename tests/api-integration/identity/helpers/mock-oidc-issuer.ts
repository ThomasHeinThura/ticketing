import { createSign, generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";

const KEY_ID = "taskdesk-test-key";
export type MockOidcOptions = {
  issuerPath?: string;
  discoveryPath?: string;
  jwksPath?: string;
  tenantId?: string;
};

export type MockOidcIssuer = {
  baseUrl: string;
  issuer: string;
  jwksUri: string;
  signIdToken(claims: Record<string, unknown>, nowSeconds?: number): string;
  close(): Promise<void>;
};

export async function startMockOidcIssuer(
  options: MockOidcOptions = {},
): Promise<MockOidcIssuer> {
  const normalizedIssuerPath = options.issuerPath
    ?.split("/")
    .filter(Boolean)
    .join("/");
  const issuerPath =
    options.issuerPath === undefined
      ? "/tenant/v2.0"
      : normalizedIssuerPath
        ? `/${normalizedIssuerPath}`
        : "";
  const discoveryPath =
    options.discoveryPath ??
    `${issuerPath.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const jwksPath = options.jwksPath ?? "/keys";
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = keyPair.publicKey.export({ format: "jwk" });
  const publicJwk = { ...jwk, kid: KEY_ID, use: "sig", alg: "RS256" };
  let baseUrl = "";
  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", baseUrl).pathname;
    const body =
      path === discoveryPath
        ? {
            issuer: `${baseUrl}${issuerPath}`,
            authorization_endpoint: `${baseUrl}/authorize`,
            token_endpoint: `${baseUrl}/token`,
            jwks_uri: `${baseUrl}${jwksPath}`,
            response_types_supported: ["code"],
            subject_types_supported: ["public"],
            id_token_signing_alg_values_supported: ["RS256"],
            ...(options.tenantId ? { tenant_id: options.tenantId } : {}),
          }
        : path === jwksPath
          ? { keys: [publicJwk] }
          : undefined;
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(body));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("mock OIDC server did not bind a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const issuer = `${baseUrl}${issuerPath}`;

  return {
    baseUrl,
    issuer,
    jwksUri: `${baseUrl}${jwksPath}`,
    signIdToken(claims, nowSeconds = Math.floor(Date.now() / 1000)) {
      const encode = (value: unknown) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
      const header = encode({ alg: "RS256", typ: "JWT", kid: KEY_ID });
      const payload = encode({
        iss: issuer,
        iat: nowSeconds,
        exp: nowSeconds + 300,
        ...claims,
      });
      const content = `${header}.${payload}`;
      const signer = createSign("RSA-SHA256");
      signer.update(content);
      signer.end();
      return `${content}.${signer.sign(keyPair.privateKey).toString("base64url")}`;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
