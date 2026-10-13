/** The fixed first-release Entra profile map; authority selectors are not configurable. */
export type IdentityClaimMapping = {
  version: 1;
  displayName: "name";
};

export const DEFAULT_IDENTITY_CLAIM_MAPPING: IdentityClaimMapping = {
  version: 1,
  displayName: "name",
};

export type IdentityClaimMappingValidation =
  | { ok: true; value: IdentityClaimMapping }
  | { ok: false; reason: "invalid_shape" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

/** Missing or null persisted values use the documented fixed default. */
export function parseIdentityClaimMapping(
  raw: unknown,
): IdentityClaimMappingValidation {
  if (raw === undefined || raw === null)
    return { ok: true, value: DEFAULT_IDENTITY_CLAIM_MAPPING };
  if (
    !isRecord(raw) ||
    Object.keys(raw).length !== 2 ||
    raw.version !== 1 ||
    raw.displayName !== "name"
  )
    return { ok: false, reason: "invalid_shape" };
  return { ok: true, value: DEFAULT_IDENTITY_CLAIM_MAPPING };
}

export type IdentityProfileResult =
  | { ok: true; displayName?: string }
  | { ok: false; reason: "invalid_mapping" };

/** Map only the documented optional profile name; never synthesize it. */
export function mapIdentityProfile(
  claims: unknown,
  rawMapping: unknown,
): IdentityProfileResult {
  const parsed = parseIdentityClaimMapping(rawMapping);
  if (!parsed.ok) return { ok: false, reason: "invalid_mapping" };
  if (typeof claims !== "object" || claims === null || Array.isArray(claims))
    return { ok: true };
  const rawName = (claims as Record<string, unknown>)["name"];
  if (typeof rawName !== "string") return { ok: true };
  const displayName = rawName.trim();
  if (
    displayName.length === 0 ||
    new TextEncoder().encode(displayName).length > 255 ||
    [...displayName].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  )
    return { ok: true };
  return { ok: true, displayName };
}
