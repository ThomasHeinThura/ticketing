import { startMockOidcBrowserProvider } from "./mock-oidc-browser-provider.mjs";

if (process.env.TASKDESK_SSO_BROWSER_HARNESS !== "1")
  throw new Error("SSO browser network hook requires its isolated harness");

const tenantId = process.env.TASKDESK_TEST_OIDC_TENANT_ID;
const expectedOrigin = "http://127.0.0.1:1334";
if (!tenantId || process.env.TASKDESK_TEST_OIDC_MOCK_ORIGIN !== expectedOrigin)
  throw new Error("SSO browser mock provider origin is invalid");

await startMockOidcBrowserProvider({
  host: "0.0.0.0",
  port: 1334,
  additionalRedirectUris: [
    "https://ticketing.localhost:1444/api/auth/identity/sso-browser-link-target/callback",
  ],
  subjectByRedirectUri: {
    "https://ticketing.localhost:1444/api/auth/identity/sso-browser-link-target/callback":
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  },
});

const originalFetch = globalThis.fetch.bind(globalThis);
const providerOrigin = new URL(expectedOrigin);
const officialHost = "login.microsoftonline.com";
const tenantPrefix = `/${tenantId}/`;

globalThis.fetch = async (input, init) => {
  const requestUrl =
    input instanceof Request ? new URL(input.url) : new URL(String(input));
  if (requestUrl.hostname !== officialHost) return originalFetch(input, init);
  if (
    requestUrl.protocol !== "https:" ||
    !requestUrl.pathname.startsWith(tenantPrefix)
  )
    throw new Error("SSO browser provider request was refused");

  let localPath;
  if (
    requestUrl.pathname === `/${tenantId}/v2.0/.well-known/openid-configuration`
  ) {
    localPath = `/discovery?tenantId=${encodeURIComponent(tenantId)}`;
  } else if (requestUrl.pathname === `/${tenantId}/oauth2/v2.0/token`) {
    localPath = "/token";
  } else if (requestUrl.pathname === `/${tenantId}/discovery/v2.0/keys`) {
    localPath = "/jwks";
  } else {
    throw new Error("SSO browser provider endpoint was refused");
  }
  return originalFetch(new URL(localPath, providerOrigin), init);
};
