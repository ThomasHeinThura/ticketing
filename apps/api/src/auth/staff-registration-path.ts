/** Address-only invitation matching is allowed after a provider has verified possession. */
export function allowsStaffInvitationByEmail(
  path: unknown,
  emailVerified: boolean,
): boolean {
  return (
    path === "/sign-in/email-otp" ||
    path === "/magic-link/verify" ||
    (emailVerified &&
      typeof path === "string" &&
      (path.startsWith("/callback/") || path.startsWith("/oauth2/callback/")))
  );
}
