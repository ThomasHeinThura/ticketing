/**
 * Resolves the session-signing secret, failing closed.
 *
 * kaneo validated TASKDESK_AUTH_SECRET only when it was already set and passed
 * `process.env.TASKDESK_AUTH_SECRET || ""` into better-auth. An empty string is
 * falsy there, so better-auth fell through its own chain — `secret ->
 * BETTER_AUTH_SECRET -> AUTH_SECRET -> "better-auth-secret-1234..."` — and
 * settled on a constant published in its own source. better-auth's
 * `validateSecret` only throws for that default when `NODE_ENV === "production"`,
 * so an instance with NODE_ENV merely unset booted happily and signed every
 * session cookie with a value anyone can read on npm.
 *
 * TaskDesk is self-hosted-first, where NODE_ENV is routinely unset, so that
 * default fails open on the shape we actually ship. This function refuses.
 */
export const MINIMUM_AUTH_SECRET_LENGTH = 32;

export function resolveAuthSecret(
  value: string | undefined,
): { ok: true; secret: string } | { ok: false; reason: string } {
  const secret = value ?? "";

  if (secret.length === 0) {
    return {
      ok: false,
      reason:
        "TASKDESK_AUTH_SECRET is not set. It is required. Generate one with: openssl rand -hex 32",
    };
  }

  if (secret.length < MINIMUM_AUTH_SECRET_LENGTH) {
    return {
      ok: false,
      reason:
        "TASKDESK_AUTH_SECRET is less than 32 characters, please generate a new one.",
    };
  }

  return { ok: true, secret };
}
