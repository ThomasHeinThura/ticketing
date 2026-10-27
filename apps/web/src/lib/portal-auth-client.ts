// Vanilla client: the portal uses no React session hooks, and the React
// binding pushed the customer bundle past its G11 budget.
import { createAuthClient } from "better-auth/client";
import { getApiUrl } from "../fetchers/get-api-url";

export function getPortalAuthBaseURL() {
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
  baseURL: getPortalAuthBaseURL(),
  basePath: "/api/auth",
});
