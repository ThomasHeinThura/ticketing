/**
 * A-05: signing in on the wrong host. The server revokes the session and answers 403 with a stable
 * code; the sign-in screens show these translated messages instead of the raw server text.
 *
 * - `USE_CUSTOMER_PORTAL`: a customer account on the agent host.
 * - `USE_AGENT_SIGN_IN`: a staff account on the portal host.
 * - `CUSTOMER_PORTAL_UNAVAILABLE`: a customer account that lost portal access, on the portal host.
 */
const REFUSAL_KEYS: Record<string, string> = {
  USE_CUSTOMER_PORTAL: "auth:wrongPortal.useCustomerPortal",
  USE_AGENT_SIGN_IN: "auth:wrongPortal.useAgentSignIn",
  CUSTOMER_PORTAL_UNAVAILABLE: "auth:wrongPortal.customerPortalUnavailable",
};

export function signInRefusalKey(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const { code } = error;
  return typeof code === "string" && Object.hasOwn(REFUSAL_KEYS, code)
    ? (REFUSAL_KEYS[code] ?? null)
    : null;
}
