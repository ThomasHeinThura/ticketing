import {
  emailOTPClient,
  magicLinkClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { getPortalAuthBaseURL } from "./portal-auth-client";

/**
 * Sign-in-only methods stay out of the shared portal shell. The client uses the same origin,
 * base path, and cookies as the shell client; provider/factor methods load only when used.
 */
export const portalProviderAuthClient = createAuthClient({
  baseURL: getPortalAuthBaseURL(),
  basePath: "/api/auth",
  plugins: [
    magicLinkClient(),
    emailOTPClient(),
    twoFactorClient({
      twoFactorPage: "/sign-in?stage=factor",
      onTwoFactorRedirect: () => undefined,
    }),
  ],
});
