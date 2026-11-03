/**
 * A-05: signing in on the wrong host. The session is revoked either way; these JSON endpoints
 * also answer 403 with a stable code, so the form can say which sign-in page to use instead of
 * reporting success. Browser redirect flows (`/magic-link/verify`, OAuth callbacks) keep their
 * redirect: a thrown error there would leave the person on a raw JSON page.
 */
export const USE_CUSTOMER_PORTAL = "USE_CUSTOMER_PORTAL";
export const USE_AGENT_SIGN_IN = "USE_AGENT_SIGN_IN";
export const CUSTOMER_PORTAL_UNAVAILABLE = "CUSTOMER_PORTAL_UNAVAILABLE";

const jsonSignInPaths = new Set([
  "/sign-in/email",
  "/sign-in/username",
  "/sign-in/phone-number",
  "/sign-in/email-otp",
  "/sign-up/email",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
  "/two-factor/verify-otp",
]);

export function refusesWrongPortalWithError(path: string): boolean {
  return jsonSignInPaths.has(path);
}
