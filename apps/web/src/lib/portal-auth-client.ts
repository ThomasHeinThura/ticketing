import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { getApiUrl } from "../fetchers/get-api-url";

function getBaseURL() {
  // Reuse getApiUrl (the single VITE_API_URL reader). A same-origin build
  // (VITE_API_URL="") yields a relative "/api/" path, which is not a
  // parseable URL, so the base is "" and the client resolves against the
  // current origin.
  try {
    return new URL(getApiUrl("/")).origin;
  } catch {
    return "";
  }
}

/** Minimal auth surface for the customer bundle; it imports no agent client plugins. */
export const portalAuthClient = createAuthClient({
  baseURL: getBaseURL(),
  basePath: "/api/auth",
  plugins: [
    twoFactorClient({
      twoFactorPage: "/sign-in?stage=factor",
      onTwoFactorRedirect: () => undefined,
    }),
  ],
});
