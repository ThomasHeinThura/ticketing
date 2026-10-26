/** SSO step-up rules that can be checked without trusting browser supplied claims. */
export function readSignedAuthTime(
  claims: Record<string, unknown>,
): Date | null {
  const value = claims.auth_time;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return null;
  const time = new Date(value * 1000);
  return Number.isNaN(time.getTime()) ? null : time;
}

/**
 * PA-15 requires a signed, recent interactive authentication for SSO step-up.
 * The one minute skew is applied on both sides of the challenge/callback interval.
 */
export function isFreshSignedAuthTime(input: {
  authTime: Date;
  challengeCreatedAt: Date;
  callbackReceivedAt: Date;
}): boolean {
  const authTime = input.authTime.getTime();
  const created = input.challengeCreatedAt.getTime();
  const callback = input.callbackReceivedAt.getTime();
  return (
    Number.isFinite(authTime) &&
    Number.isFinite(created) &&
    Number.isFinite(callback) &&
    authTime >= created - 60_000 &&
    authTime <= callback + 60_000 &&
    callback - authTime <= 5 * 60_000
  );
}

/**
 * No configured provider amr/acr mapping exists yet. A static connection setting
 * cannot certify fresh MFA; callers must use a real local factor when required.
 */
export function hasMappedFreshUpstreamMfa(_claims: Record<string, unknown>) {
  return false;
}
