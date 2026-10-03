export function isBootstrapSignupPath(path: string): boolean {
  return path === "/sign-up/email";
}

const bootstrapAllowedAuthPaths = new Set([
  "/get-session",
  "/sign-out",
  "/sign-in/email",
  "/sign-in/username",
  "/sign-in/phone-number",
  "/sign-in/email-otp",
  "/sign-in/magic-link",
  "/magic-link/verify",
  "/email-otp/send-verification-otp",
  "/email-otp/check-verification-otp",
  "/email-otp/verify-email",
  "/request-password-reset",
  "/email-otp/request-password-reset",
  "/forget-password/email-otp",
  "/email-otp/reset-password",
  "/reset-password",
  "/send-verification-email",
  "/verify-email",
  "/two-factor/enable",
  "/two-factor/get-totp-uri",
  "/two-factor/verify-totp",
  "/two-factor/verify-backup-code",
]);

export function isBootstrapAllowedAuthPath(path: string): boolean {
  return (
    bootstrapAllowedAuthPaths.has(path) ||
    path.startsWith("/reset-password/") ||
    path.startsWith("/callback/") ||
    path.startsWith("/oauth2/callback/")
  );
}
