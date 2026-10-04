const REQUEST_TIMEOUT_MS = 5_000;
const MAX_JSON_BYTES = 128 * 1024;

export type EntraDiscovery = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function acceptedMicrosoftEndpoint(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "login.microsoftonline.com" ||
        url.hostname.endsWith(".login.microsoftonline.com")) &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("Identity provider request failed");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_BYTES)
    throw new Error("Identity provider response is invalid");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Identity provider response is invalid");
  }
}

export async function loadEntraDiscovery(
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EntraDiscovery> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      tenantId,
    )
  )
    throw new Error("Identity provider configuration is invalid");
  const expectedIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const discoveryUrl = `${expectedIssuer}/.well-known/openid-configuration`;
  const response = await fetchImpl(discoveryUrl, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  const document = await readJson(response);
  if (
    !isRecord(document) ||
    document.issuer !== expectedIssuer ||
    !acceptedMicrosoftEndpoint(document.authorization_endpoint) ||
    !acceptedMicrosoftEndpoint(document.token_endpoint) ||
    !acceptedMicrosoftEndpoint(document.jwks_uri)
  )
    throw new Error("Identity provider configuration is invalid");
  return {
    issuer: expectedIssuer,
    authorizationEndpoint: document.authorization_endpoint,
    tokenEndpoint: document.token_endpoint,
    jwksUri: document.jwks_uri,
  };
}

export async function loadEntraJwks(
  jwksUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  if (!acceptedMicrosoftEndpoint(jwksUri))
    throw new Error("Identity provider configuration is invalid");
  const response = await fetchImpl(jwksUri, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  return readJson(response);
}

export async function exchangeEntraCode(input: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<{ idToken: string }> {
  if (!acceptedMicrosoftEndpoint(input.tokenEndpoint))
    throw new Error("Identity provider configuration is invalid");
  const response = await (input.fetchImpl ?? fetch)(input.tokenEndpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier,
    }),
  });
  const payload = await readJson(response);
  if (
    !isRecord(payload) ||
    typeof payload.id_token !== "string" ||
    payload.id_token.length === 0
  )
    throw new Error("Identity provider response is invalid");
  return { idToken: payload.id_token };
}
