import { apiKeyClient } from "@better-auth/api-key/client";
import {
  adminClient,
  deviceAuthorizationClient,
  emailOTPClient,
  genericOAuthClient,
  inferAdditionalFields,
  lastLoginMethodClient,
  magicLinkClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { routes } from "./routes";

const getBaseURL = () => {
  // `??`, not `||`: see get-api-url.ts — an explicitly empty VITE_API_URL
  // means same-origin (the bundled image), and `new URL("")` throwing sends
  // it through the catch below, which returns "" too (a relative baseURL
  // better-auth's client resolves against the current origin).
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:1337";
  try {
    const url = new URL(apiUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return apiUrl.split("/").slice(0, 3).join("/");
  }
};

export const authClient = createAuthClient({
  baseURL: getBaseURL(),
  basePath: "/api/auth",
  plugins: [
    lastLoginMethodClient(),
    magicLinkClient(),
    emailOTPClient(),
    genericOAuthClient(),
    deviceAuthorizationClient(),
    apiKeyClient(),
    adminClient(),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        if (typeof window === "undefined") return;
        const current = new URL(window.location.href);
        const redirect = current.searchParams.get("redirect") ?? undefined;
        const invitationId =
          current.searchParams.get("invitationId") ?? undefined;
        window.location.replace(
          routes.authMfa.build({ redirect, invitationId }),
        );
      },
    }),
    inferAdditionalFields({
      user: {
        locale: {
          type: "string",
          required: false,
          input: true,
        },
      },
    }),
  ],
});
