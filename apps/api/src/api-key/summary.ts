import { isCapability } from "@taskdesk/permissions";
import { isReadCapability } from "./capability-set";
import type { ApiKeySummary } from "./schema";

/** The persisted view the summary is built from (see `repository.ts`'s `StoredApiKey`). */
export type SummarySource = {
  id: string;
  name: string | null;
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  permissions: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  isMcp: boolean;
  workspaceId: string | null;
  personId: string | null;
  capabilities: string[] | null;
  ipAllowlist: string[] | null;
  rateLimitPerMinute: number | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  creatorActive: boolean | null;
};

/**
 * Capabilities the key stores, read back the same fail-closed way the request path does
 * (`apiKeyCapabilitySubset`): exact `resource:action` pairs the registry knows, nothing else.
 * A service key reads its frozen `capabilities`; a personal key reads `permissions`.
 */
export function storedCapabilities(source: SummarySource): string[] {
  if (source.workspaceId !== null) {
    return Array.isArray(source.capabilities)
      ? [
          ...new Set(
            source.capabilities.filter(
              (value): value is string =>
                typeof value === "string" && isCapability(value),
            ),
          ),
        ].sort()
      : [];
  }
  if (source.permissions === null) return [];
  try {
    const parsed: unknown = JSON.parse(source.permissions);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return [];
    const out = new Set<string>();
    for (const [resource, actions] of Object.entries(parsed)) {
      if (!Array.isArray(actions)) return [];
      for (const action of actions) {
        if (typeof action !== "string") return [];
        const candidate = `${resource}:${action}`;
        if (isCapability(candidate)) out.add(candidate);
      }
    }
    return [...out].sort();
  } catch {
    return [];
  }
}

export function toApiKeySummary(source: SummarySource): ApiKeySummary {
  const capabilities = storedCapabilities(source);
  const service = source.workspaceId !== null;
  return {
    id: source.id,
    name: source.name,
    kind: service ? "service" : "personal",
    prefix: source.prefix,
    start: source.start,
    enabled: source.enabled && source.disabledAt === null,
    isMcp: source.isMcp,
    capabilities,
    writesEnabled: capabilities.some(
      (capability) => isCapability(capability) && !isReadCapability(capability),
    ),
    ipAllowlist: source.ipAllowlist,
    rateLimitPerMinute: source.rateLimitPerMinute,
    expiresAt: source.expiresAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
    lastUsedAt: source.lastUsedAt?.toISOString() ?? null,
    lastUsedIp: source.lastUsedIp,
    disabledAt: source.disabledAt?.toISOString() ?? null,
    disabledReason: source.disabledReason,
    workspaceId: source.workspaceId,
    // AK-7: a service key whose creator is no longer an active member is shown as owned by
    // the workspace administrators; the key itself keeps working.
    createdByFormerMember: service && source.creatorActive !== true,
  };
}
