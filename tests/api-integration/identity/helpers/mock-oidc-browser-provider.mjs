import {
  createHash,
  createSign,
  generateKeyPairSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { createServer } from "node:http";

const KEY_ID = "taskdesk-sso-browser-fixture";
const CODE_TTL_MS = 60_000;
const SCENARIOS = new Set([
  "fresh",
  "stale_auth_time",
  "missing_auth_time",
  "bad_signature",
]);

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sameSecret(left, right) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function makeIdToken(keyPair, input, scenario) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: input.issuer,
    aud: input.clientId,
    tid: input.tenantId,
    oid: input.subject,
    sub: input.subject,
    nonce: input.nonce,
    iat: now,
    exp: now + 180,
    name: "SSO Browser Fixture Administrator",
    email: "sso-browser-admin@example.test",
    preferred_username: "sso-browser-admin@example.test",
    acct: 0,
    roles: ["TaskDesk.User"],
  };
  if (scenario === "stale_auth_time") claims.auth_time = now - 6 * 60;
  else if (scenario !== "missing_auth_time") claims.auth_time = now;

  const encode = (value) => b64url(JSON.stringify(value));
  const content = `${encode({ alg: "RS256", typ: "JWT", kid: KEY_ID })}.${encode(claims)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(content);
  signer.end();
  let signature = signer.sign(keyPair.privateKey);
  if (scenario === "bad_signature") {
    signature = Buffer.from(signature);
    signature[0] = (signature[0] ?? 0) ^ 1;
  }
  return `${content}.${signature.toString("base64url")}`;
}

async function readFormBody(request, maxBytes = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function html(response, body, callbackOrigin) {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; form-action 'self' ${callbackOrigin}; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'`,
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function validateCallbackUri(value) {
  if (typeof value !== "string") return null;
  try {
    const callback = new URL(value);
    if (
      callback.protocol !== "https:" ||
      callback.origin !== "https://ticketing.localhost:1444" ||
      callback.username ||
      callback.password ||
      !/^\/api\/auth\/identity\/[A-Za-z0-9_-]+\/callback$/u.test(
        callback.pathname,
      ) ||
      callback.search ||
      callback.hash ||
      callback.toString() !== value
    )
      return null;
    return callback;
  } catch {
    return null;
  }
}

export async function startMockOidcBrowserProvider(options = {}) {
  const config = {
    tenantId: options.tenantId ?? process.env.TASKDESK_TEST_OIDC_TENANT_ID,
    clientId: options.clientId ?? process.env.TASKDESK_TEST_OIDC_CLIENT_ID,
    clientSecret:
      options.clientSecret ?? process.env.TASKDESK_TEST_OIDC_CLIENT_SECRET,
    subject: options.subject ?? process.env.TASKDESK_TEST_OIDC_SUBJECT,
    redirectUri:
      options.redirectUri ?? process.env.TASKDESK_TEST_OIDC_REDIRECT_URI,
    controlKey:
      options.controlKey ?? process.env.TASKDESK_TEST_OIDC_CONTROL_KEY,
  };
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      config.tenantId ?? "",
    ) ||
    !config.clientId ||
    !config.clientSecret ||
    !config.subject ||
    !config.redirectUri ||
    !config.controlKey
  )
    throw new Error("SSO browser fixture configuration is incomplete");
  const additionalRedirectUris = options.additionalRedirectUris ?? [];
  if (!Array.isArray(additionalRedirectUris))
    throw new Error("SSO browser fixture callback is invalid");
  const configuredRedirectUris = [
    config.redirectUri,
    ...additionalRedirectUris,
  ];
  const callbacks = configuredRedirectUris.map(validateCallbackUri);
  if (
    callbacks.some((callback) => callback === null) ||
    new Set(configuredRedirectUris).size !== configuredRedirectUris.length
  )
    throw new Error("SSO browser fixture callback is invalid");
  const callbackOrigin = callbacks[0]?.origin;
  const redirectUris = new Set(configuredRedirectUris);
  const subjectByRedirectUri = options.subjectByRedirectUri ?? {};
  if (
    typeof subjectByRedirectUri !== "object" ||
    subjectByRedirectUri === null ||
    Array.isArray(subjectByRedirectUri) ||
    Object.entries(subjectByRedirectUri).some(
      ([redirectUri, subject]) =>
        !redirectUris.has(redirectUri) ||
        typeof subject !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
          subject,
        ),
    )
  )
    throw new Error("SSO browser fixture subject mapping is invalid");

  const issuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;
  const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = {
    ...keyPair.publicKey.export({ format: "jwk" }),
    kid: KEY_ID,
    use: "sig",
    alg: "RS256",
  };
  const authorizations = new Map();
  const codes = new Map();
  let nextScenario = "fresh";

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && requestUrl.pathname === "/__health") {
      return sendJson(response, 200, { status: "ready" });
    }
    if (request.method === "GET" && requestUrl.pathname === "/discovery") {
      if (requestUrl.searchParams.get("tenantId") !== config.tenantId)
        return sendJson(response, 404, { error: "not_found" });
      return sendJson(response, 200, {
        issuer,
        authorization_endpoint: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`,
        token_endpoint: `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`,
        jwks_uri: `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`,
      });
    }
    if (request.method === "POST" && requestUrl.pathname === "/__control") {
      if (
        !sameSecret(
          request.headers.authorization ?? "",
          `Bearer ${config.controlKey}`,
        )
      ) {
        return sendJson(response, 404, { error: "not_found" });
      }
      try {
        const body = await readFormBody(request);
        const scenario = body.get("scenario");
        if (!scenario || !SCENARIOS.has(scenario))
          return sendJson(response, 400, { error: "invalid_scenario" });
        nextScenario = scenario;
        return sendJson(response, 200, { status: "updated" });
      } catch {
        return sendJson(response, 400, { error: "invalid_request" });
      }
    }
    if (request.method === "GET" && requestUrl.pathname === "/authorize") {
      const params = requestUrl.searchParams;
      const state = params.get("state") ?? "";
      const nonce = params.get("nonce") ?? "";
      const codeChallenge = params.get("code_challenge") ?? "";
      const redirectUri = params.get("redirect_uri") ?? "";
      const isStepUp = state.startsWith("su1_");
      if (
        params.get("client_id") !== config.clientId ||
        params.get("response_type") !== "code" ||
        params.get("code_challenge_method") !== "S256" ||
        (isStepUp && params.get("prompt") !== "login") ||
        (!isStepUp &&
          params.has("prompt") &&
          params.get("prompt") !== "login") ||
        params.get("response_mode") !== "query" ||
        !params.get("scope")?.split(/\s+/u).includes("openid") ||
        !/^[A-Za-z0-9_-]{20,256}$/u.test(state) ||
        !/^[A-Za-z0-9_-]{43}$/u.test(nonce) ||
        !/^[A-Za-z0-9_-]{43}$/u.test(codeChallenge) ||
        !redirectUris.has(redirectUri)
      )
        return sendJson(response, 400, {
          error: "invalid_authorization_request",
        });

      const transaction = randomBytes(24).toString("base64url");
      authorizations.set(transaction, {
        state,
        nonce,
        codeChallenge,
        redirectUri,
        subject: Object.hasOwn(subjectByRedirectUri, redirectUri)
          ? subjectByRedirectUri[redirectUri]
          : config.subject,
        isStepUp,
        clientId: config.clientId,
        scenario: nextScenario,
        expiresAt: Date.now() + CODE_TTL_MS,
      });
      nextScenario = "fresh";
      return html(
        response,
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test identity provider</title><style>body{font:16px system-ui;max-width:32rem;margin:12vh auto;padding:2rem;color:#202124}main{border:1px solid #dadce0;border-radius:12px;padding:2rem}button{font:inherit;padding:.7rem 1.2rem}p{color:#5f6368}</style></head><body><main><h1>Test identity provider</h1><p>This local fixture signs a short-lived token for the synthetic browser account.</p><form method="post" action="/authorize/continue"><input type="hidden" name="transaction" value="${transaction}"><button type="submit">Continue as test administrator</button></form></main></body></html>`,
        callbackOrigin,
      );
    }
    if (
      request.method === "POST" &&
      requestUrl.pathname === "/authorize/continue"
    ) {
      try {
        const body = await readFormBody(request);
        const transaction = body.get("transaction") ?? "";
        const authorization = authorizations.get(transaction);
        authorizations.delete(transaction);
        if (!authorization || authorization.expiresAt <= Date.now())
          return sendJson(response, 400, { error: "authorization_expired" });
        const code = randomBytes(32).toString("base64url");
        codes.set(code, {
          ...authorization,
          issuedAt: Date.now(),
        });
        const callback = new URL(authorization.redirectUri);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", authorization.state);
        response.writeHead(303, {
          "cache-control": "no-store",
          location: callback.toString(),
          "referrer-policy": "no-referrer",
        });
        return response.end();
      } catch {
        return sendJson(response, 400, { error: "invalid_authorization" });
      }
    }
    if (request.method === "GET" && requestUrl.pathname === "/jwks") {
      return sendJson(response, 200, { keys: [publicJwk] });
    }
    if (request.method === "POST" && requestUrl.pathname === "/token") {
      try {
        const form = await readFormBody(request);
        const code = form.get("code") ?? "";
        const auth = codes.get(code);
        codes.delete(code);
        const verifier = form.get("code_verifier") ?? "";
        const challenge = createHash("sha256")
          .update(verifier)
          .digest("base64url");
        if (
          !auth ||
          auth.issuedAt + CODE_TTL_MS <= Date.now() ||
          form.get("grant_type") !== "authorization_code" ||
          form.get("client_id") !== config.clientId ||
          !sameSecret(form.get("client_secret") ?? "", config.clientSecret) ||
          form.get("redirect_uri") !== auth.redirectUri ||
          !sameSecret(challenge, auth.codeChallenge)
        )
          return sendJson(response, 400, { error: "invalid_grant" });
        return sendJson(response, 200, {
          token_type: "Bearer",
          expires_in: 180,
          id_token: makeIdToken(
            keyPair,
            {
              issuer,
              tenantId: config.tenantId,
              clientId: config.clientId,
              subject: auth.subject,
              nonce: auth.nonce,
            },
            auth.scenario,
          ),
        });
      } catch {
        return sendJson(response, 400, { error: "invalid_token_request" });
      }
    }
    return sendJson(response, 404, { error: "not_found" });
  });

  const host = options.host ?? "127.0.0.1";
  const port = Number(
    options.port ?? process.env.TASKDESK_TEST_OIDC_MOCK_PORT ?? "1334",
  );
  const localHost = host === "127.0.0.1";
  const isolatedContainerHost =
    host === "0.0.0.0" && process.env.TASKDESK_SSO_BROWSER_HARNESS === "1";
  if (
    (!localHost && !isolatedContainerHost) ||
    !Number.isSafeInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error("SSO browser fixture bind is invalid");
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    origin: `http://${host}:${port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
