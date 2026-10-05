export type IdentityJitPolicy = {
  enabled: boolean;
  default_role_id: string | null;
  required_entra_app_role: string;
};

export type IdentityJitPolicyResult =
  | { ok: true; value: IdentityJitPolicy }
  | { ok: false; reason: "invalid_shape" };

export type EntraAdmissionResult =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid_policy" | "missing_app_role" | "guest_account";
    };

/** Validate only the closed persisted policy; caller checks role scope and rank. */
export function parseIdentityJitPolicy(raw: unknown): IdentityJitPolicyResult {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw) ||
    (Object.getPrototypeOf(raw) !== Object.prototype &&
      Object.getPrototypeOf(raw) !== null)
  )
    return { ok: false, reason: "invalid_shape" };
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value);
  if (
    keys.length !== 3 ||
    !keys.includes("enabled") ||
    !keys.includes("default_role_id") ||
    !keys.includes("required_entra_app_role") ||
    typeof value.enabled !== "boolean" ||
    (value.default_role_id !== null &&
      (typeof value.default_role_id !== "string" ||
        value.default_role_id.length === 0)) ||
    typeof value.required_entra_app_role !== "string" ||
    value.required_entra_app_role.length === 0
  )
    return { ok: false, reason: "invalid_shape" };
  return {
    ok: true,
    value: {
      enabled: value.enabled,
      default_role_id: value.default_role_id as string | null,
      required_entra_app_role: value.required_entra_app_role,
    },
  };
}

/** Apply IP-27 to already signature/issuer/audience-validated ID-token claims. */
export function validateEntraAdmission(
  claims: { readonly acct?: unknown; readonly roles?: unknown },
  rawPolicy: unknown,
): EntraAdmissionResult {
  const policy = parseIdentityJitPolicy(rawPolicy);
  if (!policy.ok) return { ok: false, reason: "invalid_policy" };
  if (
    !Array.isArray(claims.roles) ||
    !claims.roles.every((role) => typeof role === "string") ||
    !claims.roles.includes(policy.value.required_entra_app_role)
  )
    return { ok: false, reason: "missing_app_role" };
  if (claims.acct !== 0) return { ok: false, reason: "guest_account" };
  return { ok: true };
}
