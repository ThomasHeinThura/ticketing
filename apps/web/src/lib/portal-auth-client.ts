import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

function getBaseURL() {
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:1337";
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/");
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
