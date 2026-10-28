/** `/api/me/api-keys` shapes (apps/api/src/api-key/schema.ts). */
export type ApiKey = {
  id: string;
  name: string | null;
  kind: "personal" | "service";
  prefix: string | null;
  start: string | null;
  enabled: boolean;
  isMcp: boolean;
  capabilities: string[];
  writesEnabled: boolean;
  ipAllowlist: string[] | null;
  rateLimitPerMinute: number | null;
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  workspaceId: string | null;
  createdByFormerMember: boolean;
  ownedByWorkspaceAdmins: boolean;
  requiresReattestation: boolean;
  accountabilityVersion: number;
};

export type CreateApiKeyClientRequest = {
  name: string;
  /** Seconds until expiry; null for none. */
  expiresIn: number | null;
  /** Omitted means the read-only default (AK-9). */
  capabilities?: string[];
  isMcp?: boolean;
  ipAllowlist?: string[];
};

export type CreateApiKeyResponse = ApiKey & { key: string };
